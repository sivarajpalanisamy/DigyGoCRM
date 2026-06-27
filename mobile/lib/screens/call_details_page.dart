import 'package:flutter/material.dart';

import '../theme.dart';
import '../services/api.dart';
import '../services/call_launcher.dart';
import '../services/dialer_data.dart';

/// Opened after a call ends, or when a call/lead is tapped. Looks the number up in
/// the CRM:
///  - existing lead → full Lead Details (mirrors the CRM panel): info, tags, custom
///    fields, quick actions (stage, WhatsApp, follow-up, appointment, tag, note),
///    activity timeline and this lead's calls.
///  - new number    → a form (name, pipeline + stage, notes) that creates the lead.
class CallDetailsPage extends StatefulWidget {
  const CallDetailsPage({
    super.key,
    required this.phone,
    this.leadId,
    this.contactName,
    this.direction,
    this.outcome,
    this.durationSeconds,
  });

  final String phone;
  final String? leadId; // when opened from CRM Leads (skip phone lookup)
  final String? contactName;
  final String? direction;
  final String? outcome;
  final int? durationSeconds;

  @override
  State<CallDetailsPage> createState() => _CallDetailsPageState();
}

class _CallDetailsPageState extends State<CallDetailsPage> {
  bool _loading = true;
  bool _busy = false;
  bool _found = false;

  Map _lead = {};
  List<dynamic> _tags = [];
  List<dynamic> _activities = [];
  List<dynamic> _calls = [];
  List<dynamic> _pipelines = [];

  // new-lead form
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  String? _pipelineId;
  String? _stageId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final pls = await Api.instance.pipelines();
      String? leadId = widget.leadId;
      if (leadId == null) {
        final look = await Api.instance.lookupLead(widget.phone);
        if (look['found'] == true) leadId = (look['lead']?['id'] ?? '').toString();
      }
      if (leadId != null && leadId.isNotEmpty) {
        final d = await Api.instance.leadDetails(leadId);
        if (!mounted) return;
        setState(() {
          _pipelines = pls;
          _found = true;
          _lead = Map.from(d['lead'] ?? {});
          _tags = d['tags'] as List? ?? [];
          _activities = d['activities'] as List? ?? [];
          _calls = d['calls'] as List? ?? [];
          _loading = false;
        });
      } else {
        if (!mounted) return;
        setState(() {
          _pipelines = pls;
          _found = false;
          _nameCtrl.text = widget.contactName ?? '';
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<dynamic> _stagesFor(String? pipelineId) {
    if (pipelineId == null) return [];
    for (final p in _pipelines) {
      if (p['id'].toString() == pipelineId) return (p['stages'] as List? ?? []);
    }
    return [];
  }

  void _toast(String m, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(m),
      backgroundColor: error ? const Color(0xFFDC2626) : const Color(0xFF16A34A),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_found ? 'Lead Details' : 'Call Details')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : (_found ? _detailsView() : _newLeadForm()),
    );
  }

  // ── Existing lead: full details ─────────────────────────────────────────────
  Widget _detailsView() {
    final name = (_lead['name'] ?? '').toString();
    final phone = (_lead['phone'] ?? widget.phone).toString();
    final email = (_lead['email'] ?? '').toString();
    final pipeline = (_lead['pipeline'] ?? '').toString();
    final stage = (_lead['stage'] ?? '').toString();
    final assigned = (_lead['assigned_name'] ?? '').toString();
    final source = (_lead['source'] ?? '').toString();
    final deal = (_lead['deal_value'] ?? 0).toString();
    final display = name.isNotEmpty ? name : phone;
    final cf = (_lead['custom_fields'] is Map) ? Map<String, dynamic>.from(_lead['custom_fields']) : <String, dynamic>{};
    cf.removeWhere((k, v) => v == null || v.toString().isEmpty || k.startsWith('_'));

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 40),
      children: [
        // Header
        Row(children: [
          CircleAvatar(
            radius: 26,
            backgroundColor: Brand.accent,
            child: Text(display.isNotEmpty ? display[0].toUpperCase() : '?',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 20)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(display, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Brand.ink)),
              Text('Deal value: ₹$deal', style: const TextStyle(color: Brand.muted, fontSize: 13)),
            ]),
          ),
        ]),
        const SizedBox(height: 16),
        _infoCard([
          _infoRow(Icons.phone, phone, trailing: _miniCall(phone)),
          if (email.isNotEmpty) _infoRow(Icons.email_outlined, email),
          _infoRow(Icons.layers_outlined, [pipeline, stage].where((s) => s.isNotEmpty).join(' · ').ifEmpty('No pipeline')),
          _infoRow(Icons.person_outline, assigned.isNotEmpty ? assigned : 'Unassigned'),
          if (source.isNotEmpty) _infoRow(Icons.sell_outlined, source),
        ]),
        const SizedBox(height: 14),
        // Tags
        _sectionTitle('Tags'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          ..._tags.map((t) => Chip(
                label: Text((t['name'] ?? '').toString(), style: const TextStyle(fontSize: 12)),
                backgroundColor: const Color(0x14EA580C),
                side: BorderSide.none,
              )),
          ActionChip(
            avatar: const Icon(Icons.add, size: 16, color: Brand.accent),
            label: const Text('Add tag', style: TextStyle(color: Brand.accent, fontSize: 12)),
            onPressed: _addTag,
          ),
        ]),
        if (cf.isNotEmpty) ...[
          const SizedBox(height: 14),
          _sectionTitle('Additional Fields (${cf.length})'),
          _infoCard(cf.entries.map((e) => _kv(e.key, e.value.toString())).toList()),
        ],
        const SizedBox(height: 6),
        _timeRow('Created', _lead['created_at']),
        _timeRow('Updated', _lead['updated_at']),
        const SizedBox(height: 16),
        // Quick actions
        _sectionTitle('Quick Actions'),
        Row(children: [
          _quickAction(Icons.layers, 'Stage', _changeStage),
          _quickAction(Icons.chat, 'WhatsApp', () => DialerData.instance.whatsapp(phone)),
          _quickAction(Icons.access_time, 'Follow-up', () => _openFollowupDialog()),
          _quickAction(Icons.event, 'Appointment', () => _openFollowupDialog(defaultTitle: 'Appointment')),
        ]),
        const SizedBox(height: 18),
        // Activity timeline
        _sectionTitle('Activity Timeline'),
        if (_activities.isEmpty)
          const Text('No activity yet', style: TextStyle(color: Brand.muted, fontSize: 13))
        else
          ..._activities.map(_activityItem),
        const SizedBox(height: 18),
        // Calls
        _sectionTitle('Calls'),
        if (_calls.isEmpty)
          const Center(child: Padding(padding: EdgeInsets.all(12), child: Text('No calls yet', style: TextStyle(color: Brand.muted))))
        else
          ..._calls.map(_callItem),
      ],
    );
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  Future<void> _changeStage() async {
    if (_pipelines.isEmpty) { _toast('No pipelines found', error: true); return; }
    final curPipe = _lead['pipeline_id']?.toString();
    final curStage = _lead['stage_id']?.toString();

    final result = await showModalBottomSheet<Map<String, String>>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.92,
        builder: (_, sc) => ListView(
          controller: sc,
          padding: const EdgeInsets.fromLTRB(8, 12, 8, 24),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(12, 4, 12, 8),
              child: Text('Move to pipeline / stage', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            ),
            ..._pipelines.map((p) {
              final pid = p['id'].toString();
              final stages = (p['stages'] as List? ?? []);
              return ExpansionTile(
                initiallyExpanded: pid == curPipe,
                tilePadding: const EdgeInsets.symmetric(horizontal: 14),
                title: Row(children: [
                  Expanded(child: Text((p['name'] ?? '').toString(),
                      style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ink))),
                  _countBadge(p['leadCount'] ?? 0),
                ]),
                children: stages.isEmpty
                    ? [const Padding(padding: EdgeInsets.all(12), child: Text('No stages', style: TextStyle(color: Brand.muted)))]
                    : stages.map<Widget>((s) {
                        final sid = s['id'].toString();
                        return ListTile(
                          contentPadding: const EdgeInsets.only(left: 28, right: 16),
                          title: Text((s['name'] ?? '').toString()),
                          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                            if (pid == curPipe && sid == curStage)
                              const Padding(padding: EdgeInsets.only(right: 6), child: Icon(Icons.check, color: Brand.accent, size: 18)),
                            _countBadge(s['count'] ?? 0),
                          ]),
                          onTap: () => Navigator.pop(context, {'pipelineId': pid, 'stageId': sid}),
                        );
                      }).toList(),
              );
            }),
          ],
        ),
      ),
    );
    if (result == null) return;
    setState(() => _busy = true);
    try {
      await Api.instance.updateLead(_lead['id'].toString(), stageId: result['stageId'], pipelineId: result['pipelineId']);
      _toast('Lead moved');
      await _load();
    } catch (_) { _toast('Could not move lead', error: true); }
    if (mounted) setState(() => _busy = false);
  }

  Widget _countBadge(dynamic n) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: const Color(0x14EA580C), borderRadius: BorderRadius.circular(20)),
        child: Text('$n', style: const TextStyle(color: Brand.accent, fontSize: 12, fontWeight: FontWeight.w700)),
      );

  Future<void> _addTag() async {
    final ctrl = TextEditingController();
    final ok = await _inputSheet('Add tag', 'Tag name', ctrl);
    if (ok != true || ctrl.text.trim().isEmpty) return;
    try { await Api.instance.addTag(_lead['id'].toString(), ctrl.text.trim()); _toast('Tag added'); await _load(); }
    catch (_) { _toast('Could not add tag', error: true); }
  }

  // "Set Follow-Up" popup matching the CRM web: title (required), notes, due date+time,
  // and a "Save as note instead of follow-up" toggle.
  Future<void> _openFollowupDialog({String defaultTitle = ''}) async {
    final titleCtrl = TextEditingController(text: defaultTitle);
    final notesCtrl = TextEditingController();
    bool saveAsNote = false;
    DateTime? due;

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setLocal) {
        Future<void> pickDue() async {
          final d = await showDatePicker(
            context: ctx,
            initialDate: DateTime.now().add(const Duration(days: 1)),
            firstDate: DateTime.now().subtract(const Duration(days: 1)),
            lastDate: DateTime.now().add(const Duration(days: 365)),
          );
          if (d == null) return;
          final t = await showTimePicker(context: ctx, initialTime: const TimeOfDay(hour: 10, minute: 0));
          if (t == null) return;
          setLocal(() => due = DateTime(d.year, d.month, d.day, t.hour, t.minute));
        }

        InputDecoration dec(String hint) => InputDecoration(
              hintText: hint, isDense: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
            );

        return AlertDialog(
          backgroundColor: Colors.white,
          insetPadding: const EdgeInsets.symmetric(horizontal: 20),
          title: Row(children: [
            const Expanded(child: Text('Set Follow-Up', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18))),
            InkWell(onTap: () => Navigator.pop(ctx, false), child: const Icon(Icons.close, color: Brand.muted)),
          ]),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              InkWell(
                onTap: () => setLocal(() => saveAsNote = !saveAsNote),
                child: Row(children: [
                  Checkbox(value: saveAsNote, activeColor: Brand.accent, onChanged: (v) => setLocal(() => saveAsNote = v ?? false)),
                  const Expanded(child: Text('Save as note instead of follow-up', style: TextStyle(fontSize: 13))),
                ]),
              ),
              const SizedBox(height: 8),
              const Text.rich(TextSpan(children: [
                TextSpan(text: 'Title ', style: TextStyle(fontWeight: FontWeight.w700)),
                TextSpan(text: '*', style: TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.w700)),
              ])),
              const SizedBox(height: 6),
              TextField(controller: titleCtrl, decoration: dec('e.g. Call back for pre-sales pitch')),
              const SizedBox(height: 14),
              const Text('Notes', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              TextField(controller: notesCtrl, maxLines: 3, decoration: dec('Add any notes...')),
              if (!saveAsNote) ...[
                const SizedBox(height: 14),
                const Text('Due Date & Time', style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                InkWell(
                  onTap: pickDue,
                  child: InputDecorator(
                    decoration: dec('').copyWith(suffixIcon: const Icon(Icons.calendar_today, size: 18, color: Brand.muted)),
                    child: Text(
                      due == null ? 'dd-mm-yyyy --:--' : _fmt(due!.toIso8601String()),
                      style: TextStyle(color: due == null ? Brand.muted : Brand.ink),
                    ),
                  ),
                ),
              ],
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel', style: TextStyle(color: Brand.muted))),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Brand.accent),
              onPressed: () {
                if (titleCtrl.text.trim().isEmpty) {
                  ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Title is required')));
                  return;
                }
                if (!saveAsNote && due == null) {
                  ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Pick a due date & time')));
                  return;
                }
                Navigator.pop(ctx, true);
              },
              child: Text(saveAsNote ? 'Save note' : 'Schedule'),
            ),
          ],
        );
      }),
    );

    if (ok != true) return;
    final id = _lead['id'].toString();
    try {
      if (saveAsNote) {
        final noteText = [titleCtrl.text.trim(), notesCtrl.text.trim()].where((s) => s.isNotEmpty).join('\n');
        await Api.instance.updateLead(id, note: noteText);
        _toast('Note saved');
      } else {
        await Api.instance.addFollowup(id, dueAt: due!.toUtc().toIso8601String(), title: titleCtrl.text.trim(), note: notesCtrl.text.trim());
        _toast('Follow-up scheduled');
      }
      await _load();
    } catch (_) {
      _toast('Could not save', error: true);
    }
  }

  Future<bool?> _inputSheet(String title, String hint, TextEditingController ctrl, {int lines = 1}) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
          const SizedBox(height: 12),
          TextField(controller: ctrl, autofocus: true, maxLines: lines, decoration: InputDecoration(hintText: hint)),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Brand.accent, minimumSize: const Size.fromHeight(46)),
            child: const Text('Save'),
          ),
        ]),
      ),
    );
  }

  // ── New-lead form ───────────────────────────────────────────────────────────
  Widget _newLeadForm() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: Brand.accent, borderRadius: BorderRadius.circular(14)),
          child: Row(children: [
            const Icon(Icons.person_add, color: Colors.white),
            const SizedBox(width: 12),
            Expanded(child: Text(widget.phone, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16))),
            _miniCall(widget.phone, light: true),
          ]),
        ),
        const SizedBox(height: 8),
        const Text('New number - not in CRM. Create the lead:', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
        const SizedBox(height: 14),
        _sectionTitle('Name'),
        TextField(controller: _nameCtrl, decoration: const InputDecoration(hintText: 'Lead name')),
        const SizedBox(height: 14),
        _sectionTitle('Pipeline'),
        _dropdown(_pipelineId, 'Select pipeline',
            _pipelines.map((p) => DropdownMenuItem<String?>(value: p['id'].toString(), child: Text((p['name'] ?? '').toString()))).toList(),
            (v) => setState(() { _pipelineId = v; _stageId = null; })),
        const SizedBox(height: 14),
        _sectionTitle('Stage'),
        _dropdown(_stagesFor(_pipelineId).any((s) => s['id'].toString() == _stageId) ? _stageId : null,
            _pipelineId == null ? 'Select a pipeline first' : 'Select stage',
            _stagesFor(_pipelineId).map((s) => DropdownMenuItem<String?>(value: s['id'].toString(), child: Text((s['name'] ?? '').toString()))).toList(),
            _stagesFor(_pipelineId).isEmpty ? null : (v) => setState(() => _stageId = v)),
        const SizedBox(height: 14),
        _sectionTitle('Email (optional)'),
        TextField(controller: _emailCtrl, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(hintText: 'name@email.com')),
        const SizedBox(height: 14),
        _sectionTitle('Notes'),
        TextField(controller: _notesCtrl, maxLines: 3, decoration: const InputDecoration(hintText: 'Add a note…')),
        const SizedBox(height: 22),
        FilledButton(
          onPressed: _busy ? null : _createLead,
          style: FilledButton.styleFrom(backgroundColor: Brand.accent, minimumSize: const Size.fromHeight(50)),
          child: Text(_busy ? 'Creating…' : 'Create lead', style: const TextStyle(fontWeight: FontWeight.w700)),
        ),
      ],
    );
  }

  Future<void> _createLead() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) { _toast('Enter a name', error: true); return; }
    setState(() => _busy = true);
    try {
      await Api.instance.createLead(
        name: name, phone: widget.phone,
        pipelineId: _pipelineId, stageId: _stageId,
        email: _emailCtrl.text.trim(), notes: _notesCtrl.text.trim(),
      );
      _toast('Lead created in CRM');
      if (mounted) await _load(); // re-open as existing lead with full details
    } catch (_) {
      _toast('Could not create lead', error: true);
      if (mounted) setState(() => _busy = false);
    }
  }

  // ── small widgets ────────────────────────────────────────────────────────────
  Widget _sectionTitle(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8, top: 2),
        child: Text(t, style: const TextStyle(fontWeight: FontWeight.w800, color: Brand.ink, fontSize: 14)),
      );

  Widget _infoCard(List<Widget> children) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0x12000000))),
        child: Column(children: children),
      );

  Widget _infoRow(IconData icon, String value, {Widget? trailing}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 9),
        child: Row(children: [
          Icon(icon, size: 18, color: Brand.muted),
          const SizedBox(width: 12),
          Expanded(child: Text(value, style: const TextStyle(color: Brand.ink, fontSize: 14))),
          if (trailing != null) trailing,
        ]),
      );

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 120, child: Text(k, style: const TextStyle(color: Brand.muted, fontSize: 13))),
          Expanded(child: Text(v, style: const TextStyle(color: Brand.ink, fontSize: 13.5, fontWeight: FontWeight.w600))),
        ]),
      );

  Widget _timeRow(String label, dynamic iso) {
    final s = _fmt(iso);
    if (s.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [
        Text('$label  ', style: const TextStyle(color: Brand.muted, fontSize: 12)),
        Text(s, style: const TextStyle(color: Brand.ink, fontSize: 12, fontWeight: FontWeight.w600)),
      ]),
    );
  }

  Widget _quickAction(IconData icon, String label, VoidCallback onTap) => Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 3),
          child: InkWell(
            onTap: _busy ? null : onTap,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0x14000000))),
              child: Column(children: [
                Icon(icon, color: Brand.accent, size: 22),
                const SizedBox(height: 6),
                Text(label, style: const TextStyle(fontSize: 11.5, color: Brand.ink, fontWeight: FontWeight.w600)),
              ]),
            ),
          ),
        ),
      );

  Widget _activityItem(dynamic a) {
    final title = (a['title'] ?? '').toString();
    final detail = (a['detail'] ?? '').toString();
    final by = (a['by_name'] ?? '').toString();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Padding(padding: EdgeInsets.only(top: 3), child: Icon(Icons.circle, size: 8, color: Brand.accent)),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(color: Brand.ink, fontWeight: FontWeight.w600, fontSize: 13.5)),
            if (detail.isNotEmpty) Text(detail, style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
            Text([_fmt(a['created_at']), if (by.isNotEmpty) '- $by'].join('  '), style: const TextStyle(color: Brand.muted, fontSize: 11)),
          ]),
        ),
      ]),
    );
  }

  Widget _callItem(dynamic c) {
    final dir = (c['direction'] ?? '').toString();
    final outcome = (c['outcome'] ?? '').toString();
    final dur = (c['duration_seconds'] ?? 0);
    final isOut = dir == 'OUTBOUND';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(children: [
        Icon(isOut ? Icons.call_made : Icons.call_received, size: 18, color: isOut ? Brand.accent : const Color(0xFF16A34A)),
        const SizedBox(width: 10),
        Expanded(child: Text('${isOut ? 'Outgoing' : 'Incoming'} · $outcome', style: const TextStyle(color: Brand.ink, fontSize: 13))),
        Text([_fmt(c['started_at']), if ((dur as int) > 0) '${dur}s'].join('  '), style: const TextStyle(color: Brand.muted, fontSize: 11.5)),
      ]),
    );
  }

  Widget _miniCall(String phone, {bool light = false}) => InkWell(
        onTap: () => CallLauncher.start(context, phone),
        child: CircleAvatar(radius: 16, backgroundColor: light ? Colors.white : const Color(0xFF16A34A),
            child: Icon(Icons.call, size: 17, color: light ? const Color(0xFF16A34A) : Colors.white)),
      );

  Widget _dropdown(String? value, String hint, List<DropdownMenuItem<String?>> items, ValueChanged<String?>? onChanged) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0x14000000))),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String?>(isExpanded: true, value: value, hint: Text(hint), items: items, onChanged: onChanged),
        ),
      );

  String _fmt(dynamic iso) {
    if (iso == null) return '';
    final d = DateTime.tryParse(iso.toString())?.toLocal();
    if (d == null) return '';
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final hh = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final ap = d.hour < 12 ? 'AM' : 'PM';
    return '${d.day} ${m[d.month - 1]} ${d.year}, $hh:${d.minute.toString().padLeft(2, '0')} $ap';
  }
}

extension _IfEmpty on String {
  String ifEmpty(String fallback) => isEmpty ? fallback : this;
}
