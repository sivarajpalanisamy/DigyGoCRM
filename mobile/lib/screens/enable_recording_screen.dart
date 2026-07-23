import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../theme.dart';
import '../services/native.dart';
import '../services/dialer_data.dart';

/// Call-recording setup. Two paths, most-reliable first:
///  1. Hawcus records the call ITSELF when it is your default calling app (works on
///     every device - your side always; both sides on speakerphone). This is the
///     reliable path on MIUI/Redmi where the phone saves no harvestable recording.
///  2. (Optional, better audio) your phone's own auto call recording captures both
///     sides; Hawcus harvests those files - needs file access.
/// Shows live status and brand-specific steps.
class EnableRecordingScreen extends StatefulWidget {
  const EnableRecordingScreen({super.key});

  @override
  State<EnableRecordingScreen> createState() => _EnableRecordingScreenState();
}

class _EnableRecordingScreenState extends State<EnableRecordingScreen> with WidgetsBindingObserver {
  DeviceInfo? _info;
  bool _fileAccess = false;
  bool _folderExists = false;
  int _fileCount = 0;
  bool _defaultDialer = false;
  bool _micGranted = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final info = await Native.instance.deviceInfo();
    final fa = await Native.instance.hasAllFilesAccess();
    final fe = fa ? await Native.instance.recordingFolderExists() : false;
    final fc = fa ? await Native.instance.recordingFileCount() : 0;
    final dd = await Native.instance.isDefaultDialer();
    final mic = await Permission.microphone.isGranted;
    if (!mounted) return;
    setState(() {
      _info = info;
      _fileAccess = fa;
      _folderExists = fe;
      _fileCount = fc;
      _defaultDialer = dd;
      _micGranted = mic;
      _loading = false;
    });
  }

  // Hawcus can record the call itself (mic - your side always) when it is the default
  // calling app and has microphone permission. This is the reliable path, independent
  // of the phone's built-in recorder.
  bool get _ownRecorderReady => _defaultDialer && _micGranted;
  // OEM path adds both-sides audio when the phone's own recorder is producing files.
  bool get _oemReady => _fileAccess && _fileCount > 0;
  // Recording works if EITHER path is ready.
  bool get _recordingWorking => _ownRecorderReady || _oemReady;

  @override
  Widget build(BuildContext context) {
    final steps = _stepsFor(_info?.brandKey ?? 'generic');
    final brandName = _brandName(_info?.brandKey ?? 'generic');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Call Recording Setup'),
        backgroundColor: Colors.white,
        foregroundColor: Brand.ink,
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
              children: [
                // Status banner
                _statusCard(),
                const SizedBox(height: 18),

                const Text('How recording works',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Brand.ink)),
                const SizedBox(height: 6),
                const Text(
                  'When Hawcus is your default calling app, it records every call itself '
                  'and attaches it to the call in the CRM - even if your phone has no built-in '
                  'recorder. On Android 10+ this captures your side of the call (turn on '
                  'speakerphone to also capture the other person). This is the reliable path.',
                  style: TextStyle(color: Brand.muted, fontSize: 13, height: 1.45),
                ),
                const SizedBox(height: 22),

                // Step 1 - default dialer + mic (the reliable, OEM-independent path)
                _sectionHeader('1', 'Let Hawcus record your calls'),
                const SizedBox(height: 8),
                _inlineStatus(_defaultDialer, _defaultDialer ? 'Hawcus is your default calling app' : 'Hawcus is not your default calling app'),
                const SizedBox(height: 6),
                _inlineStatus(_micGranted, _micGranted ? 'Microphone permission granted' : 'Microphone permission needed'),
                const SizedBox(height: 10),
                if (!_defaultDialer)
                  _primaryButton(
                    icon: Icons.phone_in_talk,
                    label: 'Set Hawcus as default calling app',
                    onTap: () async {
                      await DialerData.instance.requestDefaultDialer();
                      await _refresh();
                    },
                  ),
                if (!_micGranted) ...[
                  const SizedBox(height: 8),
                  _primaryButton(
                    icon: Icons.mic,
                    label: 'Grant microphone permission',
                    onTap: () async {
                      await Permission.microphone.request();
                      await _refresh();
                    },
                  ),
                ],
                if (_ownRecorderReady)
                  _inlineStatus(true, 'Ready - Hawcus will record your calls'),
                const SizedBox(height: 24),

                // Step 2 - OEM recorder (OPTIONAL: better audio - both sides)
                _sectionHeader('2', 'Optional: capture both sides (HD)'),
                const SizedBox(height: 4),
                const Text(
                  'If your phone has its own call recorder, turning it on also captures the '
                  'other person clearly (not just your side). This step is optional.',
                  style: TextStyle(color: Brand.muted, fontSize: 12.5, height: 1.4),
                ),
                const SizedBox(height: 8),
                Text('Steps for your phone ($brandName):',
                    style: const TextStyle(color: Brand.muted, fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 10),
                ...steps.asMap().entries.map((e) => _stepLine(e.key + 1, e.value)),
                const SizedBox(height: 12),
                _primaryButton(
                  icon: Icons.settings_phone,
                  label: 'Open recording settings',
                  onTap: () => Native.instance.openCallRecordingSettings(),
                ),
                const SizedBox(height: 14),
                if (_fileAccess)
                  _inlineStatus(true, 'File access granted (for reading those recordings)')
                else ...[
                  const Text(
                    'To upload your phone\'s own recordings, Hawcus also needs file access.',
                    style: TextStyle(color: Brand.muted, fontSize: 12.5, height: 1.4),
                  ),
                  const SizedBox(height: 10),
                  _primaryButton(
                    icon: Icons.folder_open,
                    label: 'Grant file access',
                    onTap: () async {
                      await Native.instance.requestAllFilesAccess();
                    },
                  ),
                ],
                const SizedBox(height: 28),

                Center(
                  child: TextButton.icon(
                    onPressed: _refresh,
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Re-check status'),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _statusCard() {
    final ok = _recordingWorking;
    final color = ok ? const Color(0xFF16A34A) : const Color(0xFFDC2626);
    final bg = ok ? const Color(0x1416A34A) : const Color(0x14DC2626);
    final icon = ok ? Icons.check_circle : Icons.error_outline;
    final title = ok ? 'Call recording is working' : 'Call recording not set up';
    final msg = ok
        ? (_oemReady
            ? 'Your phone records both sides and Hawcus uploads them ($_fileCount found). New calls sync automatically.'
            : 'Hawcus will record your calls and upload them to the CRM. Turn on speakerphone to also capture the other person clearly.')
        : 'Complete Step 1 so Hawcus can record your calls. Make a test call afterwards to confirm.';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(16)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.w800, color: color, fontSize: 15)),
                const SizedBox(height: 4),
                Text(msg, style: const TextStyle(color: Brand.ink, fontSize: 12.5, height: 1.4)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionHeader(String n, String title) {
    return Row(
      children: [
        CircleAvatar(
          radius: 13,
          backgroundColor: Brand.accent,
          child: Text(n, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Brand.ink)),
        ),
      ],
    );
  }

  Widget _stepLine(int n, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8, left: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$n.', style: const TextStyle(color: Brand.accent, fontWeight: FontWeight.w700, fontSize: 13)),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(color: Brand.ink, fontSize: 13, height: 1.4))),
        ],
      ),
    );
  }

  Widget _inlineStatus(bool ok, String text) {
    return Row(
      children: [
        Icon(ok ? Icons.check_circle : Icons.cancel, color: ok ? const Color(0xFF16A34A) : const Color(0xFFDC2626), size: 18),
        const SizedBox(width: 8),
        Text(text, style: const TextStyle(color: Brand.ink, fontSize: 13, fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _primaryButton({required IconData icon, required String label, required VoidCallback onTap}) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 18),
        label: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
        style: ElevatedButton.styleFrom(
          backgroundColor: Brand.accent,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          elevation: 0,
        ),
      ),
    );
  }

  String _brandName(String key) => switch (key) {
        'samsung' => 'Samsung',
        'xiaomi' => 'Xiaomi / Redmi / POCO',
        'vivo' => 'Vivo / iQOO',
        'oppo' => 'Oppo / Realme / OnePlus',
        'motorola' => 'Motorola',
        'pixel' => 'Google Pixel',
        _ => 'most phones',
      };

  /// Brand-specific path to the built-in auto call recording toggle. Wording is
  /// kept close to the real menus; minor version differences are expected.
  List<String> _stepsFor(String key) => switch (key) {
        'samsung' => const [
            'Open the Phone app, tap the three-dot menu (⋮) → Settings.',
            'Tap "Record calls".',
            'Turn ON "Auto record calls".',
            'Choose "All calls" (or selected numbers).',
          ],
        'xiaomi' => const [
            'Open the Phone app → three-dot menu / Settings.',
            'Tap "Call recording".',
            'Turn ON "Record calls automatically".',
            'Set it to "All calls".',
          ],
        'vivo' => const [
            'Open the Phone app → Settings (gear icon).',
            'Tap "Call recording".',
            'Turn ON "Auto call recording".',
            'Select "All calls".',
          ],
        'oppo' => const [
            'Open the Phone app → Settings.',
            'Tap "Call recording".',
            'Turn ON "Automatic recording".',
            'Choose "Record all calls".',
          ],
        'motorola' => const [
            'Open the Phone app → menu → Settings.',
            'Tap "Call recording" (available in some regions).',
            'Turn ON automatic recording.',
          ],
        'pixel' => const [
            'Google Pixel / stock Android usually does NOT include built-in call recording.',
            'Install a system-level recorder if your carrier/region supports it, or use a supported phone.',
            'If unavailable, calls still log to the CRM - only the audio cannot be captured.',
          ],
        _ => const [
            'Open your Phone (dialer) app.',
            'Open its menu → Settings.',
            'Look for "Call recording" or "Record calls".',
            'Turn ON automatic recording for all calls.',
          ],
      };
}
