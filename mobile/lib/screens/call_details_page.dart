import 'package:flutter/material.dart';

import '../theme.dart';
import '../services/api.dart';
import '../services/call_launcher.dart';

/// Shown after a call ends (or when a CRM-leads call is tapped). Looks up the number
/// in the CRM:
///  - existing lead  → shows its pipeline, stage and notes; lets the agent add a note
///    and move the stage.
///  - new number     → a form (name, pipeline + stage dropdowns, notes) that creates
///    the lead in CRM lead management on "Create lead".
class CallDetailsPage extends StatefulWidget {
  const CallDetailsPage({
    super.key,
    required this.phone,
    this.contactName,
    this.direction,
    this.outcome,
    this.durationSeconds,
  });

  final String phone;
  final String? contactName;
  final String? direction; // INBOUND / OUTBOUND
  final String? outcome; // ANSWERED / MISSED / ...
  final int? durationSeconds;

  @override
  State<CallDetailsPage> createState() => _CallDetailsPageState();
}

class _CallDetailsPageState extends State<CallDetailsPage> {
  bool _loading = true;
  bool _saving = false;
  bool _found = false;
  Map _lead = {};
  List<dynamic> _notes = [];
  List<dynamic> _pipelines = []; // [{id,name,stages:[{id,name}]}]

  // Form state (shared by new + existing-stage-change)
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
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
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final pls = await Api.instance.pipelines();
      final look = await Api.instance.lookupLead(widget.phone);
      if (!mounted) return;
      final found = look['found'] == true;
      setState(() {
        _pipelines = pls;
        _found = found;
        _lead = found ? Map.from(look['lead'] ?? {}) : {};
        _notes = found ? (look['notes'] as List? ?? []) : [];
        if (found) {
          _pipelineId = _lead['pipeline_id']?.toString();
          _stageId = _lead['stage_id']?.toString();
        } else {
          _nameCtrl.text = widget.contactName ?? '';
        }
        _loading = false;
      });
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

  void _toast(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? const Color(0xFFDC2626) : const Color(0xFF16A34A),
    ));
  }

  Future<void> _createLead() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) { _toast('Enter a name', error: true); return; }
    setState(() => _saving = true);
    try {
      await Api.instance.createLead(
        name: name,
        phone: widget.phone,
        pipelineId: _pipelineId,
        stageId: _stageId,
        email: _emailCtrl.text.trim(),
        notes: _noteCtrl.text.trim(),
      );
      _toast('Lead created in CRM');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      _toast('Could not create lead', error: true);
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveExisting() async {
    setState(() => _saving = true);
    try {
      await Api.instance.updateLead(
        _lead['id'].toString(),
        stageId: _stageId,
        note: _noteCtrl.text.trim(),
      );
      _toast('Lead updated');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      _toast('Could not update lead', error: true);
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Call Details')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _callHeader(),
                  const SizedBox(height: 18),
                  if (_found) ..._existingLeadView() else ..._newLeadForm(),
                ],
              ),
            ),
    );
  }

  Widget _callHeader() {
    final meta = <String>[];
    if (widget.direction != null) meta.add(widget.direction == 'OUTBOUND' ? 'Outgoing' : 'Incoming');
    if (widget.outcome != null) meta.add(widget.outcome!);
    if ((widget.durationSeconds ?? 0) > 0) meta.add('${widget.durationSeconds}s');
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x12000000)),
      ),
      child: Row(
        children: [
          const CircleAvatar(
            backgroundColor: Color(0x14EA580C),
            child: Icon(Icons.person, color: Brand.accent),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.phone, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Brand.ink)),
                if (meta.isNotEmpty)
                  Text(meta.join(' · '), style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
              ],
            ),
          ),
          IconButton(
            icon: const CircleAvatar(radius: 20, backgroundColor: Color(0xFF16A34A), child: Icon(Icons.call, color: Colors.white, size: 20)),
            onPressed: () => CallLauncher.start(context, widget.phone),
          ),
        ],
      ),
    );
  }

  // ── Existing lead ──────────────────────────────────────────────────────────
  List<Widget> _existingLeadView() {
    final name = (_lead['name'] ?? '').toString();
    final pipeline = (_lead['pipeline'] ?? '').toString();
    return [
      _sectionTitle('Lead'),
      _infoRow('Name', name.isNotEmpty ? name : '—'),
      _infoRow('Pipeline', pipeline.isNotEmpty ? pipeline : '—'),
      const SizedBox(height: 14),
      _sectionTitle('Move stage'),
      _stageDropdown(_pipelineId),
      const SizedBox(height: 14),
      _sectionTitle('Add note'),
      _noteField(),
      if (_notes.isNotEmpty) ...[
        const SizedBox(height: 16),
        _sectionTitle('Recent notes'),
        ..._notes.map((n) => _noteItem(n as Map)),
      ],
      const SizedBox(height: 22),
      _primaryButton(_saving ? 'Saving…' : 'Save', _saving ? null : _saveExisting),
    ];
  }

  // ── New lead form ──────────────────────────────────────────────────────────
  List<Widget> _newLeadForm() {
    return [
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0x0FEA580C),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Text('New number — not in CRM. Fill the details to create a lead.',
            style: TextStyle(color: Brand.accent, fontSize: 12.5, fontWeight: FontWeight.w600)),
      ),
      const SizedBox(height: 16),
      _sectionTitle('Name'),
      TextField(controller: _nameCtrl, decoration: const InputDecoration(hintText: 'Lead name')),
      const SizedBox(height: 14),
      _sectionTitle('Pipeline'),
      _pipelineDropdown(),
      const SizedBox(height: 14),
      _sectionTitle('Stage'),
      _stageDropdown(_pipelineId),
      const SizedBox(height: 14),
      _sectionTitle('Email (optional)'),
      TextField(controller: _emailCtrl, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(hintText: 'name@email.com')),
      const SizedBox(height: 14),
      _sectionTitle('Notes'),
      _noteField(),
      const SizedBox(height: 22),
      _primaryButton(_saving ? 'Creating…' : 'Create lead', _saving ? null : _createLead),
    ];
  }

  Widget _pipelineDropdown() {
    return _dropdownBox(
      child: DropdownButton<String?>(
        isExpanded: true,
        value: _pipelineId,
        hint: const Text('Select pipeline'),
        items: _pipelines
            .map<DropdownMenuItem<String?>>((p) => DropdownMenuItem<String?>(
                  value: p['id'].toString(),
                  child: Text((p['name'] ?? '').toString(), overflow: TextOverflow.ellipsis),
                ))
            .toList(),
        onChanged: (v) => setState(() { _pipelineId = v; _stageId = null; }),
      ),
    );
  }

  Widget _stageDropdown(String? pipelineId) {
    final stages = _stagesFor(pipelineId);
    return _dropdownBox(
      child: DropdownButton<String?>(
        isExpanded: true,
        value: stages.any((s) => s['id'].toString() == _stageId) ? _stageId : null,
        hint: Text(pipelineId == null ? 'Select a pipeline first' : 'Select stage'),
        items: stages
            .map<DropdownMenuItem<String?>>((s) => DropdownMenuItem<String?>(
                  value: s['id'].toString(),
                  child: Text((s['name'] ?? '').toString(), overflow: TextOverflow.ellipsis),
                ))
            .toList(),
        onChanged: stages.isEmpty ? null : (v) => setState(() => _stageId = v),
      ),
    );
  }

  Widget _noteField() => TextField(
        controller: _noteCtrl,
        maxLines: 3,
        decoration: const InputDecoration(hintText: 'Add a note about this call…'),
      );

  // ── small UI helpers ───────────────────────────────────────────────────────
  Widget _sectionTitle(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(t, style: const TextStyle(fontWeight: FontWeight.w800, color: Brand.ink, fontSize: 14)),
      );

  Widget _infoRow(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            SizedBox(width: 90, child: Text(label, style: const TextStyle(color: Brand.muted, fontSize: 13))),
            Expanded(child: Text(value, style: const TextStyle(color: Brand.ink, fontWeight: FontWeight.w600))),
          ],
        ),
      );

  Widget _noteItem(Map n) {
    final detail = (n['detail'] ?? n['title'] ?? '').toString();
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0x12000000)),
      ),
      child: Text(detail, style: const TextStyle(color: Brand.ink, fontSize: 13)),
    );
  }

  Widget _dropdownBox({required Widget child}) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0x14000000)),
        ),
        child: DropdownButtonHideUnderline(child: child),
      );

  Widget _primaryButton(String label, VoidCallback? onTap) => FilledButton(
        onPressed: onTap,
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50), backgroundColor: Brand.accent),
        child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
      );
}
