import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme.dart';
import '../services/api.dart';

/// Shown after permissions, before SIM verification. The user must review and
/// agree to the privacy policy / terms before continuing.
class PrivacyScreen extends StatefulWidget {
  const PrivacyScreen({super.key, required this.onAgree});
  final Future<void> Function() onAgree;

  // Hosted policy/terms - update to your live URLs.
  static const privacyUrl = 'https://digygo.in/privacy';
  static const termsUrl = 'https://digygo.in/terms';

  @override
  State<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends State<PrivacyScreen> {
  bool _busy = false;

  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _agree() async {
    setState(() => _busy = true);
    await Api.instance.markPrivacyAccepted();
    await widget.onAgree();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 16),
                children: [
                  const Text('Your privacy is important to us',
                      style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Brand.ink, height: 1.2)),
                  const SizedBox(height: 12),
                  Wrap(
                    children: [
                      const Text('Please review the key points of our ',
                          style: TextStyle(fontSize: 15, color: Brand.muted, height: 1.4)),
                      GestureDetector(
                        onTap: () => _openUrl(PrivacyScreen.privacyUrl),
                        child: const Text('Privacy Policy',
                            style: TextStyle(fontSize: 15, color: Brand.accent, fontWeight: FontWeight.w700)),
                      ),
                      const Text(' below.', style: TextStyle(fontSize: 15, color: Brand.muted)),
                    ],
                  ),
                  const SizedBox(height: 24),
                  _section(
                    icon: Icons.dataset_outlined,
                    title: 'Data we process',
                    body:
                        '• Call logs (number, time, duration, type) for the SIM you verify.\n'
                        '• Call recordings saved by your phone\'s built-in recorder.\n'
                        '• Contacts - used only on-device to show caller names.\n'
                        '• Your verified phone number and basic device info (model, app version).',
                  ),
                  _section(
                    icon: Icons.sync_alt,
                    title: 'How we use your data',
                    body:
                        '• Call logs and recordings are synced to your company\'s CRM so your '
                        'team can track and review calls with leads.\n'
                        '• Data is sent securely to your organisation\'s DigyGo workspace and is '
                        'visible only to your authorised admins.\n'
                        '• We do not sell your data or share it with third parties.',
                  ),
                  _section(
                    icon: Icons.verified_user_outlined,
                    title: 'Unnecessary permissions? We never ask for it',
                    body:
                        '• We only request Call logs, Contacts, and Files - the minimum needed to '
                        'log and sync your work calls.\n'
                        '• Contacts never leave your device.\n'
                        '• You can revoke access anytime in your phone settings, or unpair the '
                        'device from the app.',
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      TextButton(
                        onPressed: () => _openUrl(PrivacyScreen.privacyUrl),
                        child: const Text('Privacy Policy', style: TextStyle(color: Brand.accent, fontWeight: FontWeight.w600)),
                      ),
                      const Text('·', style: TextStyle(color: Brand.muted)),
                      TextButton(
                        onPressed: () => _openUrl(PrivacyScreen.termsUrl),
                        child: const Text('Terms & Conditions', style: TextStyle(color: Brand.accent, fontWeight: FontWeight.w600)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 20),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: Color(0x10000000))),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.shield_outlined, size: 18, color: Brand.muted),
                      const SizedBox(width: 8),
                      Expanded(
                        child: RichText(
                          text: TextSpan(
                            style: const TextStyle(fontSize: 13, color: Brand.muted, height: 1.4),
                            children: [
                              const TextSpan(text: 'By continuing you agree to our '),
                              TextSpan(
                                text: 'Privacy Policy',
                                style: const TextStyle(color: Brand.ink, fontWeight: FontWeight.w700),
                              ),
                              const TextSpan(text: ' and '),
                              TextSpan(
                                text: 'Terms.',
                                style: const TextStyle(color: Brand.ink, fontWeight: FontWeight.w700),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  FilledButton(
                    onPressed: _busy ? null : _agree,
                    child: _busy
                        ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Agree & Continue'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _section({required IconData icon, required String title, required String body}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0x12000000)),
      ),
      child: Theme(
        // Remove the default ExpansionTile divider lines.
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          leading: Icon(icon, color: Brand.accent, size: 22),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ink, fontSize: 15)),
          iconColor: Brand.muted,
          collapsedIconColor: Brand.muted,
          childrenPadding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          expandedAlignment: Alignment.centerLeft,
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(body, style: const TextStyle(color: Brand.muted, fontSize: 13.5, height: 1.6)),
          ],
        ),
      ),
    );
  }
}
