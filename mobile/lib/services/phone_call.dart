import 'package:flutter/services.dart';

/// A snapshot of the active call, pushed from the native InCallService.
class CallState {
  CallState({
    required this.state,
    this.number,
    this.direction = 'outgoing',
    this.muted = false,
    this.speaker = false,
  });

  final String state; // none, new, dialing, ringing, active, holding, disconnecting, disconnected
  final String? number;
  final String direction; // incoming | outgoing
  final bool muted;
  final bool speaker;

  bool get isIncoming => direction == 'incoming';
  bool get isRinging => state == 'ringing';
  bool get isActive => state == 'active';
  bool get isOngoing =>
      const ['new', 'dialing', 'ringing', 'active', 'holding', 'disconnecting'].contains(state);

  // Lenient parsing - a malformed/typed-differently native payload must never throw
  // into the call-state stream (that would be an uncaught error on some OEM builds).
  factory CallState.fromMap(Map<dynamic, dynamic> m) => CallState(
        state: (m['state'] ?? 'none').toString(),
        number: m['number']?.toString(),
        direction: (m['direction'] ?? 'outgoing').toString(),
        muted: m['muted'] == true,
        speaker: m['speaker'] == true,
      );
}

/// A finished recording emitted by the native recorder when a call ends.
class RecordingEvent {
  RecordingEvent({required this.path, this.number, this.startedAt});
  final String path;
  final String? number;
  final int? startedAt;

  factory RecordingEvent.fromMap(Map m) => RecordingEvent(
        path: (m['path'] ?? '').toString(),
        number: m['number']?.toString(),
        startedAt: (m['startedAt'] as num?)?.toInt(),
      );
}

/// Drives the in-app dialer via the native platform channels.
class PhoneCall {
  PhoneCall._();
  static final PhoneCall instance = PhoneCall._();

  static const _ch = MethodChannel('hawcus/dialer');
  static const _events = EventChannel('hawcus/call_events');

  Stream<Map>? _raw;
  Stream<Map> get _rawStream =>
      _raw ??= _events.receiveBroadcastStream().map((e) => e as Map).asBroadcastStream();

  /// Call-state updates (incoming/outgoing/active/ended).
  Stream<CallState> get stream =>
      _rawStream.where((m) => m['event'] == 'state').map(CallState.fromMap);

  /// Finished call recordings, ready to upload.
  Stream<RecordingEvent> get recordings =>
      _rawStream.where((m) => m['event'] == 'recording').map(RecordingEvent.fromMap);

  // All call-control channel calls are guarded: a PlatformException from the native
  // telecom layer (no active call, OEM telecom quirk, permission) must not become an
  // uncaught async error - the control simply no-ops instead of killing the action.
  /// Place a call through our own dialer (routes to our InCallService when we are
  /// the default dialer, so the call runs inside the app).
  Future<void> placeCall(String number) async {
    try { await _ch.invokeMethod('placeCall', {'number': number}); } catch (_) {}
  }

  Future<void> answer() async { try { await _ch.invokeMethod('answer'); } catch (_) {} }
  Future<void> reject() async { try { await _ch.invokeMethod('reject'); } catch (_) {} }
  Future<void> hangup() async { try { await _ch.invokeMethod('hangup'); } catch (_) {} }
  Future<void> mute(bool on) async { try { await _ch.invokeMethod('mute', {'on': on}); } catch (_) {} }
  Future<void> speaker(bool on) async { try { await _ch.invokeMethod('speaker', {'on': on}); } catch (_) {} }
  Future<void> hold(bool on) async { try { await _ch.invokeMethod('hold', {'on': on}); } catch (_) {} }
  Future<void> dtmf(String digit) async { try { await _ch.invokeMethod('dtmf', {'digit': digit}); } catch (_) {} }
}
