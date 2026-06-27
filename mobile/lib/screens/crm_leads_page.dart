import 'package:flutter/material.dart';

import '../theme.dart';
import '../services/api.dart';
import '../services/call_launcher.dart';
import 'call_details_page.dart';

/// CRM Leads — shows the leads the agent can see (respects only_assigned / view_all),
/// filterable by pipeline ("All Pipelines" + each pipeline) and by the stages the
/// owner created in the CRM. Each lead shows name, mobile number, and a call button.
class CrmLeadsPage extends StatefulWidget {
  const CrmLeadsPage({super.key});

  @override
  State<CrmLeadsPage> createState() => _CrmLeadsPageState();
}

class _Pipeline {
  final String id;
  final String name;
  final List<_Stage> stages;
  _Pipeline(this.id, this.name, this.stages);
}

class _Stage {
  final String id;
  final String name;
  _Stage(this.id, this.name);
}

class _CrmLeadsPageState extends State<CrmLeadsPage> {
  static const int _pageSize = 50;

  List<_Pipeline> _pipelines = [];
  List<dynamic> _leads = [];
  String? _pipelineId; // null = All Pipelines
  String? _stageId; // null = All stages
  String _search = '';
  bool _loadingPipelines = true;
  bool _loadingLeads = true;

  final ScrollController _scrollCtrl = ScrollController();
  int _offset = 0;
  bool _hasMore = true;
  bool _loadingMore = false;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _loadPipelines();
    _loadLeads();
  }

  @override
  void dispose() {
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollCtrl.hasClients &&
        _scrollCtrl.position.pixels >= _scrollCtrl.position.maxScrollExtent - 300) {
      _loadMore();
    }
  }

  Future<void> _loadPipelines() async {
    try {
      final raw = await Api.instance.pipelines();
      final list = raw.map<_Pipeline>((p) {
        final stages = ((p['stages'] as List?) ?? [])
            .map<_Stage>((s) => _Stage(s['id'].toString(), (s['name'] ?? '').toString()))
            .toList();
        return _Pipeline(p['id'].toString(), (p['name'] ?? '').toString(), stages);
      }).toList();
      if (!mounted) return;
      setState(() {
        _pipelines = list;
        _loadingPipelines = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingPipelines = false);
    }
  }

  // Load the first page (replaces the list). Called on mount, filter change, refresh.
  Future<void> _loadLeads() async {
    setState(() {
      _loadingLeads = true;
      _offset = 0;
      _hasMore = true;
    });
    try {
      final page = await Api.instance.leads(
        pipelineId: _pipelineId,
        stageId: _stageId,
        search: _search,
        offset: 0,
        limit: _pageSize,
      );
      if (!mounted) return;
      setState(() {
        _leads = page.items;
        _offset = page.items.length;
        _hasMore = page.hasMore;
        _loadingLeads = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingLeads = false);
    }
  }

  // Append the next page (infinite scroll).
  Future<void> _loadMore() async {
    if (_loadingMore || _loadingLeads || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await Api.instance.leads(
        pipelineId: _pipelineId,
        stageId: _stageId,
        search: _search,
        offset: _offset,
        limit: _pageSize,
      );
      if (!mounted) return;
      setState(() {
        _leads = [..._leads, ...page.items];
        _offset += page.items.length;
        _hasMore = page.hasMore;
        _loadingMore = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  _Pipeline? get _selectedPipeline {
    if (_pipelineId == null) return null;
    for (final p in _pipelines) {
      if (p.id == _pipelineId) return p;
    }
    return null;
  }

  void _selectPipeline(String? id) {
    setState(() {
      _pipelineId = id;
      _stageId = null; // reset stage when pipeline changes
    });
    _loadLeads();
  }

  void _selectStage(String? id) {
    setState(() => _stageId = id);
    _loadLeads();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Row(
              children: [
                const Text('CRM Leads',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Brand.ink)),
                const Spacer(),
                IconButton(
                  onPressed: () { _loadPipelines(); _loadLeads(); },
                  icon: const Icon(Icons.refresh, color: Brand.muted),
                ),
              ],
            ),
          ),
          // Search
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search name or number',
                prefixIcon: const Icon(Icons.search, size: 20, color: Brand.muted),
                isDense: true,
              ),
              onChanged: (v) => _search = v,
              onSubmitted: (_) => _loadLeads(),
            ),
          ),
          // Pipeline selector
          _pipelineSelector(),
          // Stage chips (only when a specific pipeline is chosen)
          if (_selectedPipeline != null && _selectedPipeline!.stages.isNotEmpty) _stageChips(),
          const Divider(height: 1, color: Color(0x12000000)),
          // Leads list
          Expanded(child: _leadsList()),
        ],
      ),
    );
  }

  Widget _pipelineSelector() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 2, 20, 8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0x14000000)),
        ),
        child: Row(
          children: [
            const Icon(Icons.filter_list, size: 18, color: Brand.accent),
            const SizedBox(width: 8),
            Expanded(
              child: _loadingPipelines
                  ? const Text('Loading pipelines…', style: TextStyle(color: Brand.muted))
                  : DropdownButtonHideUnderline(
                      child: DropdownButton<String?>(
                        isExpanded: true,
                        value: _pipelineId,
                        hint: const Text('All Pipelines'),
                        items: [
                          const DropdownMenuItem<String?>(value: null, child: Text('All Pipelines')),
                          ..._pipelines.map((p) =>
                              DropdownMenuItem<String?>(value: p.id, child: Text(p.name, overflow: TextOverflow.ellipsis))),
                        ],
                        onChanged: _selectPipeline,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _stageChips() {
    final stages = _selectedPipeline!.stages;
    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          _chip('All', _stageId == null, () => _selectStage(null)),
          ...stages.map((s) => _chip(s.name, _stageId == s.id, () => _selectStage(s.id))),
        ],
      ),
    );
  }

  Widget _chip(String label, bool active, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(right: 8, top: 6, bottom: 6),
      child: ChoiceChip(
        label: Text(label),
        selected: active,
        onSelected: (_) => onTap(),
        selectedColor: const Color(0x1AEA580C),
        labelStyle: TextStyle(
          color: active ? Brand.accent : Brand.ink,
          fontWeight: active ? FontWeight.w700 : FontWeight.w500,
          fontSize: 13,
        ),
        backgroundColor: Colors.white,
        side: BorderSide(color: active ? Brand.accent : const Color(0x1A000000)),
      ),
    );
  }

  Widget _leadsList() {
    if (_loadingLeads) return const Center(child: CircularProgressIndicator());
    if (_leads.isEmpty) {
      return const Center(
        child: Text('No leads found', style: TextStyle(color: Brand.muted)),
      );
    }
    final showFooter = _hasMore || _loadingMore;
    return RefreshIndicator(
      onRefresh: _loadLeads,
      child: ListView.separated(
        controller: _scrollCtrl,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        itemCount: _leads.length + (showFooter ? 1 : 0),
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          if (i >= _leads.length) {
            // Footer: spinner while the next page loads.
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Center(
                child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
              ),
            );
          }
          return _leadTile(_leads[i] as Map);
        },
      ),
    );
  }

  Widget _leadTile(Map lead) {
    final name = (lead['name'] ?? '').toString().trim();
    final phone = (lead['phone'] ?? '').toString().trim();
    final stage = (lead['stage'] ?? '').toString();
    final pipeline = (lead['pipeline'] ?? '').toString();
    final display = name.isNotEmpty ? name : (phone.isNotEmpty ? phone : 'Unknown');
    final subtitleBits = <String>[];
    if (phone.isNotEmpty) subtitleBits.add(phone);
    final tagBits = <String>[];
    if (pipeline.isNotEmpty) tagBits.add(pipeline);
    if (stage.isNotEmpty) tagBits.add(stage);

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0x12000000)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        onTap: phone.isEmpty
            ? null
            : () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => CallDetailsPage(phone: phone, contactName: name.isNotEmpty ? name : null),
                )),
        leading: CircleAvatar(
          backgroundColor: const Color(0x14EA580C),
          child: Text(
            (display.isNotEmpty ? display[0] : '?').toUpperCase(),
            style: const TextStyle(color: Brand.accent, fontWeight: FontWeight.w800),
          ),
        ),
        title: Text(display, style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ink)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (subtitleBits.isNotEmpty)
              Text(subtitleBits.join(' · '), style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
            if (tagBits.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(tagBits.join('  ›  '),
                    style: const TextStyle(color: Brand.accent, fontSize: 11.5, fontWeight: FontWeight.w600)),
              ),
          ],
        ),
        trailing: phone.isEmpty
            ? null
            : IconButton(
                icon: const CircleAvatar(
                  radius: 20,
                  backgroundColor: Color(0xFF16A34A),
                  child: Icon(Icons.call, color: Colors.white, size: 20),
                ),
                onPressed: () => CallLauncher.start(context, phone),
              ),
      ),
    );
  }
}
