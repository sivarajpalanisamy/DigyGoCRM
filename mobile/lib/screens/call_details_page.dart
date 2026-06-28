import 'package:flutter/material.dart';
import 'package:audioplayers/audioplayers.dart';

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
  bool _canAssign = false;

  // recording playback
  final AudioPlayer _player = AudioPlayer();
  String? _playingCallId;
  String? _loadingCallId;
  final Map<String, String> _recPath = {}; // callId -> local temp path

  // new-lead form
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  String? _pipelineId;
  String? _stageId;

  @override
  void initState() {
    super.initState();
    _player.onPlayerComplete.listen((_) { if (mounted) setState(() => _playingCallId = null); });
    _load();
  }

  @override
  void dispose() {
    _player.dispose();
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
          _canAssign = d['canAssign'] == true;
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
          _infoRow(Icons.person_outline, assigned.isNotEmpty ? assigned : 'Unassigned',
              trailing: _canAssign
                  ? TextButton(onPressed: _assignStaff, child: const Text('Assign', style: TextStyle(color: Brand.accent, fontWeight: FontWeight.w700)))
                  : null),
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
          _quickAction(Icons.access_time, 'Follow-up', () => _openDispositionDialog()),
          _quickAction(Icons.event, 'Appointment', () => _openFollowupDialog(defaultTitle: 'Appointment')),
        ]),
        const SizedBox(height: 18),
        // Activity timeline (full, incl. calls — recordings play inline on call rows)
        _sectionTitle('Activity Timeline'),
        if (_activities.isEmpty)
          const Text('No activity yet', style: TextStyle(color: Brand.muted, fontSize: 13))
        else
          ..._activities.map(_activityItem),
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

  // "Set Follow-Up" outcome picker matching the CRM web: "HOW DID IT GO?" outcome
  // chips (tenant dispositions) + optional note. Saving records the outcome on the
  // lead (sets quality + logs it on the timeline).
  Future<void> _openDispositionDialog() async {
    final id = (_lead['id'] ?? '').toString();
    if (id.isEmpty) { _toast('Open the lead first', error: true); return; }
    final disps = await Api.instance.dispositions();
    if (!mounted) return;
    if (disps.isEmpty) { _toast('No outcomes configured', error: true); return; }

    final noteCtrl = TextEditingController();
    String? selectedKey;
    bool saving = false;

    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setLocal) {
        return AlertDialog(
          backgroundColor: Colors.white,
          insetPadding: const EdgeInsets.symmetric(horizontal: 18),
          contentPadding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
          title: Row(children: [
            const Expanded(child: Text('Set Follow-Up', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18))),
            InkWell(onTap: saving ? null : () => Navigator.pop(ctx), child: const Icon(Icons.close, color: Brand.muted)),
          ]),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('HOW DID IT GO?', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: Brand.muted, letterSpacing: 0.6)),
              const SizedBox(height: 12),
              GridView.count(
                crossAxisCount: 3,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 0.95,
                children: disps.map((d) {
                  final key = (d['key'] ?? '').toString();
                  final sel = key == selectedKey;
                  final col = _dispColor((d['color'] ?? '').toString());
                  return InkWell(
                    onTap: saving ? null : () => setLocal(() => selectedKey = sel ? null : key),
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      decoration: BoxDecoration(
                        color: sel ? col.withValues(alpha: 0.12) : Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: sel ? col : const Color(0x1A000000), width: sel ? 1.5 : 1),
                      ),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Text((d['icon'] ?? '').toString(), style: const TextStyle(fontSize: 22)),
                        const SizedBox(height: 6),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          child: Text((d['label'] ?? '').toString(),
                              textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: sel ? col : Brand.ink)),
                        ),
                      ]),
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: noteCtrl,
                decoration: InputDecoration(
                  hintText: 'Add a note (optional)',
                  isDense: true,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity, height: 48,
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: Brand.accent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                  onPressed: saving ? null : () async {
                    if (selectedKey == null) {
                      ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Pick an outcome')));
                      return;
                    }
                    setLocal(() => saving = true);
                    try {
                      await Api.instance.leadDisposition(id, dispositionKey: selectedKey!, note: noteCtrl.text.trim());
                      if (ctx.mounted) Navigator.pop(ctx);
                      _toast('Outcome saved');
                      await _load();
                    } catch (_) {
                      setLocal(() => saving = false);
                      if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Could not save')));
                    }
                  },
                  child: saving
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Save outcome', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                ),
              ),
            ]),
          ),
        );
      }),
    );
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
    final type = (a['type'] ?? '').toString();
    final title = (a['title'] ?? '').toString();
    final by = (a['by_name'] ?? '').toString();
    final isCall = type == 'call';
    // For call rows, `detail` is the call_log id (used only for the player) — never shown.
    final callId = isCall ? (a['call_id'] ?? a['detail'] ?? '').toString() : '';
    final detail = isCall ? '' : (a['detail'] ?? '').toString();
    final hasRec = isCall && _callHasRec(callId);
    final playing = _playingCallId == callId;
    final loading = _loadingCallId == callId;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(isCall ? Icons.call : Icons.circle, size: isCall ? 14 : 8, color: Brand.accent),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(color: Brand.ink, fontWeight: FontWeight.w600, fontSize: 13.5)),
            if (detail.isNotEmpty) Text(detail, style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
            Text([_fmt(a['created_at']), if (by.isNotEmpty) '- $by'].join('  '), style: const TextStyle(color: Brand.muted, fontSize: 11)),
          ]),
        ),
        if (hasRec)
          loading
              ? const Padding(padding: EdgeInsets.all(8), child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
              : IconButton(
                  visualDensity: VisualDensity.compact,
                  icon: Icon(playing ? Icons.pause_circle_filled : Icons.play_circle_fill, color: Brand.accent, size: 30),
                  onPressed: () => _togglePlay(callId),
                ),
      ]),
    );
  }

  bool _callHasRec(String id) =>
      id.isNotEmpty && _calls.any((c) => c['id'].toString() == id && c['has_recording'] == true);

  // ── Recording player ─────────────────────────────────────────────────────────
  Future<void> _togglePlay(String id) async {
    if (_playingCallId == id) {
      await _player.pause();
      if (mounted) setState(() => _playingCallId = null);
      return;
    }
    await _player.stop();
    setState(() { _loadingCallId = id; _playingCallId = null; });
    try {
      final path = _recPath[id] ?? await Api.instance.downloadRecording(id);
      _recPath[id] = path;
      await _player.play(DeviceFileSource(path));
      if (mounted) setState(() { _playingCallId = id; _loadingCallId = null; });
    } catch (_) {
      if (mounted) setState(() => _loadingCallId = null);
      _toast('Could not play recording', error: true);
    }
  }

  // ── Assign staff ─────────────────────────────────────────────────────────────
  Future<void> _assignStaff() async {
    List<dynamic> staff;
    try { staff = await Api.instance.staff(); } catch (_) { _toast('Could not load staff', error: true); return; }
    if (!mounted) return;
    final cur = _lead['assigned_to']?.toString();
    final picked = await showModalBottomSheet<Map<String, String?>>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.9,
        builder: (_, sc) => ListView(controller: sc, children: [
          const Padding(padding: EdgeInsets.all(16), child: Text('Assign to', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
          ListTile(
            title: const Text('Unassigned'),
            trailing: cur == null ? const Icon(Icons.check, color: Brand.accent) : null,
            onTap: () => Navigator.pop(context, <String, String?>{'assignedTo': null}),
          ),
          ...staff.map((u) => ListTile(
                leading: CircleAvatar(backgroundColor: const Color(0x14EA580C),
                    child: Text(((u['name'] ?? '?').toString().isNotEmpty ? u['name'][0] : '?').toString().toUpperCase(), style: const TextStyle(color: Brand.accent, fontWeight: FontWeight.w700))),
                title: Text((u['name'] ?? '').toString()),
                subtitle: Text((u['email'] ?? '').toString(), style: const TextStyle(fontSize: 11.5)),
                trailing: u['id'].toString() == cur ? const Icon(Icons.check, color: Brand.accent) : null,
                onTap: () => Navigator.pop(context, <String, String?>{'assignedTo': u['id'].toString()}),
              )),
          const SizedBox(height: 12),
        ]),
      ),
    );
    if (picked == null) return;
    try {
      await Api.instance.assignLead(_lead['id'].toString(), picked['assignedTo']);
      _toast('Lead assigned');
      await _load();
    } catch (_) {
      _toast('Could not assign (check your permission)', error: true);
    }
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
