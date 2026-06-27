import 'package:call_log/call_log.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

import '../theme.dart';
import '../services/api.dart';
import '../services/native.dart';
import '../widgets/app_dialog.dart';

/// SIM setup — handles each SIM ONE AT A TIME: enter its number, verify it, then
/// move to the next SIM. First verified+CRM number links the device; the rest are
/// attached. Verification never blocks (app works locally either way).
class ConnectSimScreen extends StatefulWidget {
  const ConnectSimScreen({super.key, required this.onDone});
  final Future<void> Function() onDone;

  @override
  State<ConnectSimScreen> createState() => _ConnectSimScreenState();
}

enum _Stage { enter, verify }

class _ConnectSimScreenState extends State<ConnectSimScreen> {
  final _ccCtrl = TextEditingController(text: '91');
  final _numCtrl = TextEditingController();

  List<SimInfo> _sims = [];
  int _index = 0;
  _Stage _stage = _Stage.enter;
  String _currentPhone = '';
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadSims();
  }

  @override
  void dispose() {
    _ccCtrl.dispose();
    _numCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadSims() async {
    await Permission.phone.request();
    final sims = await Native.instance.getSims();
    if (!mounted) return;
    setState(() {
      _sims = sims.isNotEmpty ? sims : [SimInfo(slot: 0, displayName: 'SIM 1')];
      _loading = false;
      _prefillFor(0);
    });
  }

  void _prefillFor(int i) {
    final n = _sims[i].number;
    _numCtrl.text = (n != null && n.isNotEmpty) ? n.replaceAll(RegExp(r'^\+?91'), '') : '';
  }

  SimInfo get _sim => _sims[_index];
  int get _total => _sims.length;
  bool get _hasMore => _index + 1 < _total;

  void _submitNumber() {
    final num = _numCtrl.text.trim();
    if (num.length < 6) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a valid phone number')));
      return;
    }
    setState(() {
      _currentPhone = '+${_ccCtrl.text.trim()}$num';
      _stage = _Stage.verify;
    });
  }

  List<Map<String, dynamic>> get _simMaps =>
      _sims.map((s) => {'slot': s.slot, 'carrier': s.carrier, 'displayName': s.displayName}).toList();

  Future<void> _finish(String method) async {
    setState(() => _busy = true);
    try {
      if (method == 'skip') {
        // Skipped → NEVER link or sync this number. Just complete onboarding locally.
        await Api.instance.markSimStepDone();
      } else {
        // Verified in-app → remember it so it links (now or later) and syncs to the CRM.
        await Api.instance.addLocalNumber(_currentPhone);
        if (await Api.instance.hasDeviceToken()) {
          try {
            await Api.instance.addNumber(phone: _currentPhone, method: method, simSlot: _sim.slot);
          } on DioException catch (e) {
            if (e.response?.statusCode != 403) rethrow; // 403 = not in CRM yet → fine
          }
        } else {
          await Api.instance.registerNumber(
              phone: _currentPhone, method: method, simSlot: _sim.slot, sims: _simMaps);
        }
      }
      if (!mounted) return;
      if (_hasMore) {
        // Move to the next SIM's number entry.
        setState(() {
          _index++;
          _stage = _Stage.enter;
          _busy = false;
          _currentPhone = '';
          _prefillFor(_index);
        });
      } else {
        await widget.onDone();
      }
    } on DioException catch (_) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not connect. Check your connection or server URL.')),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Something went wrong. Please try again.')),
        );
      }
    }
  }

  // ── Verify actions ─────────────────────────────────────────────────────────
  Future<void> _verifyViaCallLog() async {
    final entries = (await CallLog.get()).where((e) => e.callType == CallType.outgoing).take(15).toList();
    if (!mounted) return;
    if (entries.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No outgoing calls found to verify with')));
      return;
    }
    final picked = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => _CallLogPicker(phone: _currentPhone, entries: entries),
    );
    if (picked == true) await _finish('call_log');
  }

  Future<void> _skip() async {
    final yes = await AppDialog.show(
      context,
      icon: Icons.block,
      danger: true,
      title: 'Skip verification?',
      message: "The app won't be able to confirm which SIM made a call and you may face issues with reports. "
          'You can verify later from More → SIM Number.',
      confirmText: 'Yes, skip',
      cancelText: 'No',
    );
    if (yes == true) await _finish('skip');
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_stage == _Stage.enter ? 'Connect SIM' : 'SIM Number')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _busy
              ? const Center(child: CircularProgressIndicator())
              : SafeArea(child: _stage == _Stage.enter ? _enterView() : _verifyView()),
    );
  }

  Widget _stepLabel() => _total > 1
      ? Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text('SIM ${_index + 1} of $_total',
              style: const TextStyle(color: Brand.muted, fontWeight: FontWeight.w600)),
        )
      : const SizedBox.shrink();

  Widget _enterView() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _stepLabel(),
          Row(children: [
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(color: const Color(0x14EA580C), borderRadius: BorderRadius.circular(11)),
              alignment: Alignment.center,
              child: Text('${_sim.slot + 1}',
                  style: const TextStyle(color: Brand.accent, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(_sim.label,
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18, color: Brand.ink))),
          ]),
          const SizedBox(height: 8),
          const Text('Enter the phone number for this SIM.',
              style: TextStyle(color: Brand.muted, fontSize: 14)),
          const SizedBox(height: 20),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(
              width: 76,
              child: TextField(
                controller: _ccCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(prefixText: '+ '),
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _numCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(hintText: 'Phone Number'),
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              ),
            ),
          ]),
          const SizedBox(height: 28),
          FilledButton(onPressed: _submitNumber, child: const Text('Continue')),
        ],
      ),
    );
  }

  Widget _verifyView() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      children: [
        _stepLabel(),
        Text('Choose one option to verify $_currentPhone',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Brand.ink)),
        const SizedBox(height: 20),
        _option(
          icon: Icons.contact_phone_outlined,
          title: 'Verify via Call Log',
          subtitle: 'Select a call you dialed using $_currentPhone.',
          onTap: _verifyViaCallLog,
        ),
        _option(
          icon: Icons.block,
          title: 'Skip Verification',
          subtitle: '(Not recommended) You can verify later from settings.',
          onTap: _skip,
        ),
        const SizedBox(height: 8),
        Center(
          child: TextButton(
            onPressed: () => setState(() => _stage = _Stage.enter),
            child: const Text('Back', style: TextStyle(color: Brand.muted, fontWeight: FontWeight.w600)),
          ),
        ),
      ],
    );
  }

  Widget _option({required IconData icon, required String title, required String subtitle, required VoidCallback onTap}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x12000000)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Icon(icon, color: Brand.accent),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ink)),
        subtitle: Text(subtitle, style: const TextStyle(color: Brand.muted, fontSize: 12.5, height: 1.3)),
        trailing: const Icon(Icons.chevron_right, color: Brand.muted),
        onTap: onTap,
      ),
    );
  }
}

class _CallLogPicker extends StatelessWidget {
  const _CallLogPicker({required this.phone, required this.entries});
  final String phone;
  final List<CallLogEntry> entries;

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      builder: (_, controller) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text('Select a call you dialed with $phone',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Brand.ink)),
              ),
              IconButton(onPressed: () => Navigator.pop(context, false), icon: const Icon(Icons.close)),
            ]),
            const SizedBox(height: 8),
            Expanded(
              child: ListView.builder(
                controller: controller,
                itemCount: entries.length,
                itemBuilder: (_, i) {
                  final e = entries[i];
                  final d = DateTime.fromMillisecondsSinceEpoch(e.timestamp ?? 0);
                  return ListTile(
                    leading: const Icon(Icons.call_made, color: Brand.accent),
                    title: Text(e.name?.isNotEmpty == true ? e.name! : (e.number ?? 'Unknown'),
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${e.number ?? ''} · ${d.day}/${d.month} ${d.hour}:${d.minute.toString().padLeft(2, '0')}'),
                    trailing: Text('${e.duration ?? 0}s', style: const TextStyle(color: Brand.muted)),
                    onTap: () => Navigator.pop(context, true),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
