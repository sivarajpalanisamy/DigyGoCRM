import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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

class _DigygoDialerAppState extends State<DigygoDialerApp> {
  final _navKey = GlobalKey<NavigatorState>();
  StreamSubscription<CallState>? _callSub;
  bool _inCallShown = false;

  @override
  void initState() {
    super.initState();
    // Whenever a call starts (incoming or outgoing), bring up the in-app call screen.
    _callSub = PhoneCall.instance.stream.listen((s) {
      if (s.isOngoing && !_inCallShown) {
        _inCallShown = true;
        _navKey.currentState
            ?.push(MaterialPageRoute(builder: (_) => InCallScreen(initial: s)))
            .then((_) => _inCallShown = false);
      }
    });
  }

  @override
  void dispose() {
    _callSub?.cancel();
    super.dispose();
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
/// no pairing code — the app binds by SIM number):
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
    // 3) SIM verification (always succeeds locally — links to CRM only if the
    //    number is verified in the dashboard).
    if (!await Api.instance.isSimStepDone()) {
      _set(ConnectSimScreen(onDone: _resolve));
      return;
    }
    // 4) Ready — show the dialer. Sync/recording only run when linked to the CRM.
    Api.instance.refreshSyncConfig(); // ensure the background auto-sync service has the latest config
    if (await Api.instance.hasDeviceToken()) {
      _syncCallLogsFallback(); // FALLBACK: mirror any calls the background service missed
      RecordingUploader.instance.start();
      RecordingHarvester.instance.run();
    } else {
      // Not linked yet — try to link in case an admin has since added this number.
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
      // silent — best-effort; the next open/resume retries
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
