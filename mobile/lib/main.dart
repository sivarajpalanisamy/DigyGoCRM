import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:call_log/call_log.dart';
import 'package:permission_handler/permission_handler.dart';

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
import 'screens/post_call_screen.dart';
import 'screens/splash_screen.dart';

void main() {
  // Global safety net so a single device-specific failure (a plugin that throws on
  // one OEM, a malformed platform payload, an unexpected build error) can never leave
  // the user on a blank/grey screen.
  //  - ErrorWidget.builder: replace Flutter's default grey error box with a readable screen.
  //  - runZonedGuarded + FlutterError.onError: catch uncaught async/framework errors.
  //  - try/catch around Api.init(): secure storage can throw on some devices; if it does,
  //    START THE APP ANYWAY (init is best-effort - a failed read just means "no token yet").
  //    Previously an init() throw meant runApp was never called and the app hung on the splash.
  ErrorWidget.builder = (details) => const _AppErrorScreen();
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();
    FlutterError.onError = FlutterError.presentError;
    try {
      await Api.instance.init();
    } catch (_) {
      // Start regardless; features degrade instead of the whole app blanking.
    }
    runApp(const ProviderScope(child: HawcusDialerApp()));
  }, (error, stack) {
    // Uncaught async errors land here instead of silently killing an action. The UI is
    // already running by this point, so we just swallow to keep the app alive.
  });
}

// Friendly fallback shown instead of Flutter's grey ErrorWidget if any widget fails to
// build. Uses Directionality/Material so it renders even outside a MaterialApp ancestor.
class _AppErrorScreen extends StatelessWidget {
  const _AppErrorScreen();
  @override
  Widget build(BuildContext context) {
    return const Directionality(
      textDirection: TextDirection.ltr,
      child: Material(
        color: Colors.white,
        child: Center(
          child: Padding(
            padding: EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.refresh_rounded, size: 48, color: Color(0xFF9AA0A6)),
                SizedBox(height: 14),
                Text('Something went wrong',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Color(0xFF1C1410))),
                SizedBox(height: 6),
                Text('Please close and reopen the app. If it keeps happening, contact support.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 14, color: Color(0xFF7A6B5C), height: 1.4)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class HawcusDialerApp extends StatefulWidget {
  const HawcusDialerApp({super.key});

  @override
  State<HawcusDialerApp> createState() => _HawcusDialerAppState();
}

class _HawcusDialerAppState extends State<HawcusDialerApp> with WidgetsBindingObserver {
  final _navKey = GlobalKey<NavigatorState>();
  static const _nativeCh = MethodChannel('hawcus/dialer');
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
    }, onError: (_) {}); // a malformed native call event must not crash the app
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
      // Newest call that ended in the last 3 minutes AND is on a CRM-verified SIM.
      // The SIM gate stops a call on the skipped/unverified SIM of a dual-SIM phone
      // from being surfaced and saved as a lead with the wrong number.
      final e = await DialerData.instance
          .latestVerifiedSimCall(withinMs: 3 * 60 * 1000);
      if (e == null) return;
      final number = e.number ?? '';
      if (number.isEmpty) return;
      final ts = e.timestamp ?? 0;
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
    // Post-call disposition first (outcome + follow-up chips); it continues to the
    // Call Details page on save/skip.
    await _navKey.currentState?.push(MaterialPageRoute(
      builder: (_) => PostCallScreen(
        phone: phone,
        startedAtMs: (data['date'] is int) ? data['date'] as int : 0,
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
      title: 'Hawcus Dialer',
      debugShowCheckedModeBanner: false,
      navigatorKey: _navKey,
      theme: buildTheme(),
      home: const SplashScreen(next: RootRouter()),
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
  bool _askedNotif = false;

  // Request POST_NOTIFICATIONS once per session if not already granted. Covers
  // already-onboarded users (the optional onboarding step never re-shows for them).
  Future<void> _ensureNotificationPermission() async {
    if (_askedNotif) return;
    _askedNotif = true;
    try {
      final st = await Permission.notification.status;
      if (!st.isGranted && !st.isPermanentlyDenied) {
        await Permission.notification.request();
      }
    } catch (_) {}
  }

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
   try {
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
    // Ask for notification permission here too (not just in onboarding): users who
    // already onboarded before this feature skip the gate, so this is the only place
    // they get prompted for lead-assigned + follow-up reminder notifications.
    _ensureNotificationPermission();
    Api.instance.refreshSyncConfig(); // ensure the background auto-sync service has the latest config
    if (await Api.instance.hasDeviceToken()) {
      // Repair the on-device SIM gate for users who linked on an older build, so the
      // call list isn't blank, THEN sync (both respect the verified-SIM gate).
      await Api.instance.backfillVerifiedSims();
      _syncCallLogsFallback(); // FALLBACK: mirror any calls the background service missed
      RecordingUploader.instance.start();
      RecordingHarvester.instance.run();
    } else {
      // Not linked yet - try to link in case an admin has since added this number.
      Api.instance.tryLink().then((linked) async {
        if (linked) {
          await Api.instance.backfillVerifiedSims();
          _syncCallLogsFallback();
          RecordingUploader.instance.start();
          RecordingHarvester.instance.run();
        }
      });
    }
    _set(HomeScreen(onSignOut: _resolve));
   } catch (_) {
    // Safety net: a secure-storage read (or any step) throwing on this device must
    // never trap the user on the boot spinner - fall through into the app.
    _set(HomeScreen(onSignOut: _resolve));
   }
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
