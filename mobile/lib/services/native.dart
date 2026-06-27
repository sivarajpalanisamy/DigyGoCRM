import 'package:flutter/services.dart';

/// An audio file found in an OEM call-recording folder.
class RecordingFile {
  RecordingFile({required this.path, required this.name, required this.modified, required this.size});
  final String path;
  final String name;
  final int modified; // epoch ms
  final int size;

  factory RecordingFile.fromMap(Map m) => RecordingFile(
        path: m['path'] as String,
        name: (m['name'] ?? '') as String,
        modified: (m['modified'] as num?)?.toInt() ?? 0,
        size: (m['size'] as num?)?.toInt() ?? 0,
      );
}

/// Device manufacturer / model details.
class DeviceInfo {
  DeviceInfo({required this.manufacturer, required this.brand, required this.model, required this.sdkInt});
  final String manufacturer;
  final String brand;
  final String model;
  final int sdkInt;

  /// Lower-cased brand key for matching instruction sets.
  String get brandKey {
    final s = '$manufacturer $brand'.toLowerCase();
    if (s.contains('samsung')) return 'samsung';
    if (s.contains('xiaomi') || s.contains('redmi') || s.contains('poco')) return 'xiaomi';
    if (s.contains('vivo') || s.contains('iqoo')) return 'vivo';
    if (s.contains('oppo') || s.contains('realme') || s.contains('oneplus')) return 'oppo';
    if (s.contains('motorola') || s.contains('moto')) return 'motorola';
    if (s.contains('google') || s.contains('pixel')) return 'pixel';
    return 'generic';
  }

  factory DeviceInfo.fromMap(Map m) => DeviceInfo(
        manufacturer: (m['manufacturer'] ?? '') as String,
        brand: (m['brand'] ?? '') as String,
        model: (m['model'] ?? '') as String,
        sdkInt: (m['sdkInt'] as num?)?.toInt() ?? 0,
      );
}

/// A SIM detected in the device.
class SimInfo {
  SimInfo({required this.slot, this.carrier, this.displayName, this.number});
  final int slot;
  final String? carrier;
  final String? displayName;
  final String? number;

  String get label {
    final name = displayName ?? carrier ?? 'SIM ${slot + 1}';
    if (carrier != null && carrier != displayName) return '$name - $carrier';
    return name;
  }

  factory SimInfo.fromMap(Map m) => SimInfo(
        slot: (m['slot'] ?? 0) as int,
        carrier: m['carrier'] as String?,
        displayName: m['displayName'] as String?,
        number: (m['number'] as String?)?.isEmpty == true ? null : m['number'] as String?,
      );
}

/// Result of the per-device call-recording self-test.
enum RecordingTier { full, partial, micOnly, unsupported }

class RecordingCapability {
  RecordingCapability({
    required this.tier,
    required this.voiceCall,
    required this.voiceComm,
    required this.mic,
  });

  final RecordingTier tier;
  final bool voiceCall;
  final bool voiceComm;
  final bool mic;

  String get title => switch (tier) {
        RecordingTier.full => 'Full call recording supported',
        RecordingTier.partial => 'Call recording supported',
        RecordingTier.micOnly => 'Limited recording (your side)',
        RecordingTier.unsupported => 'Recording not supported',
      };

  String get detail => switch (tier) {
        RecordingTier.full =>
          'Your device allows capturing both sides of the call. Recordings will sync to the CRM.',
        RecordingTier.partial =>
          'Your device can record calls. On some calls only your side may be captured - use speakerphone for best results.',
        RecordingTier.micOnly =>
          'Android blocks call-audio capture on this device, so only your side (via microphone) is recorded. Turn on speakerphone to also capture the other party.',
        RecordingTier.unsupported =>
          'This device does not allow call recording. Calls will still be logged to the CRM, but without audio.',
      };

  factory RecordingCapability.fromMap(Map m) {
    bool ok(String k) => (m[k] is Map) && ((m[k] as Map)['ok'] == true);
    final vc = ok('voiceCall');
    final vco = ok('voiceComm');
    final mic = ok('mic');
    final tier = vc
        ? RecordingTier.full
        : vco
            ? RecordingTier.partial
            : mic
                ? RecordingTier.micOnly
                : RecordingTier.unsupported;
    return RecordingCapability(tier: tier, voiceCall: vc, voiceComm: vco, mic: mic);
  }
}

/// Thin wrapper over the Kotlin platform channel for things the OS only exposes
/// to native code: the default-dialer role, battery settings, and SIM details.
class Native {
  Native._();
  static final Native instance = Native._();

  static const _ch = MethodChannel('digygo/dialer');

  /// Probe whether (and how well) this device can record calls.
  Future<RecordingCapability> recordingSelfTest() async {
    try {
      final res = await _ch.invokeMethod<Map>('recordingSelfTest');
      return RecordingCapability.fromMap(res ?? const {});
    } catch (_) {
      return RecordingCapability(
          tier: RecordingTier.unsupported, voiceCall: false, voiceComm: false, mic: false);
    }
  }

  // ── OEM recording harvest ──────────────────────────────────────────────────
  Future<bool> hasAllFilesAccess() async {
    try { return await _ch.invokeMethod<bool>('hasAllFilesAccess') ?? false; } catch (_) { return false; }
  }

  Future<void> requestAllFilesAccess() async {
    try { await _ch.invokeMethod('requestAllFilesAccess'); } catch (_) {}
  }

  /// Mirror base URL + device token so the background call-end receiver can auto-sync.
  Future<void> setSyncConfig({String? base, String? token}) async {
    try { await _ch.invokeMethod('setSyncConfig', {'base': base, 'token': token}); } catch (_) {}
  }

  /// Place a call through the phone's default/system dialer (the OEM dialer records it).
  Future<void> placeCallSystem(String number) async {
    try { await _ch.invokeMethod('placeCallSystem', {'number': number}); } catch (_) {}
  }

  /// Does the device have an OEM call-recording folder (feature exists)?
  Future<bool> recordingFolderExists() async {
    try { return await _ch.invokeMethod<bool>('recordingFolderExists') ?? false; } catch (_) { return false; }
  }

  /// Number of existing recording files (proof the built-in recorder is working).
  Future<int> recordingFileCount() async {
    try { return await _ch.invokeMethod<int>('recordingFileCount') ?? 0; } catch (_) { return 0; }
  }

  /// Open the phone app so the user can turn on built-in call recording.
  Future<void> openCallRecordingSettings() async {
    try { await _ch.invokeMethod('openCallRecordingSettings'); } catch (_) {}
  }

  /// Audio files in the OEM call-recording folders modified at/after [sinceMs].
  Future<List<RecordingFile>> scanRecordings(int sinceMs) async {
    try {
      final res = await _ch.invokeMethod<List<dynamic>>('scanRecordings', {'sinceMs': sinceMs});
      return (res ?? []).map((e) => RecordingFile.fromMap(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  /// Device manufacturer/brand/model - used to show brand-specific instructions
  /// for enabling the phone's built-in call recording.
  Future<DeviceInfo> deviceInfo() async {
    try {
      final m = await _ch.invokeMethod<Map>('deviceInfo');
      return DeviceInfo.fromMap(m ?? const {});
    } catch (_) {
      return DeviceInfo(manufacturer: '', brand: '', model: '', sdkInt: 0);
    }
  }

  /// Active SIMs in the device (needs READ_PHONE_STATE).
  Future<List<SimInfo>> getSims() async {
    try {
      final res = await _ch.invokeMethod<List<dynamic>>('getSims');
      return (res ?? []).map((e) => SimInfo.fromMap(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<bool> isDefaultDialer() async {
    try {
      return await _ch.invokeMethod<bool>('isDefaultDialer') ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Triggers the system "set as default dialer" dialog. Returns true if granted.
  Future<bool> requestDefaultDialer() async {
    try {
      return await _ch.invokeMethod<bool>('requestDefaultDialer') ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> isIgnoringBatteryOptimizations() async {
    try {
      return await _ch.invokeMethod<bool>('isIgnoringBatteryOptimizations') ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<void> requestIgnoreBatteryOptimizations() async {
    try {
      await _ch.invokeMethod('requestIgnoreBatteryOptimizations');
    } catch (_) {}
  }
}
