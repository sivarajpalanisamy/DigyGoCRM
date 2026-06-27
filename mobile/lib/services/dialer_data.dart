import 'package:call_log/call_log.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';
import 'native.dart';
import 'phone_call.dart';

/// Reads the device's call log + contacts (the dialer's data source) and exposes
/// dial / SMS / WhatsApp actions. Also silently mirrors call logs to the CRM in
/// the background — that sync is invisible to the user; the UI is a pure dialer.
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
    // First call attempt: ask to make DigyGo the default dialer so the call runs in-app.
    if (!isDefault) {
      isDefault = await Native.instance.requestDefaultDialer();
    }
    if (isDefault) {
      await PhoneCall.instance.placeCall(number);
    } else {
      // User declined the role — fall back to the system dialer so calling still works.
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
  // Best-effort and silent — never blocks or surfaces errors in the dialer UI.
  Future<void> syncToCrm(List<CallLogEntry> logs) async {
    if (logs.isEmpty) return;
    // Only sync when this number is linked to the CRM (device token present).
    if (!await Api.instance.hasDeviceToken()) return;
    try {
      final batch = logs.take(200).map((e) {
        final ts = e.timestamp ?? 0;
        final started = DateTime.fromMillisecondsSinceEpoch(ts).toUtc().toIso8601String();
        final isOutgoing = e.callType == CallType.outgoing;
        final dur = e.duration ?? 0;
        // Outcome from the call TYPE + DURATION (an unanswered outgoing call has
        // type=outgoing with duration 0 — it must NOT be reported as ANSWERED).
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
        return {
          'clientCallId': '${e.number ?? 'unknown'}_$ts',
          'phone': e.number ?? '',
          'direction': isOutgoing ? 'OUTBOUND' : 'INBOUND',
          'outcome': outcome,
          'durationSeconds': dur,
          'startedAt': started,
        };
      }).toList();
      await Api.instance.postCalls(batch);
    } catch (_) {
      // silent — sync retries on next refresh
    }
  }
}
