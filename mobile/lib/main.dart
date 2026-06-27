import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:call_log/call_log.dart';

import 'dart:async';

import 'theme.dart';
import 'services/api.dart';
import 'services/dialer_data.dart';
import 'services/gate.dart';
import 'services/phone_call.dart';
import 'services/recording_uploader.dart';
import 'services/recording_harvester.dart';
import 'screens/sim_verify_screen.dart';
import 'screens/onboarding_gate_screen.dart';
import 'screens/privacy_screen.dart';
import 'screens/home_screen.dart';
import 'screens/in_call_screen.dart';
import 'screens/call_details_page.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.instance.init();
  runApp(const ProviderScope(child: DigygoDialerApp()));
}

class DigygoDialerApp extends StatefulWidget {
  const DigygoDialerApp({super.key});

  @override
  State<DigygoDialerApp> createState() => _DigygoDialerAppState();
}

class _DigygoDialerAppState extends State<DigygoDialerApp> with WidgetsBindingObserver {
  final _navKey = GlobalKey<NavigatorState>();
  static const _nativeCh = MethodChannel('digygo/dialer');
  StreamSubscription<CallState>? _callSub;
  bool _inCallShown = false;
  bool _callDetailsOpen = false;
  String? _lastPostCallKey; // phone_timestamp of the call we've already surfaced

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Whenever a call starts (incoming or outgoing), bring up the in-app call screen.
    _callSub = PhoneCall.instance.stream.listen((s) {
      if (s.isOngoing && !_inCallShown) {
        _inCallShown = true;
        _navKey.currentState
            ?.push(MaterialPageRoute(builder: (_) => InCallScreen(initial: s)))
            .then((_) => _inCallShown = false);
      }
    });
    // Native → Flutter: a post-call notification asks us to open the Call Details page.
    _nativeCh.setMethodCallHandler((call) async {
      if (call.method == 'openCallDetails' && call.arguments is Map) {
        _openCallDetails(Map<String, dynamic>.from(call.arguments as Map));
      }
      return null;
    });
    // Cold start from the notification: pick up the pending payload once we're up.
    WidgetsBinding.instance.addPostFrameCallback((_) => _consumePendingCallDetails());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _callSub?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _consumePendingCallDetails();
      _maybeShowPostCallFromLog();
    }
  }

  Future<void> _consumePendingCallDetails() async {
    try {
      final data = await _nativeCh.invokeMethod('consumePendingCallDetails');
      if (data is Map) _openCallDetails(Map<String, dynamic>.from(data));
    } catch (_) {}
  }

  // Reliable fallback (background notifications get killed by OEM battery managers):
  // when the app is opened/resumed, if the most-recent call just ended, pop the
  // Call Details page for it once.
  Future<void> _maybeShowPostCallFromLog() async {
    try {
      if (!await Api.instance.hasDeviceToken()) return;
      final logs = await DialerData.instance.callLogs();
      if (logs.isEmpty) return;
      final e = logs.first; // newest first
      final number = e.number ?? '';
      if (number.isEmpty) return;
      final ts = e.timestamp ?? 0;
      final endMs = ts + ((e.duration ?? 0) * 1000);
      // Only surface calls that ended in the last 3 minutes.
      if (DateTime.now().millisecondsSinceEpoch - endMs > 3 * 60 * 1000) return;
      final isOut = e.callType == CallType.outgoing;
      final dur = e.duration ?? 0;
      String outcome;
      if (e.callType == CallType.missed) {
        outcome = 'MISSED';
      } else if (e.callType == CallType.rejected) {
        outcome = 'REJECTED';
      } else if (dur > 0) {
        outcome = 'ANSWERED';
      } else {
        outcome = isOut ? 'NO_ANSWER' : 'MISSED';
      }
      _openCallDetails({
        'phone': number,
        'direction': isOut ? 'OUTBOUND' : 'INBOUND',
        'outcome': outcome,
        'duration': dur,
        'date': ts,
      });
    } catch (_) {}
  }

  Future<void> _openCallDetails(Map<String, dynamic> data) async {
    final phone = (data['phone'] ?? '').toString();
    if (phone.isEmpty || _callDetailsOpen) return;
    final key = '${phone}_${data['date'] ?? ''}';
    if (key == _lastPostCallKey) return; // already surfaced this call
    _callDetailsOpen = true; // sync guard against double-pop
    final linked = await Api.instance.hasDeviceToken();
    if (!linked) { _callDetailsOpen = false; return; }
    _lastPostCallKey = key;
    await _navKey.currentState?.push(MaterialPageRoute(
      builder: (_) => CallDetailsPage(
        phone: phone,
        direction: (data['direction'] ?? '').toString(),
        outcome: (data['outcome'] ?? '').toString(),
        durationSeconds: (data['duration'] is int) ? data['duration'] as int : null,
      ),
    ));
    _callDetailsOpen = false;
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DigyGo Dialer',
      debugShowCheckedModeBanner: false,
      navigatorKey: _navKey,
      theme: buildTheme(),
      home: const RootRouter(),
    );
  }
}

/// Decides where to land on launch and re-checks on every resume (no login /
/// no pairing code - the app binds by SIM number):
///   permissions not granted  → OnboardingGateScreen
///   privacy not accepted      → PrivacyScreen
///   SIM step not done         → ConnectSimScreen
///   all done                  → HomeScreen
class RootRouter extends StatefulWidget {
  const RootRouter({super.key});

  @override
  State<RootRouter> createState() => _RootRouterState();
}

class _RootRouterState extends State<RootRouter> with WidgetsBindingObserver {
  Widget? _screen;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _resolve();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Re-check on resume: a permission revoked in OS Settings forces the gate again.
    if (state == AppLifecycleState.resumed) _resolve();
  }

  Future<void> _resolve() async {
    // 1) Permissions first (incl. mandatory call recording + phone for SIM detection).
    bool passed;
    try {
      passed = await OnboardingGate.isPassed();
    } catch (_) {
      passed = false;
    }
    if (!passed) {
      _set(OnboardingGateScreen(onComplete: _resolve));
      return;
    }
    // 2) Privacy consent.
    if (!await Api.instance.isPrivacyAccepted()) {
      _set(PrivacyScreen(onAgree: _resolve));
      return;
    }
    // 3) SIM verification (always succeeds locally - links to CRM only if the
    //    number is verified in the dashboard).
    if (!await Api.instance.isSimStepDone()) {
      _set(ConnectSimScreen(onDone: _resolve));
      return;
    }
    // 4) Ready - show the dialer. Sync/recording only run when linked to the CRM.
    Api.instance.refreshSyncConfig(); // ensure the background auto-sync service has the latest config
    if (await Api.instance.hasDeviceToken()) {
      _syncCallLogsFallback(); // FALLBACK: mirror any calls the background service missed
      RecordingUploader.instance.start();
      RecordingHarvester.instance.run();
    } else {
      // Not linked yet - try to link in case an admin has since added this number.
      Api.instance.tryLink().then((linked) {
        if (linked) {
          _syncCallLogsFallback();
          RecordingUploader.instance.start();
          RecordingHarvester.instance.run();
        }
      });
    }
    _set(HomeScreen(onSignOut: _resolve));
  }

  // Primary sync is the native background foreground service (real-time, even when
  // the app is closed). This is the FALLBACK: every time the app is opened or
  // resumed, re-post recent call logs so anything the background path missed (e.g.
  // an OEM that dropped the broadcast) still lands in the CRM. Gated on being linked
  // and deduped server-side by clientCallId, so it never double-counts.
  Future<void> _syncCallLogsFallback() async {
    try {
      final logs = await DialerData.instance.callLogs();
      await DialerData.instance.syncToCrm(logs);
    } catch (_) {
      // silent - best-effort; the next open/resume retries
    }
  }

  void _set(Widget w) {
    if (mounted) setState(() => _screen = w);
  }

  @override
  Widget build(BuildContext context) {
    return _screen ??
        const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
