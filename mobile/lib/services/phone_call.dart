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

  factory CallState.fromMap(Map<dynamic, dynamic> m) => CallState(
        state: (m['state'] ?? 'none') as String,
        number: m['number'] as String?,
        direction: (m['direction'] ?? 'outgoing') as String,
        muted: (m['muted'] ?? false) as bool,
        speaker: (m['speaker'] ?? false) as bool,
      );
}

/// A finished recording emitted by the native recorder when a call ends.
class RecordingEvent {
  RecordingEvent({required this.path, this.number, this.startedAt});
  final String path;
  final String? number;
  final int? startedAt;

  factory RecordingEvent.fromMap(Map m) => RecordingEvent(
        path: m['path'] as String,
        number: m['number'] as String?,
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

  /// Place a call through our own dialer (routes to our InCallService when we are
  /// the default dialer, so the call runs inside the app).
  Future<void> placeCall(String number) async {
    await _ch.invokeMethod('placeCall', {'number': number});
  }

  Future<void> answer() => _ch.invokeMethod('answer');
  Future<void> reject() => _ch.invokeMethod('reject');
  Future<void> hangup() => _ch.invokeMethod('hangup');
  Future<void> mute(bool on) => _ch.invokeMethod('mute', {'on': on});
  Future<void> speaker(bool on) => _ch.invokeMethod('speaker', {'on': on});
  Future<void> hold(bool on) => _ch.invokeMethod('hold', {'on': on});
  Future<void> dtmf(String digit) => _ch.invokeMethod('dtmf', {'digit': digit});
}
