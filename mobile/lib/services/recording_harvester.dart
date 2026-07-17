import 'package:call_log/call_log.dart';

import 'api.dart';
import 'dialer_data.dart';
import 'native.dart';

/// The "Callyzer method": the phone's built-in (OEM) recorder writes both-sides
/// call audio to a folder; we harvest those files and upload them to the CRM.
/// Runs on app start and on resume. Requires All-Files access + the user having
/// enabled the phone's built-in call recording.
class RecordingHarvester {
  RecordingHarvester._();
  static final RecordingHarvester instance = RecordingHarvester._();

  bool _running = false;

  Future<void> run() async {
    if (_running) return;
    _running = true;
    try {
      if (!await Native.instance.hasAllFilesAccess()) return;

      final since = await Api.instance.lastHarvestMs();
      final files = await Native.instance.scanRecordings(since);
      if (files.isEmpty) return;

      // Ensure the calls these recordings belong to are synced first (self-gated).
      final logs = await DialerData.instance.callLogs();
      await DialerData.instance.syncToCrm(logs);
      await Future.delayed(const Duration(milliseconds: 800));

      // Match recordings ONLY against verified-SIM calls, so a recording that lines up
      // with a call on the unverified SIM of a dual-SIM phone is never uploaded.
      final verifiedLogs = await DialerData.instance.verifiedCallLogs();

      int maxModified = since;
      for (final f in files) {
        if (f.modified > maxModified) maxModified = f.modified;
        final match = _matchCall(verifiedLogs, f.modified);
        if (match == null) continue;
        try {
          await Api.instance.uploadRecordingByKey(
            filePath: f.path,
            phone: match.number,
            startedAt: match.timestamp,
          );
        } catch (_) {
          // leave watermark unadvanced past this file so it retries next run
          maxModified = f.modified - 1;
        }
      }
      await Api.instance.setLastHarvestMs(maxModified + 1);
    } finally {
      _running = false;
    }
  }

  /// Match a recording file (written ≈ at call end) to the nearest call log within
  /// a 6-minute window, preferring connected (duration > 0) calls.
  CallLogEntry? _matchCall(List<CallLogEntry> logs, int fileModifiedMs) {
    const windowMs = 6 * 60 * 1000;
    CallLogEntry? best;
    int bestDelta = windowMs;
    for (final e in logs) {
      final start = e.timestamp ?? 0;
      final end = start + ((e.duration ?? 0) * 1000);
      final delta = (fileModifiedMs - end).abs() < (fileModifiedMs - start).abs()
          ? (fileModifiedMs - end).abs()
          : (fileModifiedMs - start).abs();
      if (delta <= bestDelta && (e.duration ?? 0) > 0) {
        bestDelta = delta;
        best = e;
      }
    }
    return best;
  }
}
