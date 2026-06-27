import 'package:flutter/material.dart';

import '../theme.dart';
import '../services/api.dart';
import '../services/call_launcher.dart';
import '../widgets/app_dialog.dart';
import 'call_history_page.dart';
import 'contacts_page.dart';
import 'enable_recording_screen.dart';

/// The dialer shell — a Callyzer-style call app. Tabs: Call History, Contacts,
/// More. Shows the device's real call log + contacts (no CRM/lead data in the UI;
/// call logs are mirrored to the CRM silently in the background).
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onSignOut});
  final Future<void> Function() onSignOut;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  late final List<Widget> _pages = [
    const CallHistoryPage(),
    const ContactsPage(),
    _MorePage(onSignOut: widget.onSignOut),
  ];

  void _openDialpad() {
    showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => const _DialpadSheet(),
    ).then((number) {
      if (number != null && number.isNotEmpty && mounted) {
        CallLauncher.start(context, number);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _tab, children: _pages),
      floatingActionButton: FloatingActionButton(
        onPressed: _openDialpad,
        backgroundColor: Brand.accent,
        foregroundColor: Colors.white,
        child: const Icon(Icons.dialpad),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        backgroundColor: Colors.white,
        indicatorColor: const Color(0x1AEA580C),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.call_outlined), selectedIcon: Icon(Icons.call), label: 'Call History'),
          NavigationDestination(icon: Icon(Icons.contacts_outlined), selectedIcon: Icon(Icons.contacts), label: 'Contacts'),
          NavigationDestination(icon: Icon(Icons.menu), label: 'More'),
        ],
      ),
    );
  }
}

// ── More tab — minimal app settings (no CRM/company data) ────────────────────
class _MorePage extends StatefulWidget {
  const _MorePage({required this.onSignOut});
  final Future<void> Function() onSignOut;

  @override
  State<_MorePage> createState() => _MorePageState();
}

class _MorePageState extends State<_MorePage> {
  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 96),
        children: [
          const Text('More', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Brand.ink)),
          const SizedBox(height: 16),
          _tile(
            icon: Icons.fiber_manual_record,
            title: 'Call recording setup',
            subtitle: 'Turn on auto recording & check status',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const EnableRecordingScreen()),
            ),
          ),
          _tile(
            icon: Icons.logout,
            title: 'Sign out',
            subtitle: 'Disconnect this device from the CRM',
            onTap: () async {
              final confirmed = await AppDialog.show(
                context,
                icon: Icons.logout,
                danger: true,
                title: 'Sign out?',
                message: 'This disconnects the device from the CRM. '
                    'Call logs and recordings will stop syncing until you sign in again.',
                confirmText: 'Sign out',
                cancelText: 'Cancel',
              );
              if (confirmed != true) return;
              await Api.instance.clearToken();
              await widget.onSignOut();
            },
          ),
        ],
      ),
    );
  }

  Widget _tile({
    required IconData icon,
    required String title,
    required String subtitle,
    Widget? trailing,
    VoidCallback? onTap,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0x12000000)),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: const Color(0x14EA580C),
          child: Icon(icon, color: Brand.accent, size: 20),
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ink)),
        subtitle: Text(subtitle, style: const TextStyle(color: Brand.muted, fontSize: 12)),
        trailing: trailing ?? const Icon(Icons.chevron_right, color: Brand.muted),
        onTap: onTap,
      ),
    );
  }
}

// ── Dialpad bottom sheet ─────────────────────────────────────────────────────
class _DialpadSheet extends StatefulWidget {
  const _DialpadSheet();

  @override
  State<_DialpadSheet> createState() => _DialpadSheetState();
}

class _DialpadSheetState extends State<_DialpadSheet> {
  String _num = '';

  void _press(String s) => setState(() => _num += s);
  void _back() => setState(() => _num = _num.isEmpty ? '' : _num.substring(0, _num.length - 1));

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom + 16, top: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 40, height: 4, decoration: BoxDecoration(color: const Color(0x22000000), borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 16),
          Text(_num.isEmpty ? 'Enter number' : _num,
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: _num.isEmpty ? Brand.muted : Brand.ink)),
          const SizedBox(height: 16),
          ...[
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['7', '8', '9'],
            ['*', '0', '#'],
          ].map((row) => Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: row.map(_key).toList(),
              )),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              const SizedBox(width: 64),
              FloatingActionButton(
                heroTag: 'dialpad_call',
                backgroundColor: const Color(0xFF16A34A),
                foregroundColor: Colors.white,
                onPressed: _num.isEmpty ? null : () => Navigator.pop(context, _num),
                child: const Icon(Icons.call),
              ),
              SizedBox(
                width: 64,
                child: IconButton(
                  icon: const Icon(Icons.backspace_outlined, color: Brand.muted),
                  onPressed: _num.isEmpty ? null : _back,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _key(String label) {
    return Padding(
      padding: const EdgeInsets.all(8),
      child: SizedBox(
        width: 72,
        height: 64,
        child: TextButton(
          onPressed: () => _press(label),
          style: TextButton.styleFrom(
            backgroundColor: const Color(0x08000000),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          ),
          child: Text(label, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: Brand.ink)),
        ),
      ),
    );
  }
}
