import 'package:call_log/call_log.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';
import 'native.dart';
import 'phone_call.dart';

/// Reads the device's call log + contacts (the dialer's data source) and exposes
/// dial / SMS / WhatsApp actions. Also silently mirrors call logs to the CRM in
/// the background - that sync is invisible to the user; the UI is a pure dialer.
class DialerData {
  DialerData._();
  static final DialerData instance = DialerData._();

  // ── Call log ─────────────────────────────────────────────────────────────
  Future<List<CallLogEntry>> callLogs() async {
    final entries = await CallLog.get();
    final list = entries.toList()
      ..sort((a, b) => (b.timestamp ?? 0).compareTo(a.timestamp ?? 0));
    return list;
  }

  // True when a call-log entry is on a CRM-verified SIM (or SIM can't matter).
  // Mirrors the fail-closed rule in [syncToCrm]: on a dual-SIM phone a call is
  // trusted only when its slot resolves AND is a verified slot; a single-SIM
  // phone (or nothing verified yet to compare) has no ambiguity, so it's allowed.
  bool _isOnVerifiedSim(SimGate gate, CallLogEntry e) {
    if (gate.multiSim && gate.verifiedSlots.isNotEmpty) {
      final slot = gate.slotFor(e.phoneAccountId);
      return slot != null && gate.verifiedSlots.contains(slot);
    }
    return true;
  }

  /// Newest call-log entry that ended within [withinMs] AND is on a CRM-verified
  /// SIM. The post-call popup uses this instead of the raw newest row, so a call
  /// on the skipped/unverified SIM of a dual-SIM phone is never surfaced or
  /// pre-filled into the create-lead screen (matches the background sync gate).
  Future<CallLogEntry?> latestVerifiedSimCall({required int withinMs}) async {
    final logs = await callLogs(); // newest first
    if (logs.isEmpty) return null;
    final gate = await Native.instance.simGateInfo();
    final now = DateTime.now().millisecondsSinceEpoch;
    for (final e in logs) {
      final ts = e.timestamp ?? 0;
      final endMs = ts + ((e.duration ?? 0) * 1000);
      if (now - endMs > withinMs) break; // sorted desc → all remaining are older
      if ((e.number ?? '').isEmpty) continue;
      if (_isOnVerifiedSim(gate, e)) return e;
    }
    return null;
  }

  // ── Contacts ─────────────────────────────────────────────────────────────
  Future<List<Contact>> contacts() async {
    if (!await FlutterContacts.requestPermission(readonly: true)) return [];
    final list = await FlutterContacts.getContacts(withProperties: true);
    final filtered = list.where((c) => c.phones.isNotEmpty).toList()
      ..sort((a, b) => a.displayName.toLowerCase().compareTo(b.displayName.toLowerCase()));
    return filtered;
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  // Place the call through our own dialer (in-app in-call screen) when we hold
  // the default-dialer role; otherwise fall back to the system dialer.
  Future<void> dial(String number) async {
    var isDefault = await Native.instance.isDefaultDialer();
    // First call attempt: ask to make Hawcus the default dialer so the call runs in-app.
    if (!isDefault) {
      isDefault = await Native.instance.requestDefaultDialer();
    }
    if (isDefault) {
      await PhoneCall.instance.placeCall(number);
    } else {
      // User declined the role - fall back to the system dialer so calling still works.
      final uri = Uri(scheme: 'tel', path: number);
      if (await canLaunchUrl(uri)) await launchUrl(uri);
    }
  }

  Future<bool> isDefaultDialer() => Native.instance.isDefaultDialer();
  Future<bool> requestDefaultDialer() => Native.instance.requestDefaultDialer();

  Future<void> sms(String number) async {
    final uri = Uri(scheme: 'smsto', path: number);
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  Future<void> whatsapp(String number) async {
    final digits = number.replaceAll(RegExp(r'[^0-9]'), '');
    final uri = Uri.parse('https://wa.me/$digits');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  // ── Background CRM sync ───────────────────────────────────────────────────
  // Posts recent call logs to the CRM (deduped server-side by clientCallId).
  // Best-effort and silent - never blocks or surfaces errors in the dialer UI.
  //
  // SIM gate (mirrors the native background sync): on a dual-SIM phone, a call is
  // uploaded ONLY when we can positively resolve its SIM slot AND that slot is one the
  // user verified in the CRM. Calls on the skipped/unverified SIM - or whose slot we
  // can't resolve - are DROPPED so they never reach the CRM. Single-SIM phones have no
  // ambiguity, so every call is kept and tagged with the sole verified SIM.
  Future<void> syncToCrm(List<CallLogEntry> logs) async {
    if (logs.isEmpty) return;
    // Only sync when this number is linked to the CRM (device token present).
    if (!await Api.instance.hasDeviceToken()) return;
    try {
      final gate = await Native.instance.simGateInfo();
      final batch = <Map<String, dynamic>>[];
      for (final e in logs.take(200)) {
        final slot = gate.slotFor(e.phoneAccountId);
        int? tagSlot;
        if (gate.multiSim && gate.verifiedSlots.isNotEmpty) {
          // Dual-SIM: must resolve the slot AND it must be verified, else skip (fail closed).
          if (slot == null || !gate.verifiedSlots.contains(slot)) continue;
          tagSlot = slot;
        } else {
          // Single SIM (or nothing to compare): tag with the sole verified slot when known.
          tagSlot = slot ?? (gate.verifiedSlots.length == 1 ? gate.verifiedSlots.first : null);
        }

        final ts = e.timestamp ?? 0;
        final started = DateTime.fromMillisecondsSinceEpoch(ts).toUtc().toIso8601String();
        final isOutgoing = e.callType == CallType.outgoing;
        final dur = e.duration ?? 0;
        // Outcome from the call TYPE + DURATION (an unanswered outgoing call has
        // type=outgoing with duration 0 - it must NOT be reported as ANSWERED).
        String outcome;
        if (e.callType == CallType.missed) {
          outcome = 'MISSED';
        } else if (e.callType == CallType.rejected) {
          outcome = 'REJECTED';
        } else if (dur > 0) {
          outcome = 'ANSWERED';
        } else {
          outcome = isOutgoing ? 'NO_ANSWER' : 'MISSED';
        }
        batch.add({
          'clientCallId': '${e.number ?? 'unknown'}_$ts',
          'phone': e.number ?? '',
          'direction': isOutgoing ? 'OUTBOUND' : 'INBOUND',
          'outcome': outcome,
          'durationSeconds': dur,
          'startedAt': started,
          if (tagSlot != null) 'simSlot': tagSlot,
          if (tagSlot != null && gate.numberBySlot[tagSlot] != null)
            'simNumber': gate.numberBySlot[tagSlot],
        });
      }
      if (batch.isEmpty) return;
      await Api.instance.postCalls(batch, simCount: gate.simCount);
    } catch (_) {
      // silent - sync retries on next refresh
    }
  }
}
