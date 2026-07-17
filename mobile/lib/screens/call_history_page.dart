import 'package:call_log/call_log.dart';
import 'package:flutter/material.dart';

import '../theme.dart';
import '../services/dialer_data.dart';
import '../services/call_launcher.dart';
import '../services/api.dart';
import '../services/native.dart';
import 'call_details_page.dart';

class CallHistoryPage extends StatefulWidget {
  const CallHistoryPage({super.key});

  @override
  State<CallHistoryPage> createState() => _CallHistoryPageState();
}

enum _Filter { all, incoming, outgoing, missed, rejected }

class _CallHistoryPageState extends State<CallHistoryPage> {
  List<CallLogEntry> _all = [];
  Map<String, String> _notes = {};
  bool _loading = true;
  String _search = '';
  _Filter _filter = _Filter.all;
  // SIM gate snapshot - the same one the background sync uses to decide which
  // calls reach the CRM. This screen mirrors that rule so it only ever shows
  // calls on a CRM-verified SIM (null until the first load completes).
  SimGate? _gate;
  // Whether this device is linked to the CRM (i.e. its number is verified). A
  // device only gets a token once its number is OTP-verified in the dashboard.
  bool _linked = false;

  String _keyFor(CallLogEntry e) => '${e.number ?? 'unknown'}_${e.timestamp ?? 0}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final logs = await DialerData.instance.callLogs();
      final notes = await Api.instance.notes();
      final gate = await Native.instance.simGateInfo();
      final linked = await Api.instance.hasDeviceToken();
      if (!mounted) return;
      setState(() {
        _all = logs;
        _notes = notes;
        _gate = gate;
        _linked = linked;
        _loading = false;
      });
      // Mirror to CRM silently in the background (has its own SIM gate).
      DialerData.instance.syncToCrm(logs);
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  // The device must be linked (its number verified in the CRM) before calls show;
  // otherwise we prompt the user to verify. Once linked, the list is shown and the
  // per-call best-effort filter (DialerData.filterVerifiedSim) hides only calls we can
  // prove are on the other, unverified SIM - so a linked device is never blank.
  bool get _verifiedReady => _gate != null && _linked;

  Future<void> _addNote(CallLogEntry e) async {
    final key = _keyFor(e);
    final ctrl = TextEditingController(text: _notes[key] ?? '');
    final saved = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20, right: 20, top: 20, bottom: MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Note for ${e.name?.isNotEmpty == true ? e.name! : (e.number ?? 'Unknown')}',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Brand.ink)),
            const SizedBox(height: 14),
            TextField(
              controller: ctrl,
              maxLines: 4,
              autofocus: true,
              decoration: const InputDecoration(hintText: 'Add a note about this call…'),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
              child: const Text('Save note'),
            ),
          ],
        ),
      ),
    );
    if (saved == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _notes[key] = saved); // optimistic
    try {
      await Api.instance.saveCallNote(
        clientKey: key,
        phone: e.number ?? '',
        startedAtMs: e.timestamp ?? 0,
        note: saved,
      );
      messenger.showSnackBar(const SnackBar(content: Text('Note saved')));
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Note saved on device; will sync when linked')));
    }
  }

  bool _matchesFilter(CallLogEntry e) {
    switch (_filter) {
      case _Filter.all:
        return true;
      case _Filter.incoming:
        return e.callType == CallType.incoming;
      case _Filter.outgoing:
        return e.callType == CallType.outgoing;
      case _Filter.missed:
        return e.callType == CallType.missed;
      case _Filter.rejected:
        return e.callType == CallType.rejected;
    }
  }

  bool _matchesSearch(CallLogEntry e) {
    if (_search.isEmpty) return true;
    final q = _search.toLowerCase();
    return (e.name ?? '').toLowerCase().contains(q) || (e.number ?? '').contains(q);
  }

  @override
  Widget build(BuildContext context) {
    // Only calls on a CRM-verified SIM ever reach this list (fail closed).
    final filtered = _verifiedReady
        ? DialerData.filterVerifiedSim(_all, _gate!, linked: true)
            .where(_matchesFilter)
            .where(_matchesSearch)
            .toList()
        : <CallLogEntry>[];
    final grouped = _groupByDay(filtered);

    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Row(
              children: [
                const Text('Call History',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Brand.ink)),
                const Spacer(),
                IconButton(onPressed: _load, icon: const Icon(Icons.refresh, color: Brand.muted)),
              ],
            ),
          ),
          // Filter tabs
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                _filterChip('All Calls', _Filter.all),
                _filterChip('Incoming', _Filter.incoming),
                _filterChip('Outgoing', _Filter.outgoing),
                _filterChip('Missed', _Filter.missed),
                _filterChip('Rejected', _Filter.rejected),
              ],
            ),
          ),
          // Search
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              onChanged: (v) => setState(() => _search = v),
              decoration: InputDecoration(
                hintText: 'Search',
                prefixIcon: const Icon(Icons.search, color: Brand.muted),
                contentPadding: const EdgeInsets.symmetric(vertical: 0),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : !_verifiedReady
                    ? _notVerified()
                    : filtered.isEmpty
                    ? _empty()
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
                          itemCount: grouped.length,
                          itemBuilder: (_, i) {
                            final g = grouped[i];
                            if (g is _Header) return _dayHeader(g.label);
                            final e = g as CallLogEntry;
                            return _CallCard(entry: e, note: _notes[_keyFor(e)], onAddNote: () => _addNote(e));
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _empty() => ListView(
        children: const [
          SizedBox(height: 120),
          Icon(Icons.call_outlined, size: 56, color: Brand.muted),
          SizedBox(height: 12),
          Center(child: Text('No calls yet', style: TextStyle(color: Brand.muted, fontSize: 16))),
        ],
      );

  // Shown when no CRM-verified SIM is set up on this device. We deliberately do
  // NOT fall back to the raw OS call log here - only a verified number's calls
  // are ever shown in the app.
  Widget _notVerified() => ListView(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        children: const [
          SizedBox(height: 100),
          Icon(Icons.sim_card_outlined, size: 56, color: Brand.muted),
          SizedBox(height: 14),
          Center(
            child: Text('Verify your number first',
                textAlign: TextAlign.center,
                style: TextStyle(color: Brand.ink, fontSize: 18, fontWeight: FontWeight.w700)),
          ),
          SizedBox(height: 8),
          Center(
            child: Text(
              'Your calls appear here once your SIM number is verified in the CRM. '
              'Open More → SIM Number to verify.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Brand.muted, fontSize: 14, height: 1.4)),
          ),
        ],
      );

  Widget _filterChip(String label, _Filter f) {
    final active = _filter == f;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: active,
        onSelected: (_) => setState(() => _filter = f),
        showCheckmark: false,
        selectedColor: Brand.accent,
        backgroundColor: Colors.white,
        labelStyle: TextStyle(
          color: active ? Colors.white : Brand.muted,
          fontWeight: FontWeight.w600,
        ),
        side: BorderSide(color: active ? Brand.accent : const Color(0x1A000000)),
      ),
    );
  }

  Widget _dayHeader(String label) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 14, 0, 8),
        child: Text(label,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Brand.ink)),
      );

  // Returns a flat list of _Header + CallLogEntry for a sticky-ish grouped feel.
  List<Object> _groupByDay(List<CallLogEntry> entries) {
    final out = <Object>[];
    String? current;
    for (final e in entries) {
      final label = _dayLabel(e.timestamp ?? 0);
      if (label != current) {
        out.add(_Header(label));
        current = label;
      }
      out.add(e);
    }
    return out;
  }

  String _dayLabel(int ts) {
    final d = DateTime.fromMillisecondsSinceEpoch(ts);
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final that = DateTime(d.year, d.month, d.day);
    final diff = today.difference(that).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${months[d.month - 1]} ${d.year}';
  }
}

class _Header {
  _Header(this.label);
  final String label;
}

class _CallCard extends StatelessWidget {
  const _CallCard({required this.entry, this.note, required this.onAddNote});
  final CallLogEntry entry;
  final String? note;
  final VoidCallback onAddNote;

  void _openDetails(BuildContext context) {
    final num = entry.number ?? '';
    if (num.isEmpty) return;
    final isOut = entry.callType == CallType.outgoing;
    final dur = entry.duration ?? 0;
    String outcome;
    if (entry.callType == CallType.missed) {
      outcome = 'MISSED';
    } else if (entry.callType == CallType.rejected) {
      outcome = 'REJECTED';
    } else if (dur > 0) {
      outcome = 'ANSWERED';
    } else {
      outcome = isOut ? 'NO_ANSWER' : 'MISSED';
    }
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => CallDetailsPage(
        phone: num,
        contactName: (entry.name?.isNotEmpty ?? false) ? entry.name : null,
        direction: isOut ? 'OUTBOUND' : 'INBOUND',
        outcome: outcome,
        durationSeconds: dur,
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final number = entry.number ?? 'Unknown';
    final name = (entry.name?.isNotEmpty ?? false) ? entry.name! : 'Unknown';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x12000000)),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: () => _openDetails(context),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: Row(
              children: [
                _directionAvatar(entry.callType),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: Brand.ink)),
                      const SizedBox(height: 2),
                      Text(number, style: const TextStyle(color: Brand.muted, fontSize: 13)),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(_time(entry.timestamp ?? 0),
                        style: const TextStyle(color: Brand.muted, fontSize: 12)),
                    const SizedBox(height: 2),
                    Text(_dur(entry.duration ?? 0),
                        style: const TextStyle(color: Brand.muted, fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ),
              ],
            ),
          )),
          const Divider(height: 1, color: Color(0x10000000)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _action(Icons.copy_rounded, const Color(0xFF6B7280), () {}),
                _action(Icons.sms_outlined, const Color(0xFF3B82F6), () => DialerData.instance.sms(number)),
                _action(Icons.chat, const Color(0xFF25D366), () => DialerData.instance.whatsapp(number)),
                _action(Icons.call, Brand.accent, () => CallLauncher.start(context, number)),
              ],
            ),
          ),
          // Note & tag bar (Callyzer-style) - tap to add/edit a note for this call.
          InkWell(
            onTap: onAddNote,
            borderRadius: const BorderRadius.vertical(bottom: Radius.circular(16)),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              decoration: const BoxDecoration(
                color: Color(0x07000000),
                borderRadius: BorderRadius.vertical(bottom: Radius.circular(16)),
              ),
              child: Row(
                children: [
                  Icon(note != null && note!.isNotEmpty ? Icons.sticky_note_2 : Icons.note_add_outlined,
                      size: 18, color: note != null && note!.isNotEmpty ? Brand.accent : Brand.muted),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      note != null && note!.isNotEmpty ? note! : 'Tap to add note & tag',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        color: note != null && note!.isNotEmpty ? Brand.ink : Brand.muted,
                        fontWeight: note != null && note!.isNotEmpty ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _action(IconData icon, Color color, VoidCallback onTap) => IconButton(
        icon: Icon(icon, color: color, size: 22),
        onPressed: onTap,
      );

  Widget _directionAvatar(CallType? type) {
    late IconData icon;
    late Color color;
    switch (type) {
      case CallType.incoming:
        icon = Icons.call_received;
        color = const Color(0xFF16A34A);
        break;
      case CallType.outgoing:
        icon = Icons.call_made;
        color = Brand.accent;
        break;
      case CallType.missed:
        icon = Icons.call_missed;
        color = const Color(0xFFDC2626);
        break;
      case CallType.rejected:
        icon = Icons.call_end;
        color = const Color(0xFFDC2626);
        break;
      default:
        icon = Icons.call;
        color = Brand.muted;
    }
    return CircleAvatar(
      radius: 22,
      backgroundColor: color.withValues(alpha: 0.12),
      child: Icon(icon, color: color, size: 22),
    );
  }

  String _time(int ts) {
    final d = DateTime.fromMillisecondsSinceEpoch(ts);
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final m = d.minute.toString().padLeft(2, '0');
    final ap = d.hour < 12 ? 'AM' : 'PM';
    return '$h:$m $ap';
  }

  String _dur(int seconds) {
    if (seconds <= 0) return '0s';
    final m = seconds ~/ 60;
    final s = seconds % 60;
    if (m == 0) return '${s}s';
    return '${m}m ${s}s';
  }
}
