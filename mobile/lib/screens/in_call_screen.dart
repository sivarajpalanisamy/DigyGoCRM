import 'dart:async';
import 'package:flutter/material.dart';

import '../theme.dart';
import '../services/phone_call.dart';

/// Full-screen in-app call UI, driven by the native call-state stream.
/// Shows incoming (answer/reject) or active (mute/speaker/hold/keypad/end) controls.
/// Pops itself when the call ends.
class InCallScreen extends StatefulWidget {
  const InCallScreen({super.key, required this.initial});
  final CallState initial;

  @override
  State<InCallScreen> createState() => _InCallScreenState();
}

class _InCallScreenState extends State<InCallScreen> {
  late CallState _call = widget.initial;
  StreamSubscription<CallState>? _sub;
  Timer? _ticker;
  int _seconds = 0;

  @override
  void initState() {
    super.initState();
    _sub = PhoneCall.instance.stream.listen((s) {
      if (!mounted) return;
      setState(() => _call = s);
      if (s.isActive && _ticker == null) {
        _ticker = Timer.periodic(const Duration(seconds: 1), (_) => setState(() => _seconds++));
      }
      if (!s.isOngoing) {
        // Call ended - close after a brief beat.
        Future.delayed(const Duration(milliseconds: 600), () {
          if (mounted) Navigator.of(context).maybePop();
        });
      }
    }, onError: (_) {}); // never let a bad native event crash the in-call screen
  }

  @override
  void dispose() {
    _sub?.cancel();
    _ticker?.cancel();
    super.dispose();
  }

  String get _statusLabel {
    switch (_call.state) {
      case 'dialing':
      case 'new':
        return 'Calling…';
      case 'ringing':
        return _call.isIncoming ? 'Incoming call' : 'Ringing…';
      case 'active':
        final m = (_seconds ~/ 60).toString().padLeft(2, '0');
        final s = (_seconds % 60).toString().padLeft(2, '0');
        return '$m:$s';
      case 'holding':
        return 'On hold';
      case 'disconnecting':
      case 'disconnected':
        return 'Call ended';
      default:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final number = _call.number ?? 'Unknown';
    final showIncomingControls = _call.isRinging && _call.isIncoming;

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: const Color(0xFF1C1410),
        body: SafeArea(
          child: Column(
            children: [
              const Spacer(flex: 2),
              CircleAvatar(
                radius: 56,
                backgroundColor: Brand.accent.withValues(alpha: 0.2),
                child: Text(
                  number.isNotEmpty && number != 'Unknown' ? number.characters.first : '#',
                  style: const TextStyle(fontSize: 44, color: Colors.white, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(height: 24),
              Text(number,
                  style: const TextStyle(fontSize: 26, color: Colors.white, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Text(_statusLabel, style: const TextStyle(fontSize: 16, color: Colors.white70)),
              const Spacer(flex: 2),
              if (showIncomingControls)
                _incomingControls()
              else
                _activeControls(),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _incomingControls() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _bigButton(Icons.call_end, const Color(0xFFDC2626), 'Decline', () => PhoneCall.instance.reject()),
        _bigButton(Icons.call, const Color(0xFF16A34A), 'Answer', () => PhoneCall.instance.answer()),
      ],
    );
  }

  Widget _activeControls() {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _toggle(Icons.mic_off, 'Mute', _call.muted, () => PhoneCall.instance.mute(!_call.muted)),
            _toggle(Icons.volume_up, 'Speaker', _call.speaker, () => PhoneCall.instance.speaker(!_call.speaker)),
            _toggle(Icons.pause, 'Hold', _call.state == 'holding',
                () => PhoneCall.instance.hold(_call.state != 'holding')),
          ],
        ),
        const SizedBox(height: 36),
        _bigButton(Icons.call_end, const Color(0xFFDC2626), 'End', () => PhoneCall.instance.hangup()),
      ],
    );
  }

  Widget _bigButton(IconData icon, Color color, String label, VoidCallback onTap) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: onTap,
          child: Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            child: Icon(icon, color: Colors.white, size: 32),
          ),
        ),
        const SizedBox(height: 10),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 13)),
      ],
    );
  }

  Widget _toggle(IconData icon, String label, bool on, VoidCallback onTap) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: onTap,
          child: Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: on ? Colors.white : Colors.white24,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: on ? Brand.ink : Colors.white, size: 26),
          ),
        ),
        const SizedBox(height: 8),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }
}
