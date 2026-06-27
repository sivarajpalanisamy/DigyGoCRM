import 'dart:async';
import 'dart:io';

import 'api.dart';
import 'dialer_data.dart';
import 'phone_call.dart';

/// Listens for finished call recordings from the native recorder and uploads them
/// to the CRM, attaching to the matching call log. Best-effort: if recording isn't
/// supported on the device, no events fire and nothing happens.
class RecordingUploader {
  RecordingUploader._();
  static final RecordingUploader instance = RecordingUploader._();

  StreamSubscription<RecordingEvent>? _sub;

  void start() {
    _sub ??= PhoneCall.instance.recordings.listen(_handle);
  }

  Future<void> _handle(RecordingEvent r) async {
    try {
      // Make sure the just-ended call is synced first, so the server has a row to
      // attach the recording to.
      final logs = await DialerData.instance.callLogs();
      await DialerData.instance.syncToCrm(logs);
      await Future.delayed(const Duration(milliseconds: 800));
      await Api.instance.uploadRecordingByKey(
        filePath: r.path,
        phone: r.number,
        startedAt: r.startedAt,
      );
    } catch (_) {
      // best-effort; leave the file for a future retry attempt
      return;
    }
    try {
      final f = File(r.path);
      if (await f.exists()) await f.delete();
    } catch (_) {}
  }
}
