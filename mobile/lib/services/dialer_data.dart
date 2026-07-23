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

  // Whether a single call-log entry is allowed to show/sync. STRICT: on a dual-SIM device
  // with a verified SIM, a call is allowed ONLY when it resolves to a verified slot. A call
  // we cannot attribute is HIDDEN - allowing unresolved calls was leaking the unverified
  // (personal) SIM's calls. Resolution is multi-signal (native combines real-time capture +
  // subscription_id/simid + PHONE_ACCOUNT_ID and hands it back via gate.resolvedSlots), so a
  // genuine verified-SIM call still resolves even on OEMs (MIUI/Redmi) that break one signal.
  //  - single-SIM, or no verified slot known → allow (nothing to gate);
  //  - dual-SIM → allow only when the resolved slot is a verified one.
  // This is the one per-call rule every in-app surface shares (list, contacts count,
  // post-call popup, recording gate).
  static bool onVerifiedSimEntry(SimGate gate, CallLogEntry e) {
    if (!gate.multiSim) return true;
    if (gate.verifiedSlots.isEmpty) return true;
    final slot = gate.slotForCall(e.number, e.timestamp, e.phoneAccountId);
    return slot != null && gate.verifiedSlots.contains(slot); // strict: unresolved → hide
  }

  // Keep only entries proven to be on a verified SIM (strict - see onVerifiedSimEntry).
  static List<CallLogEntry> filterVerifiedSim(List<CallLogEntry> logs, SimGate gate, {required bool linked}) {
    if (!linked) return const [];
    if (!gate.multiSim) return logs;
    return logs.where((e) => onVerifiedSimEntry(gate, e)).toList();
  }

  /// The device's call log, minus calls provably on the unverified SIM (best effort).
  /// Every in-app surface that shows call data uses this.
  Future<List<CallLogEntry>> verifiedCallLogs() async {
    final logs = await callLogs();
    final gate = await Native.instance.simGateInfo();
    final linked = await Api.instance.hasDeviceToken();
    return filterVerifiedSim(logs, gate, linked: linked);
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
      if (onVerifiedSimEntry(gate, e)) return e;
    }
    return null;
  }

  /// Whether a recording (identified by the customer [number] + approximate
  /// [startedAtMs]) is allowed to upload. STRICT, mirroring the call gate: on a dual-SIM
  /// device it uploads only when the matched call resolves to a verified SIM. Single-SIM
  /// phones and the no-gating case pass; an unlinked device never uploads.
  Future<bool> recordingIsOnVerifiedSim({String? number, int? startedAtMs}) async {
    if (!await Api.instance.hasDeviceToken()) return false;
    final gate = await Native.instance.simGateInfo();
    if (!gate.multiSim) return true;              // single SIM → the only SIM is verified
    if (gate.verifiedSlots.isEmpty) return true;  // no verified SIM configured → nothing to gate
    final n = (number ?? '').replaceAll(RegExp(r'[^0-9]'), '');
    final tail = n.length >= 9 ? n.substring(n.length - 9) : n;
    if (tail.isEmpty) return false;
    const windowMs = 6 * 60 * 1000;
    for (final e in await callLogs()) {
      final en = (e.number ?? '').replaceAll(RegExp(r'[^0-9]'), '');
      final etail = en.length >= 9 ? en.substring(en.length - 9) : en;
      if (etail != tail) continue;
      final start = e.timestamp ?? 0;
      if ((startedAtMs ?? 0) > 0 && (start - startedAtMs!).abs() > windowMs) continue;
      return onVerifiedSimEntry(gate, e);
    }
    return false; // can't tie the recording to a verified-SIM call → don't upload
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
  // SIM gate (STRICT, mirrors the in-app + native rule): on a dual-SIM device with a verified
  // SIM, a call is synced ONLY when it resolves to a verified slot; a call we cannot attribute
  // is DROPPED (not stamped as the verified SIM - that was leaking the personal SIM's calls).
  // Resolution is multi-signal via native (real-time capture + subscription_id/simid +
  // PHONE_ACCOUNT_ID), so genuine verified-SIM calls still resolve on MIUI/Redmi.
  Future<void> syncToCrm(List<CallLogEntry> logs) async {
    if (logs.isEmpty) return;
    // Only sync when this number is linked to the CRM (device token present).
    if (!await Api.instance.hasDeviceToken()) return;
    try {
      final gate = await Native.instance.simGateInfo();
      final gated = gate.multiSim && gate.verifiedSlots.isNotEmpty;
      final batch = <Map<String, dynamic>>[];
      for (final e in logs.take(200)) {
        int? tagSlot;
        if (gated) {
          final slot = gate.slotForCall(e.number, e.timestamp, e.phoneAccountId);
          if (slot == null || !gate.verifiedSlots.contains(slot)) {
            continue; // strict: unresolved or unverified SIM → never sync
          }
          tagSlot = slot;
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
