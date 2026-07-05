import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

import 'native.dart';

/// Single source of truth for talking to the DigyGo backend from the device.
///
/// The server URL is **editable in-app** (pairing screen → Server URL) and stored,
/// so a changing PC IP never requires a rebuild. The compile-time default is just
/// the initial value.
class Api {
  Api._();
  static final Api instance = Api._();

  // Compile-time default (override with --dart-define=DIGYGO_API=...).
  static const String defaultBaseUrl = String.fromEnvironment(
    'DIGYGO_API',
    defaultValue: 'http://192.168.1.9:4000',
  );

  static const _tokenKey = 'digygo_device_token';
  static const _baseKey = 'digygo_api_base';
  static const _simDoneKey = 'digygo_sim_done';
  static const _recTestKey = 'digygo_rec_test_done';
  final _store = const FlutterSecureStorage();

  String _baseUrl = defaultBaseUrl;
  String? _cachedToken;

  late final Dio _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 30),
    headers: {'x-app-version': '1.0.0'},
  ))
    ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) async {
      options.baseUrl = _baseUrl;
      final token = await _readToken();
      if (token != null) options.headers['Authorization'] = 'Bearer $token';
      handler.next(options);
    }));

  /// Load the stored server URL + token before the UI builds.
  Future<void> init() async {
    final saved = await _store.read(key: _baseKey);
    if (saved != null && saved.isNotEmpty) _baseUrl = saved;
    _cachedToken = await _store.read(key: _tokenKey);
    await _pushSyncConfig();
  }

  String get baseUrl => _baseUrl;

  Future<void> setBaseUrl(String url) async {
    _baseUrl = url.trim().replaceAll(RegExp(r'/+$'), '');
    await _store.write(key: _baseKey, value: _baseUrl);
    await _pushSyncConfig();
  }

  // Keep the native auto-sync receiver's config (base URL + token + verified SIMs) in sync.
  Future<void> _pushSyncConfig() async {
    await Native.instance.setSyncConfig(base: _baseUrl, token: _cachedToken);
    await _pushVerifiedSims();
  }
  Future<void> refreshSyncConfig() => _pushSyncConfig();

  Future<String?> _readToken() async {
    _cachedToken ??= await _store.read(key: _tokenKey);
    return _cachedToken;
  }

  Future<bool> hasDeviceToken() async => (await _readToken()) != null;

  Future<void> _saveToken(String token) async {
    _cachedToken = token;
    await _store.write(key: _tokenKey, value: token);
    await _pushSyncConfig();
  }

  Future<void> clearToken() async {
    _cachedToken = null;
    await _store.delete(key: _tokenKey);
    await _store.delete(key: _simDoneKey);
    await _store.delete(key: _recTestKey);
    await _pushSyncConfig();
  }

  // Onboarding: has the SIM/number verification step been completed (verified or skipped)?
  Future<bool> isSimStepDone() async => (await _store.read(key: _simDoneKey)) == '1';
  Future<void> markSimStepDone() async => _store.write(key: _simDoneKey, value: '1');

  // Onboarding: has the user accepted the privacy policy / terms?
  static const _privacyKey = 'digygo_privacy_ok';
  Future<bool> isPrivacyAccepted() async => (await _store.read(key: _privacyKey)) == '1';
  Future<void> markPrivacyAccepted() async => _store.write(key: _privacyKey, value: '1');

  // Onboarding: has the one-time recording self-test been shown?
  Future<bool> isRecordingTestDone() async => (await _store.read(key: _recTestKey)) == '1';
  Future<void> markRecordingTestDone() async => _store.write(key: _recTestKey, value: '1');

  // OEM recording harvest watermark - only files newer than this are uploaded.
  static const _harvestKey = 'digygo_last_harvest_ms';
  Future<int> lastHarvestMs() async {
    final v = await _store.read(key: _harvestKey);
    if (v == null) return DateTime.now().millisecondsSinceEpoch - 24 * 3600 * 1000; // first run: last 24h
    return int.tryParse(v) ?? 0;
  }
  Future<void> setLastHarvestMs(int ms) async => _store.write(key: _harvestKey, value: ms.toString());

  /// Lightweight reachability probe for the current server URL.
  Future<bool> ping() async {
    try {
      final res = await _dio.get('/health');
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Sign in with CRM email + password → store the long-lived device token.
  Future<Map<String, dynamic>> login(String email, String password, {String? deviceLabel}) async {
    final res = await _dio.post('/api/mobile/login', data: {
      'email': email,
      'password': password,
      'deviceLabel': ?deviceLabel,
      'platform': 'android',
      'appVersion': '1.0.0',
    });
    final data = Map<String, dynamic>.from(res.data as Map);
    await _saveToken(data['deviceToken'] as String);
    return data;
  }

  /// Register this device by its SIM-verified number (no login). The backend matches
  /// the number to a dashboard OTP-verified registration and returns a device token.
  /// Throws DioException with code 'not_verified' if the number isn't verified in any CRM.
  Future<Map<String, dynamic>> registerNumber({
    required String phone,
    required String method,
    int? simSlot,
    List<Map<String, dynamic>>? sims,
  }) async {
    final res = await _dio.post('/api/mobile/register-number', data: {
      'phone': phone,
      'method': method,
      'simSlot': simSlot,
      'sims': sims,
      'platform': 'android',
      'appVersion': '1.0.0',
    });
    final data = Map<String, dynamic>.from(res.data as Map);
    // Only linked (CRM-verified) numbers get a token; otherwise app runs local-only.
    if (data['deviceToken'] != null) await _saveToken(data['deviceToken'] as String);
    await addLocalNumber(phone, slot: simSlot);
    await markSimStepDone();
    return data;
  }

  // ── Local (verified-in-app) numbers - used to auto-link once added in the CRM ──
  static const _numsKey = 'digygo_local_numbers';
  static const _simsKey = 'digygo_local_sims'; // [{n, slot}] — drives the native SIM gate
  Future<List<String>> localNumbers() async {
    final v = await _store.read(key: _numsKey);
    if (v == null || v.isEmpty) return [];
    try { return (jsonDecode(v) as List).cast<String>(); } catch (_) { return []; }
  }
  Future<void> addLocalNumber(String n, {int? slot}) async {
    final list = await localNumbers();
    if (!list.contains(n)) { list.add(n); await _store.write(key: _numsKey, value: jsonEncode(list)); }
    // Track which SIM slot this verified number is on, so the background CallSync can
    // tell it apart from an unverified SIM's calls on a dual-SIM phone.
    final sims = await _localSims();
    final idx = sims.indexWhere((s) => s['n'] == n);
    if (idx >= 0) { if (slot != null) sims[idx]['slot'] = slot; }
    else { sims.add({'n': n, 'slot': slot ?? -1}); }
    await _store.write(key: _simsKey, value: jsonEncode(sims));
    await _pushVerifiedSims();
  }

  Future<List<Map<String, dynamic>>> _localSims() async {
    final v = await _store.read(key: _simsKey);
    if (v == null || v.isEmpty) return [];
    try { return (jsonDecode(v) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList(); }
    catch (_) { return []; }
  }

  // Mirror app-verified SIMs to native as [{slot, number}] for the background SIM gate.
  Future<void> _pushVerifiedSims() async {
    final sims = await _localSims();
    final payload = sims.map((s) => {'slot': s['slot'] ?? -1, 'number': s['n'] ?? ''}).toList();
    await Native.instance.setVerifiedSims(jsonEncode(payload));
  }

  /// Retry linking: if any locally-verified number has since been added in the CRM,
  /// register it and store the device token. Returns true if now linked.
  Future<bool> tryLink() async {
    if (await hasDeviceToken()) return true;
    for (final n in await localNumbers()) {
      try {
        final res = await _dio.post('/api/mobile/register-number', data: {
          'phone': n, 'method': 'auto', 'platform': 'android', 'appVersion': '1.0.0',
        });
        final data = Map<String, dynamic>.from(res.data as Map);
        if (data['deviceToken'] != null) { await _saveToken(data['deviceToken'] as String); return true; }
      } catch (_) {/* try next */}
    }
    return false;
  }

  /// Attach an ADDITIONAL SIM number to an already-registered device (dual-SIM).
  Future<void> addNumber({required String phone, required String method, int? simSlot}) async {
    await _dio.post('/api/mobile/add-number', data: {
      'phone': phone,
      'method': method,
      'simSlot': simSlot,
    });
  }

  /// Attach + verify the SIM phone number. method: 'call_log' | 'call' | 'skip'.
  Future<void> verifyNumber({
    required String phone,
    required String method,
    List<Map<String, dynamic>>? sims,
  }) async {
    await _dio.post('/api/mobile/verify-number', data: {
      'phone': phone,
      'method': method,
      'sims': sims,
    });
    await markSimStepDone();
  }

  Future<Map<String, dynamic>> me() async {
    final res = await _dio.get('/api/mobile/me');
    return Map<String, dynamic>.from(res.data as Map);
  }

  Future<Map<String, dynamic>> myStats() async {
    final res = await _dio.get('/api/mobile/me/stats');
    return Map<String, dynamic>.from(res.data as Map);
  }

  /// One page of leads. Returns the items plus whether more pages exist.
  Future<({List<dynamic> items, bool hasMore})> leads({
    String? search,
    String? pipelineId,
    String? stageId,
    int offset = 0,
    int limit = 50,
  }) async {
    final res = await _dio.get('/api/mobile/leads', queryParameters: {
      'offset': offset,
      'limit': limit,
      if (search != null && search.isNotEmpty) 'search': search,
      if (pipelineId != null && pipelineId.isNotEmpty) 'pipelineId': pipelineId,
      if (stageId != null && stageId.isNotEmpty) 'stageId': stageId,
    });
    final items = (res.data['leads'] as List?) ?? [];
    final hasMore = res.data['hasMore'] == true;
    return (items: items, hasMore: hasMore);
  }

  /// Pipelines with their stages, for the CRM Leads filter + post-call lead form.
  Future<List<dynamic>> pipelines() async {
    final res = await _dio.get('/api/mobile/pipelines');
    return (res.data['pipelines'] as List?) ?? [];
  }

  /// Look up an existing lead by phone (post-call screen).
  /// Returns {found, lead?, notes?}.
  Future<Map<String, dynamic>> lookupLead(String phone) async {
    final res = await _dio.get('/api/mobile/leads/lookup', queryParameters: {'phone': phone});
    return Map<String, dynamic>.from(res.data as Map);
  }

  /// Create a new lead from the post-call screen.
  Future<Map<String, dynamic>> createLead({
    required String name,
    required String phone,
    String? pipelineId,
    String? stageId,
    String? email,
    String? notes,
  }) async {
    final res = await _dio.post('/api/mobile/leads', data: {
      'name': name,
      'phone': phone,
      if (pipelineId != null) 'pipelineId': pipelineId,
      if (stageId != null) 'stageId': stageId,
      if (email != null && email.isNotEmpty) 'email': email,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    });
    return Map<String, dynamic>.from(res.data as Map);
  }

  /// Update an existing lead (move stage/pipeline and/or add a note).
  Future<Map<String, dynamic>> updateLead(String id, {String? stageId, String? pipelineId, String? note}) async {
    final res = await _dio.post('/api/mobile/leads/$id/update', data: {
      if (stageId != null) 'stageId': stageId,
      if (pipelineId != null) 'pipelineId': pipelineId,
      if (note != null && note.isNotEmpty) 'note': note,
    });
    return Map<String, dynamic>.from(res.data as Map);
  }

  /// Full lead detail: {lead, tags, activities, calls}.
  Future<Map<String, dynamic>> leadDetails(String id) async {
    final res = await _dio.get('/api/mobile/leads/$id/details');
    return Map<String, dynamic>.from(res.data as Map);
  }

  /// Schedule a follow-up. dueAt is an ISO-8601 timestamp.
  Future<void> addFollowup(String leadId, {required String dueAt, String? title, String? note}) async {
    await _dio.post('/api/mobile/leads/$leadId/followup', data: {
      'dueAt': dueAt,
      if (title != null) 'title': title,
      if (note != null && note.isNotEmpty) 'note': note,
    });
  }

  /// Add a tag to a lead.
  Future<void> addTag(String leadId, String tag) async {
    await _dio.post('/api/mobile/leads/$leadId/tag', data: {'tag': tag});
  }

  /// Follow-ups assigned to this device's staff. status: pending | completed | all.
  Future<List<dynamic>> followups({String status = 'pending'}) async {
    final res = await _dio.get('/api/mobile/followups', queryParameters: {'status': status});
    return (res.data['followups'] as List?) ?? [];
  }

  /// Mark a follow-up complete (or undo).
  Future<void> completeFollowup(String id, {bool completed = true}) async {
    await _dio.post('/api/mobile/followups/$id/complete', data: {'completed': completed});
  }

  /// Download a call recording (auth via interceptor) to a temp file; returns its path.
  Future<String> downloadRecording(String callId) async {
    final res = await _dio.get('/api/mobile/calls/$callId/recording',
        options: Options(responseType: ResponseType.bytes));
    final dir = await getTemporaryDirectory();
    final f = File('${dir.path}/rec_$callId.audio');
    await f.writeAsBytes(res.data as List<int>);
    return f.path;
  }

  /// Active staff in the tenant (for the assign-staff picker).
  Future<List<dynamic>> staff() async {
    final res = await _dio.get('/api/mobile/staff');
    return (res.data['staff'] as List?) ?? [];
  }

  /// Reassign a lead (assignedTo = null to unassign). Requires leads:assign in CRM.
  Future<void> assignLead(String leadId, String? assignedTo) async {
    await _dio.post('/api/mobile/leads/$leadId/assign', data: {'assignedTo': assignedTo});
  }

  /// Post one or many calls (offline batch). Returns the ingest summary. When [simCount]
  /// is given, the batch is sent as an envelope so the backend knows this is a SIM-aware
  /// client and whether the device is multi-SIM (drives its fail-closed SIM enforcement).
  Future<Map<String, dynamic>> postCalls(List<Map<String, dynamic>> calls, {int? simCount}) async {
    final data = simCount != null ? {'calls': calls, 'simCount': simCount} : calls;
    final res = await _dio.post('/api/mobile/calls', data: data);
    return Map<String, dynamic>.from(res.data as Map);
  }

  // ── Post-call dispositions (mirror the web flow) ─────────────────────────────
  List<Map<String, dynamic>>? _dispCache;

  /// Tenant's post-call outcome options. Cached in-memory after the first fetch so
  /// the post-call screen renders instantly; falls back to the cache (or []) on error.
  Future<List<Map<String, dynamic>>> dispositions({bool force = false}) async {
    if (_dispCache != null && !force) return _dispCache!;
    try {
      final res = await _dio.get('/api/mobile/dispositions');
      final list = (res.data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      _dispCache = list;
      return list;
    } catch (_) {
      return _dispCache ?? [];
    }
  }

  /// Save a post-call disposition (+ optional follow-up) for the call matched by
  /// phone + start time. follow_up_date is 'yyyy-MM-dd', follow_up_time is 'HH:mm'.
  Future<Map<String, dynamic>> postCallDisposition({
    required String phone,
    required int startedAtMs,
    required String dispositionKey,
    String? followUpDate,
    String? followUpTime,
    String? note,
  }) async {
    final res = await _dio.post('/api/mobile/calls/by-key/post-call', data: {
      'phone': phone,
      'startedAt': startedAtMs.toString(),
      'disposition_key': dispositionKey,
      if (followUpDate != null && followUpDate.isNotEmpty) 'follow_up_date': followUpDate,
      if (followUpTime != null && followUpTime.isNotEmpty) 'follow_up_time': followUpTime,
      if (note != null && note.isNotEmpty) 'note': note,
    });
    return Map<String, dynamic>.from(res.data as Map);
  }

  /// "Set Follow-Up" outcome from the lead details quick action: records the
  /// disposition on the lead (sets quality + logs the outcome) and optionally
  /// schedules a follow-up.
  Future<Map<String, dynamic>> leadDisposition(
    String leadId, {
    required String dispositionKey,
    String? note,
    String? followUpDate,
    String? followUpTime,
  }) async {
    final res = await _dio.post('/api/mobile/leads/$leadId/disposition', data: {
      'disposition_key': dispositionKey,
      if (note != null && note.isNotEmpty) 'note': note,
      if (followUpDate != null && followUpDate.isNotEmpty) 'follow_up_date': followUpDate,
      if (followUpTime != null && followUpTime.isNotEmpty) 'follow_up_time': followUpTime,
    });
    return Map<String, dynamic>.from(res.data as Map);
  }

  // ── Per-call notes ───────────────────────────────────────────────────────────
  static const _notesKey = 'digygo_call_notes';
  Future<Map<String, String>> _allNotes() async {
    final v = await _store.read(key: _notesKey);
    if (v == null || v.isEmpty) return {};
    try { return (jsonDecode(v) as Map).map((k, val) => MapEntry(k.toString(), val.toString())); }
    catch (_) { return {}; }
  }
  Future<Map<String, String>> notes() => _allNotes();
  Future<void> _saveNoteLocal(String key, String note) async {
    final m = await _allNotes();
    m[key] = note;
    await _store.write(key: _notesKey, value: jsonEncode(m));
  }

  /// Save a note (+ optional tag) for a call. Stores locally and updates the CRM
  /// (matched by phone + start time). Remote update is best-effort if not linked.
  Future<void> saveCallNote({
    required String clientKey,
    required String phone,
    required int startedAtMs,
    required String note,
    String? tag,
  }) async {
    await _saveNoteLocal(clientKey, note);
    if (!await hasDeviceToken()) return; // not linked → local only
    await _dio.post('/api/mobile/calls/by-key/note', data: {
      'phone': phone,
      'startedAt': startedAtMs.toString(),
      'note': note,
      'tag': tag,
    });
  }

  /// Upload a call recording, matched server-side to the call by phone + start time.
  Future<void> uploadRecordingByKey({required String filePath, String? phone, int? startedAt}) async {
    final form = FormData.fromMap({
      'phone': phone ?? '',
      'startedAt': (startedAt ?? 0).toString(),
      'recording': await MultipartFile.fromFile(filePath, filename: filePath.split(RegExp(r'[\\/]')).last),
    });
    await _dio.post('/api/mobile/calls/by-key/recording', data: form);
  }
}
