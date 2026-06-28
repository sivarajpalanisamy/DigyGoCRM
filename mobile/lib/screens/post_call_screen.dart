import 'package:flutter/material.dart';
import '../theme.dart';
import '../services/api.dart';
import 'call_details_page.dart';

/// Shown right after a call ends (mirrors the web post-call disposition flow):
///  - "How did it go?" outcome chips (tenant dispositions)
///  - "Next follow-up" date + time preset chips
///  - optional note
/// Saving posts to /api/mobile/calls/by-key/post-call (matched by phone + start
/// time), then continues to the Call Details page. Skip goes straight there.
class PostCallScreen extends StatefulWidget {
  const PostCallScreen({
    super.key,
    required this.phone,
    required this.startedAtMs,
    this.direction,
    this.outcome,
    this.durationSeconds,
    this.leadId,
    this.contactName,
  });

  final String phone;
  final int startedAtMs;
  final String? direction;
  final String? outcome;
  final int? durationSeconds;
  final String? leadId;
  final String? contactName;

  @override
  State<PostCallScreen> createState() => _PostCallScreenState();
}

class _PostCallScreenState extends State<PostCallScreen> {
  List<Map<String, dynamic>> _disps = [];
  bool _loading = true;
  bool _saving = false;

  String? _selectedKey;
  DateTime? _dueDate;     // date only
  TimeOfDay? _dueTime;
  final _noteCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    Api.instance.dispositions().then((d) {
      if (mounted) setState(() { _disps = d; _loading = false; });
    });
  }

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  // ── colour map (matches web DISPOSITION_STYLES) ─────────────────────────────
  Color _dispColor(String c) {
    switch (c) {
      case 'emerald': return const Color(0xFF10B981);
      case 'blue':    return const Color(0xFF3B82F6);
      case 'red':     return const Color(0xFFEF4444);
      case 'gray':    return const Color(0xFF6B7280);
      case 'orange':  return Brand.accent;
      case 'purple':  return const Color(0xFF8B5CF6);
      default:        return Brand.accent;
    }
  }

  String _two(int n) => n < 10 ? '0$n' : '$n';
  String? get _dateStr => _dueDate == null ? null : '${_dueDate!.year}-${_two(_dueDate!.month)}-${_two(_dueDate!.day)}';
  String? get _timeStr => _dueTime == null ? null : '${_two(_dueTime!.hour)}:${_two(_dueTime!.minute)}';

  void _goToDetails() {
    Navigator.of(context).pushReplacement(MaterialPageRoute(
      builder: (_) => CallDetailsPage(
        phone: widget.phone,
        leadId: widget.leadId,
        contactName: widget.contactName,
        direction: widget.direction,
        outcome: widget.outcome,
        durationSeconds: widget.durationSeconds,
      ),
    ));
  }

  Future<void> _save() async {
    if (_selectedKey == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pick an outcome first')));
      return;
    }
    setState(() => _saving = true);
    try {
      await Api.instance.postCallDisposition(
        phone: widget.phone,
        startedAtMs: widget.startedAtMs,
        dispositionKey: _selectedKey!,
        followUpDate: _dateStr,
        followUpTime: _timeStr,
        note: _noteCtrl.text.trim(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_dueDate != null ? 'Saved & follow-up set' : 'Outcome saved')));
      _goToDetails();
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not save - try from Call Details')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = (widget.contactName?.isNotEmpty ?? false) ? widget.contactName! : widget.phone;
    final hasFollowUp = _dueDate != null;
    return Scaffold(
      backgroundColor: Brand.bg,
      appBar: AppBar(
        title: const Text('Call Outcome'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _goToDetails,
            child: const Text('Skip', style: TextStyle(color: Brand.muted, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                // call header
                Row(children: [
                  CircleAvatar(
                    radius: 22, backgroundColor: Brand.accent,
                    child: Text(title.isNotEmpty ? title[0].toUpperCase() : '?',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Brand.ink)),
                    Text([widget.direction, widget.outcome].where((s) => (s ?? '').isNotEmpty).join(' · '),
                        style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
                  ])),
                ]),
                const SizedBox(height: 22),

                _label('HOW DID IT GO?'),
                const SizedBox(height: 10),
                Wrap(spacing: 8, runSpacing: 8, children: _disps.map((d) {
                  final key = (d['key'] ?? '').toString();
                  final sel = key == _selectedKey;
                  final col = _dispColor((d['color'] ?? '').toString());
                  return InkWell(
                    onTap: () => setState(() => _selectedKey = sel ? null : key),
                    borderRadius: BorderRadius.circular(22),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: sel ? col.withValues(alpha: 0.14) : Colors.white,
                        borderRadius: BorderRadius.circular(22),
                        border: Border.all(color: sel ? col : const Color(0x1A000000), width: sel ? 1.5 : 1),
                      ),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        Text((d['icon'] ?? '').toString(), style: const TextStyle(fontSize: 15)),
                        const SizedBox(width: 7),
                        Text((d['label'] ?? '').toString(),
                            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13,
                                color: sel ? col : Brand.ink)),
                      ]),
                    ),
                  );
                }).toList()),
                const SizedBox(height: 24),

                _label('NEXT FOLLOW-UP'),
                const SizedBox(height: 10),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  _dateChip('Today', 0),
                  _dateChip('Tomorrow', 1),
                  _dateChip('In 2 days', 2),
                  _dateChip('In a week', 7),
                  _customDateChip(),
                ]),
                if (hasFollowUp) ...[
                  const SizedBox(height: 12),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    _timeChip('9 AM', const TimeOfDay(hour: 9, minute: 0)),
                    _timeChip('11 AM', const TimeOfDay(hour: 11, minute: 0)),
                    _timeChip('2 PM', const TimeOfDay(hour: 14, minute: 0)),
                    _timeChip('5 PM', const TimeOfDay(hour: 17, minute: 0)),
                    _customTimeChip(),
                  ]),
                  const SizedBox(height: 6),
                  Text(
                    'Follow-up: $_dateStr ${_dueTime != null ? _dueTime!.format(context) : '(9:00 AM)'}',
                    style: const TextStyle(color: Brand.accent, fontSize: 12.5, fontWeight: FontWeight.w600),
                  ),
                ],
                const SizedBox(height: 24),

                _label('NOTE (OPTIONAL)'),
                const SizedBox(height: 8),
                TextField(
                  controller: _noteCtrl,
                  maxLines: 2,
                  decoration: InputDecoration(
                    hintText: 'Add a quick note...',
                    filled: true, fillColor: Colors.white, isDense: true,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0x1A000000))),
                    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0x1A000000))),
                  ),
                ),
                const SizedBox(height: 24),

                SizedBox(
                  width: double.infinity, height: 50,
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: Brand.accent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text(hasFollowUp ? 'Save & set follow-up' : 'Save outcome',
                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _label(String t) => Text(t, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: Brand.muted, letterSpacing: 0.6));

  Widget _chip(String text, bool selected, VoidCallback onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: selected ? Brand.accent.withValues(alpha: 0.14) : Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: selected ? Brand.accent : const Color(0x1A000000), width: selected ? 1.5 : 1),
          ),
          child: Text(text, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: selected ? Brand.accent : Brand.ink)),
        ),
      );

  bool _isPreset(int days) {
    if (_dueDate == null) return false;
    final base = DateTime.now();
    final target = DateTime(base.year, base.month, base.day).add(Duration(days: days));
    return _dueDate!.year == target.year && _dueDate!.month == target.month && _dueDate!.day == target.day;
  }

  Widget _dateChip(String label, int days) => _chip(label, _isPreset(days), () {
        final base = DateTime.now();
        setState(() {
          _dueDate = DateTime(base.year, base.month, base.day).add(Duration(days: days));
          _dueTime ??= const TimeOfDay(hour: 9, minute: 0);
        });
      });

  Widget _customDateChip() {
    final isCustom = _dueDate != null && !_isPreset(0) && !_isPreset(1) && !_isPreset(2) && !_isPreset(7);
    return _chip(isCustom ? '📅 $_dateStr' : '📅 Custom', isCustom, () async {
      final now = DateTime.now();
      final d = await showDatePicker(context: context, initialDate: now.add(const Duration(days: 1)), firstDate: now, lastDate: now.add(const Duration(days: 365)));
      if (d != null) setState(() { _dueDate = DateTime(d.year, d.month, d.day); _dueTime ??= const TimeOfDay(hour: 9, minute: 0); });
    });
  }

  bool _isTime(TimeOfDay t) => _dueTime != null && _dueTime!.hour == t.hour && _dueTime!.minute == t.minute;

  Widget _timeChip(String label, TimeOfDay t) => _chip(label, _isTime(t), () => setState(() => _dueTime = t));

  Widget _customTimeChip() {
    final isCustom = _dueTime != null && !_isTime(const TimeOfDay(hour: 9, minute: 0)) && !_isTime(const TimeOfDay(hour: 11, minute: 0)) && !_isTime(const TimeOfDay(hour: 14, minute: 0)) && !_isTime(const TimeOfDay(hour: 17, minute: 0));
    return _chip(isCustom && _dueTime != null ? '🕐 ${_dueTime!.format(context)}' : '🕐 Custom', isCustom, () async {
      final t = await showTimePicker(context: context, initialTime: _dueTime ?? const TimeOfDay(hour: 9, minute: 0));
      if (t != null) setState(() => _dueTime = t);
    });
  }
}
