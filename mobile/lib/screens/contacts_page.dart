import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:flutter/material.dart';

import '../theme.dart';
import '../services/dialer_data.dart';
import '../services/call_launcher.dart';

class ContactsPage extends StatefulWidget {
  const ContactsPage({super.key});

  @override
  State<ContactsPage> createState() => _ContactsPageState();
}

class _ContactsPageState extends State<ContactsPage> {
  List<Contact> _contacts = [];
  Map<String, int> _callCounts = {}; // normalized number → total calls
  bool _loading = true;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  String _norm(String n) => n.replaceAll(RegExp(r'[^0-9]'), '');

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final contacts = await DialerData.instance.contacts();
      final logs = await DialerData.instance.callLogs();
      final counts = <String, int>{};
      for (final e in logs) {
        final key = _norm(e.number ?? '');
        if (key.isEmpty) continue;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      if (!mounted) return;
      setState(() {
        _contacts = contacts;
        _callCounts = counts;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  int _callsFor(Contact c) {
    for (final p in c.phones) {
      final n = _norm(p.number);
      if (n.isNotEmpty && _callCounts.containsKey(n)) return _callCounts[n]!;
      // suffix match (last 10 digits) for country-code differences
      if (n.length >= 10) {
        final tail = n.substring(n.length - 10);
        for (final entry in _callCounts.entries) {
          if (entry.key.endsWith(tail)) return entry.value;
        }
      }
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _contacts.where((c) {
      if (_search.isEmpty) return true;
      final q = _search.toLowerCase();
      return c.displayName.toLowerCase().contains(q) ||
          c.phones.any((p) => p.number.contains(q));
    }).toList();

    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Text('Contacts',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Brand.ink)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              onChanged: (v) => setState(() => _search = v),
              decoration: const InputDecoration(
                hintText: 'Search contacts',
                prefixIcon: Icon(Icons.search, color: Brand.muted),
                contentPadding: EdgeInsets.symmetric(vertical: 0),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : filtered.isEmpty
                    ? const Center(child: Text('No contacts', style: TextStyle(color: Brand.muted)))
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
                          itemCount: filtered.length,
                          itemBuilder: (_, i) => _contactCard(filtered[i]),
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _contactCard(Contact c) {
    final number = c.phones.isNotEmpty ? c.phones.first.number : '';
    final calls = _callsFor(c);
    final initial = c.displayName.isNotEmpty ? c.displayName[0].toUpperCase() : '?';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x12000000)),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: const Color(0x14EA580C),
                  child: Text(initial,
                      style: const TextStyle(color: Brand.accent, fontWeight: FontWeight.w800)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: Brand.ink)),
                      const SizedBox(height: 2),
                      Text(number, style: const TextStyle(color: Brand.muted, fontSize: 13)),
                    ],
                  ),
                ),
                if (calls > 0)
                  Text('$calls calls',
                      style: const TextStyle(color: Brand.muted, fontSize: 12, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          const Divider(height: 1, color: Color(0x10000000)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                IconButton(
                    icon: const Icon(Icons.copy_rounded, color: Color(0xFF6B7280), size: 22),
                    onPressed: () {}),
                IconButton(
                    icon: const Icon(Icons.sms_outlined, color: Color(0xFF3B82F6), size: 22),
                    onPressed: () => DialerData.instance.sms(number)),
                IconButton(
                    icon: const Icon(Icons.chat, color: Color(0xFF25D366), size: 22),
                    onPressed: () => DialerData.instance.whatsapp(number)),
                IconButton(
                    icon: const Icon(Icons.call, color: Brand.accent, size: 22),
                    onPressed: () => CallLauncher.start(context, number)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
