import 'package:flutter/material.dart';

import '../theme.dart';
import '../services/api.dart';
import '../services/call_launcher.dart';
import 'call_details_page.dart';

/// Follow-ups assigned to this device's staff (the registered number's user).
/// Set in the CRM → shows here. Tap to open the lead, call, or mark done.
class FollowupsPage extends StatefulWidget {
  const FollowupsPage({super.key});

  @override
  State<FollowupsPage> createState() => _FollowupsPageState();
}

class _FollowupsPageState extends State<FollowupsPage> {
  List<dynamic> _items = [];
  String _status = 'pending'; // pending | completed | all
  String _dateMode = 'today'; // today | all | single | range — defaults to today
  DateTime? _singleDate;
  DateTimeRange? _range;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      String? date, from, to;
      final now = DateTime.now();
      switch (_dateMode) {
        case 'today':
          date = _ymd(now);
          break;
        case 'single':
          if (_singleDate != null) date = _ymd(_singleDate!);
          break;
        case 'range':
          if (_range != null) { from = _ymd(_range!.start); to = _ymd(_range!.end); }
          break;
        // 'all' → no date filter
      }
      final list = await Api.instance.followups(status: _status, date: date, from: from, to: to);
      if (!mounted) return;
      setState(() { _items = list; _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickSingle() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _singleDate ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (d != null) { setState(() { _singleDate = d; _dateMode = 'single'; }); _load(); }
  }

  Future<void> _pickRange() async {
    final r = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
      initialDateRange: _range,
    );
    if (r != null) { setState(() { _range = r; _dateMode = 'range'; }); _load(); }
  }

  String _ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  String _shortDate(DateTime d) {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${m[d.month - 1]}';
  }

  Future<void> _complete(Map f, bool done) async {
    try {
      await Api.instance.completeFollowup(f['id'].toString(), completed: done);
      await _load();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not update')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Row(children: [
              const Text('Follow-ups', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Brand.ink)),
              const Spacer(),
              IconButton(onPressed: _load, icon: const Icon(Icons.refresh, color: Brand.muted)),
            ]),
          ),
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                _chip('Pending', 'pending'),
                _chip('Completed', 'completed'),
                _chip('All', 'all'),
              ],
            ),
          ),
          // Date filter — defaults to Today; pick a single day or a from–to range.
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                _dateChip(label: 'Today', active: _dateMode == 'today',
                    onTap: () { setState(() => _dateMode = 'today'); _load(); }),
                _dateChip(label: 'All dates', active: _dateMode == 'all',
                    onTap: () { setState(() => _dateMode = 'all'); _load(); }),
                _dateChip(
                    icon: Icons.event,
                    label: _dateMode == 'single' && _singleDate != null ? _shortDate(_singleDate!) : 'Pick date',
                    active: _dateMode == 'single',
                    onTap: _pickSingle),
                _dateChip(
                    icon: Icons.date_range,
                    label: _dateMode == 'range' && _range != null
                        ? '${_shortDate(_range!.start)} – ${_shortDate(_range!.end)}'
                        : 'Date range',
                    active: _dateMode == 'range',
                    onTap: _pickRange),
              ],
            ),
          ),
          const Divider(height: 1, color: Color(0x12000000)),
          Expanded(child: _list()),
        ],
      ),
    );
  }

  Widget _chip(String label, String value) {
    final active = _status == value;
    return Padding(
      padding: const EdgeInsets.only(right: 8, top: 6, bottom: 6),
      child: ChoiceChip(
        label: Text(label),
        selected: active,
        onSelected: (_) { setState(() => _status = value); _load(); },
        selectedColor: const Color(0x1AEA580C),
        backgroundColor: Colors.white,
        side: BorderSide(color: active ? Brand.accent : const Color(0x1A000000)),
        labelStyle: TextStyle(color: active ? Brand.accent : Brand.ink, fontWeight: active ? FontWeight.w700 : FontWeight.w500, fontSize: 13),
      ),
    );
  }

  Widget _dateChip({required String label, required bool active, required VoidCallback onTap, IconData? icon}) {
    return Padding(
      padding: const EdgeInsets.only(right: 8, top: 6, bottom: 6),
      child: ChoiceChip(
        avatar: icon != null ? Icon(icon, size: 16, color: active ? Brand.accent : Brand.muted) : null,
        label: Text(label),
        selected: active,
        onSelected: (_) => onTap(),
        selectedColor: const Color(0x1AEA580C),
        backgroundColor: Colors.white,
        side: BorderSide(color: active ? Brand.accent : const Color(0x1A000000)),
        labelStyle: TextStyle(color: active ? Brand.accent : Brand.ink, fontWeight: active ? FontWeight.w700 : FontWeight.w500, fontSize: 13),
      ),
    );
  }

  String _emptyMessage() {
    switch (_dateMode) {
      case 'today':
        return 'No follow-ups for today';
      case 'single':
        return _singleDate != null ? 'No follow-ups on ${_shortDate(_singleDate!)}' : 'No follow-ups';
      case 'range':
        return _range != null
            ? 'No follow-ups from ${_shortDate(_range!.start)} to ${_shortDate(_range!.end)}'
            : 'No follow-ups';
      default:
        return 'No follow-ups';
    }
  }

  Widget _list() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_items.isEmpty) {
      return Center(child: Text(_emptyMessage(), style: const TextStyle(color: Brand.muted)));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        itemCount: _items.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _tile(_items[i] as Map),
      ),
    );
  }

  Widget _tile(Map f) {
    final title = (f['title'] ?? 'Follow-up').toString();
    final leadName = (f['lead_name'] ?? '').toString();
    final phone = (f['lead_phone'] ?? '').toString();
    final desc = (f['description'] ?? '').toString();
    final completed = f['completed'] == true;
    final due = DateTime.tryParse((f['due_at'] ?? '').toString())?.toLocal();
    final overdue = !completed && due != null && due.isBefore(DateTime.now());

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: overdue ? const Color(0x33DC2626) : const Color(0x12000000)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        onTap: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => CallDetailsPage(
            phone: phone,
            leadId: (f['lead_id'] ?? '').toString().isNotEmpty ? f['lead_id'].toString() : null,
            contactName: leadName.isNotEmpty ? leadName : null,
          ),
        )),
        leading: IconButton(
          icon: Icon(completed ? Icons.check_circle : Icons.radio_button_unchecked,
              color: completed ? const Color(0xFF16A34A) : Brand.muted),
          onPressed: () => _complete(f, !completed),
        ),
        title: Text(title,
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: Brand.ink,
              decoration: completed ? TextDecoration.lineThrough : null,
            )),
        subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (leadName.isNotEmpty || phone.isNotEmpty)
            Text([leadName, phone].where((s) => s.isNotEmpty).join(' · '), style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
          if (desc.isNotEmpty) Text(desc, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.muted, fontSize: 12)),
          if (due != null)
            Text(_fmtDue(due),
                style: TextStyle(color: overdue ? const Color(0xFFDC2626) : Brand.accent, fontSize: 11.5, fontWeight: FontWeight.w600)),
        ]),
        trailing: phone.isEmpty
            ? null
            : IconButton(
                icon: const CircleAvatar(radius: 18, backgroundColor: Color(0xFF16A34A), child: Icon(Icons.call, color: Colors.white, size: 18)),
                onPressed: () => CallLauncher.start(context, phone),
              ),
      ),
    );
  }

  String _fmtDue(DateTime d) {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final hh = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final ap = d.hour < 12 ? 'AM' : 'PM';
    final now = DateTime.now();
    final overdue = d.isBefore(now);
    final prefix = overdue ? 'Overdue · ' : 'Due ';
    return '$prefix${d.day} ${m[d.month - 1]}, $hh:${d.minute.toString().padLeft(2, '0')} $ap';
  }
}
