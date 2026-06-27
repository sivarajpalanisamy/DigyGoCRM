import 'package:flutter/material.dart';

import '../theme.dart';
import '../services/native.dart';

/// Guides the user to turn ON their phone's built-in (OEM) automatic call
/// recording - the only way (on Android 10+) to capture both sides of a call.
/// Our app then harvests those files and uploads them to the CRM. This screen
/// shows live status and brand-specific steps, plus buttons to jump straight to
/// the phone's recording settings and to grant the file access we need to read
/// the recordings.
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
    if (!mounted) return;
    setState(() {
      _info = info;
      _fileAccess = fa;
      _folderExists = fe;
      _fileCount = fc;
      _loading = false;
    });
  }

  // Heuristic: recording is "working" if we can read files and at least one
  // recording exists (proof the built-in recorder is producing files).
  bool get _recordingWorking => _fileAccess && _fileCount > 0;

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

                const Text('Why this is needed',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Brand.ink)),
                const SizedBox(height: 6),
                const Text(
                  'Android does not allow apps to record calls directly. Recording '
                  'is done by your phone\'s own call recorder. Turn it on once, and '
                  'DigyGo will automatically attach each recording to its call in the CRM.',
                  style: TextStyle(color: Brand.muted, fontSize: 13, height: 1.45),
                ),
                const SizedBox(height: 22),

                // Step 1 - enable built-in recording
                _sectionHeader('1', 'Turn on automatic call recording'),
                const SizedBox(height: 4),
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
                const SizedBox(height: 24),

                // Step 2 - file access (so we can read the recordings)
                _sectionHeader('2', 'Allow DigyGo to read recordings'),
                const SizedBox(height: 8),
                if (_fileAccess)
                  _inlineStatus(true, 'File access granted')
                else ...[
                  const Text(
                    'DigyGo needs file access to read the recordings your phone saves, '
                    'so it can upload them to the CRM.',
                    style: TextStyle(color: Brand.muted, fontSize: 13, height: 1.45),
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
    final partial = _fileAccess && _folderExists && _fileCount == 0;
    final color = ok ? const Color(0xFF16A34A) : partial ? const Color(0xFFD97706) : const Color(0xFFDC2626);
    final bg = ok ? const Color(0x1416A34A) : partial ? const Color(0x14D97706) : const Color(0x14DC2626);
    final icon = ok ? Icons.check_circle : partial ? Icons.info : Icons.error_outline;
    final title = ok
        ? 'Call recording is working'
        : partial
            ? 'Almost there'
            : 'Call recording not set up';
    final msg = ok
        ? 'Your phone is recording calls and DigyGo can read them ($_fileCount found). New calls will sync automatically.'
        : partial
            ? 'File access is granted but no recordings were found yet. Make sure automatic call recording is turned ON (Step 1), then make a test call.'
            : 'Follow the steps below to start capturing call recordings.';
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
