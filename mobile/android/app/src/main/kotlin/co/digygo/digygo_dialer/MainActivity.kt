package co.digygo.digygo_dialer

import android.Manifest
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.telecom.TelecomManager
import android.telephony.SubscriptionManager
import java.io.File
import androidx.annotation.NonNull
import androidx.core.app.ActivityCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * Exposes the OS bits that only native code can reach for the DigyGo Dialer:
 *  - default-dialer role (RoleManager / TelecomManager)
 *  - battery-optimisation exemption
 *
 * The full InCallService dialer + call/recording capture land in the next
 * milestone; this milestone wires the onboarding gate's native checks.
 */
class MainActivity : FlutterActivity() {

    private val channel = "digygo/dialer"
    private val reqDefaultDialer = 4101
    private var pendingResult: MethodChannel.Result? = null
    private var methodChannel: MethodChannel? = null
    // Set when launched/resumed from a post-call notification, consumed by Flutter.
    private var pendingCallDetails: Map<String, Any?>? = null

    override fun configureFlutterEngine(@NonNull flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val mc = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channel)
        methodChannel = mc
        mc.setMethodCallHandler { call, result ->
            when (call.method) {
                "consumePendingCallDetails" -> {
                    result.success(pendingCallDetails)
                    pendingCallDetails = null
                }
                "isDefaultDialer" -> result.success(isDefaultDialer())
                "requestDefaultDialer" -> requestDefaultDialer(result)
                "isIgnoringBatteryOptimizations" -> result.success(isIgnoringBattery())
                "requestIgnoreBatteryOptimizations" -> {
                    requestIgnoreBattery()
                    result.success(null)
                }
                // ── In-app call controls ──────────────────────────────────────
                "placeCall" -> { placeCall(call.argument<String>("number") ?: ""); result.success(true) }
                "placeCallSystem" -> { placeCallSystem(call.argument<String>("number") ?: ""); result.success(true) }
                "answer"    -> { CallManager.answer(); result.success(true) }
                "reject"    -> { CallManager.reject(); result.success(true) }
                "hangup"    -> { CallManager.hangup(); result.success(true) }
                "mute"      -> { CallManager.setMuted(call.argument<Boolean>("on") ?: false); result.success(true) }
                "speaker"   -> { CallManager.setSpeaker(call.argument<Boolean>("on") ?: false); result.success(true) }
                "hold"      -> { CallManager.hold(call.argument<Boolean>("on") ?: false); result.success(true) }
                "dtmf"      -> { CallManager.dtmf(call.argument<String>("digit") ?: ""); result.success(true) }
                "hasActiveCall" -> result.success(CallManager.hasActiveCall())
                "getSims" -> result.success(getSims())
                "deviceInfo" -> result.success(mapOf(
                    "manufacturer" to (Build.MANUFACTURER ?: ""),
                    "brand" to (Build.BRAND ?: ""),
                    "model" to (Build.MODEL ?: ""),
                    "sdkInt" to Build.VERSION.SDK_INT
                ))
                "recordingSelfTest" -> runRecordingSelfTest(result)
                "hasAllFilesAccess" -> result.success(hasAllFilesAccess())
                "requestAllFilesAccess" -> { requestAllFilesAccess(); result.success(null) }
                "scanRecordings" -> result.success(scanRecordings((call.argument<Number>("sinceMs"))?.toLong() ?: 0L))
                "recordingFolderExists" -> result.success(recordingFolderExists())
                "recordingFileCount" -> result.success(recordingFileCount())
                "openCallRecordingSettings" -> { openCallRecordingSettings(); result.success(null) }
                "setSyncConfig" -> {
                    setSyncConfig(call.argument<String>("base"), call.argument<String>("token"))
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }

        // Call-state stream → Flutter
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, "digygo/call_events")
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    CallManager.setEventSink(events)
                }
                override fun onCancel(arguments: Any?) {
                    CallManager.setEventSink(null)
                }
            })

        // Process a launch intent from a post-call notification (cold start): store it
        // for Flutter to consume once its handler is ready.
        handleCallIntent(intent, live = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // App already running → deliver straight to Flutter.
        handleCallIntent(intent, live = true)
    }

    // Pull the post-call details out of a notification intent and route them to Flutter.
    private fun handleCallIntent(intent: Intent?, live: Boolean) {
        val phone = intent?.getStringExtra("dg_call_phone") ?: return
        if (phone.isBlank()) return
        val data = mapOf(
            "phone" to phone,
            "direction" to (intent.getStringExtra("dg_call_direction") ?: ""),
            "outcome" to (intent.getStringExtra("dg_call_outcome") ?: ""),
            "duration" to intent.getIntExtra("dg_call_duration", 0),
            "date" to intent.getLongExtra("dg_call_ts", 0L)
        )
        intent.removeExtra("dg_call_phone") // don't reprocess on rotation/resume
        if (live && methodChannel != null) {
            methodChannel?.invokeMethod("openCallDetails", data)
        } else {
            pendingCallDetails = data
        }
    }

    @Suppress("DEPRECATION")
    private fun getSims(): List<Map<String, Any?>> {
        val out = ArrayList<Map<String, Any?>>()
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE)
            != PackageManager.PERMISSION_GRANTED) return out
        try {
            val sm = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
            val subs = sm.activeSubscriptionInfoList ?: return out
            for (info in subs) {
                out.add(
                    hashMapOf(
                        "slot" to info.simSlotIndex,
                        "carrier" to info.carrierName?.toString(),
                        "displayName" to info.displayName?.toString(),
                        "number" to (info.number ?: "")
                    )
                )
            }
        } catch (e: SecurityException) {
            // permission revoked mid-call - return what we have
        }
        return out
    }

    // Probes each audio source off-call: can it init/record, and does it capture signal?
    // VOICE_CALL succeeding here means the device permits call-audio capture (rare on
    // Android 10+). Runs on a background thread to avoid blocking the UI.
    private fun runRecordingSelfTest(result: MethodChannel.Result) {
        Thread {
            val out = HashMap<String, Any?>()
            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread { result.success(hashMapOf("permission" to false)) }
                return@Thread
            }
            out["permission"] = true
            for ((key, src) in listOf(
                "voiceCall" to MediaRecorder.AudioSource.VOICE_CALL,
                "voiceComm" to MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                "mic" to MediaRecorder.AudioSource.MIC
            )) {
                out[key] = probeSource(src)
            }
            runOnUiThread { result.success(out) }
        }.start()
    }

    private fun probeSource(src: Int): Map<String, Any?> {
        var r: MediaRecorder? = null
        val tmp = File(cacheDir, "selftest_${src}.m4a")
        try {
            r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
            r.setAudioSource(src)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setOutputFile(tmp.absolutePath)
            r.prepare()
            r.start()
            var maxAmp = 0
            repeat(8) {
                Thread.sleep(180)
                val a = try { r.maxAmplitude } catch (e: Exception) { 0 }
                if (a > maxAmp) maxAmp = a
            }
            r.stop()
            return hashMapOf("ok" to true, "amplitude" to maxAmp)
        } catch (e: Exception) {
            return hashMapOf("ok" to false, "amplitude" to 0)
        } finally {
            try { r?.release() } catch (e: Exception) {}
            try { tmp.delete() } catch (e: Exception) {}
        }
    }

    // ── OEM call-recording harvest (the "Callyzer method") ─────────────────────
    private fun hasAllFilesAccess(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestAllFilesAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
            } catch (e: Exception) {
                startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            }
        }
    }

    // Known OEM call-recording folders (fast-path seeds). Auto-discovery below finds
    // the rest, so OEM-specific paths (OnePlus/Oppo/ColorOS/Samsung/Xiaomi) don't all
    // need to be listed.
    private val recordingDirs = listOf(
        "Recordings/Call", "Recordings/Call Recordings", "Recordings/PhoneRecord",
        "Call recordings", "Call Recordings", "CallRecordings", "Call",
        "Sounds/CallRecordings", "Music/Recordings/Call Recordings",
        "MIUI/sound_recorder/call_rec", "MIUI/sound_recorder",
        "Record/Call", "Record/PhoneRecord", "PhoneRecord",
        "Android/media/com.samsung.android.app.telephonyui/CallRecordings",
        "Android/media/com.oneplus.soundrecorder/Recordings/Call Recordings",
        "Android/media/com.oplus.soundrecorder/Recordings/Call Recordings",
        "Android/media/com.coloros.soundrecorder/Recordings/Call Recordings"
    )
    private val audioExt = listOf(".mp3", ".m4a", ".amr", ".wav", ".aac", ".3gp", ".ogg")
    // Directory-name hints that a folder may hold recordings (for auto-discovery).
    private val recDirHints = listOf("call", "record", "voice", "sound", "recording")

    private fun looksLikeRecDir(name: String): Boolean {
        val n = name.lowercase()
        return recDirHints.any { n.contains(it) }
    }

    // Heuristic: does this file path look like a CALL recording (vs a voice memo)?
    private fun looksLikeCallRecording(path: String): Boolean {
        val p = path.lowercase()
        return p.contains("call") || p.contains("phonerecord") || p.contains("/record/")
    }

    // Returns call-recording audio files modified at/after sinceMs. Combines the known
    // seed folders with an auto-discovery walk so it works across OEMs (OnePlus etc.).
    private fun scanRecordings(sinceMs: Long): List<Map<String, Any?>> {
        if (!hasAllFilesAccess()) return emptyList()
        val out = HashMap<String, Map<String, Any?>>()
        val root = Environment.getExternalStorageDirectory()
        // 1) Known folders - trusted, take any audio inside.
        for (rel in recordingDirs) {
            val dir = File(root, rel)
            if (dir.isDirectory) collect(dir, sinceMs, out, 0, true)
        }
        // 2) Auto-discover call-recording audio anywhere under storage.
        autoDiscover(root, sinceMs, out, 0)
        // 3) Android/media/<pkg> is readable (unlike Android/data) - many OEMs store here.
        File(root, "Android/media").listFiles()?.forEach { pkg ->
            if (pkg.isDirectory) autoDiscover(pkg, sinceMs, out, 0)
        }
        return out.values.toList()
    }

    private fun collect(dir: File, sinceMs: Long, out: HashMap<String, Map<String, Any?>>, depth: Int, trusted: Boolean) {
        if (depth > 3) return
        val files = dir.listFiles() ?: return
        for (f in files) {
            if (f.isDirectory) { collect(f, sinceMs, out, depth + 1, trusted); continue }
            val lower = f.name.lowercase()
            if (audioExt.none { lower.endsWith(it) }) continue
            if (f.lastModified() < sinceMs) continue
            if (!trusted && !looksLikeCallRecording(f.absolutePath)) continue
            out[f.absolutePath] = hashMapOf(
                "path" to f.absolutePath, "name" to f.name,
                "modified" to f.lastModified(), "size" to f.length()
            )
        }
    }

    // Walk the tree, descending into recording-like folders (and one level from the root),
    // collecting audio whose path looks like a call recording.
    private fun autoDiscover(dir: File, sinceMs: Long, out: HashMap<String, Map<String, Any?>>, depth: Int) {
        if (depth > 5) return
        val files = dir.listFiles() ?: return
        for (f in files) {
            if (f.isDirectory) {
                if (depth == 0 && f.name.equals("Android", true)) continue // via Android/media
                if (depth == 0 || looksLikeRecDir(f.name)) autoDiscover(f, sinceMs, out, depth + 1)
            } else {
                val lower = f.name.lowercase()
                if (audioExt.none { lower.endsWith(it) }) continue
                if (f.lastModified() < sinceMs) continue
                if (!looksLikeCallRecording(f.absolutePath)) continue
                out[f.absolutePath] = hashMapOf(
                    "path" to f.absolutePath, "name" to f.name,
                    "modified" to f.lastModified(), "size" to f.length()
                )
            }
        }
    }

    // Does this device have any call recordings we can read (proof the feature works)?
    private fun recordingFolderExists(): Boolean {
        if (!hasAllFilesAccess()) return false
        if (scanRecordings(0L).isNotEmpty()) return true
        val root = Environment.getExternalStorageDirectory()
        return recordingDirs.any { File(root, it).isDirectory }
    }

    // How many recording files we can see (proof the built-in recorder is working).
    private fun recordingFileCount(): Int = scanRecordings(0L).size

    // Best-effort: open the default phone app so the user can toggle call recording.
    // Android exposes no universal deep link to the OEM call-recording setting.
    private fun openCallRecordingSettings() {
        try {
            val tm = getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            val pkg = tm.defaultDialerPackage
            val launch = if (pkg != null) packageManager.getLaunchIntentForPackage(pkg) else null
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(launch)
                return
            }
        } catch (e: Exception) { /* fall through */ }
        try {
            startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {}
    }

    // Mirror base URL + device token so the background CallSync (receiver + service)
    // can auto-sync. Also start/stop the foreground sync service: starting it here is
    // allowed even on Android 12+ because this runs while the app is in the foreground.
    private fun setSyncConfig(base: String?, token: String?) {
        val prefs = getSharedPreferences(CallSync.PREFS, Context.MODE_PRIVATE).edit()
        if (base != null) prefs.putString("base", base) else prefs.remove("base")
        if (token != null) prefs.putString("token", token) else prefs.remove("token")
        prefs.apply()

        if (token != null) CallSyncService.start(applicationContext)
        else CallSyncService.stop(applicationContext)
    }

    private fun placeCall(number: String) {
        if (number.isBlank()) return
        val tm = getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        val uri = Uri.fromParts("tel", number, null)
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE)
            == PackageManager.PERMISSION_GRANTED) {
            tm.placeCall(uri, Bundle())
        }
    }

    // Show a chooser of ALL installed dialer apps so the agent can pick which one places
    // (and records) the call. ACTION_CALL would dial directly through the default phone
    // app with no chooser; ACTION_DIAL is handled by every dialer, so the chooser lists
    // them all - the chosen app opens with the number ready to call.
    private fun placeCallSystem(number: String) {
        if (number.isBlank()) return
        val uri = Uri.parse("tel:" + Uri.encode(number))
        val dial = Intent(Intent.ACTION_DIAL, uri)
        try {
            val chooser = Intent.createChooser(dial, "Call using")
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(chooser)
        } catch (e: Exception) {
            try { startActivity(dial.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e2: Exception) {}
        }
    }

    private fun isDefaultDialer(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val rm = getSystemService(RoleManager::class.java)
            rm != null && rm.isRoleAvailable(RoleManager.ROLE_DIALER) && rm.isRoleHeld(RoleManager.ROLE_DIALER)
        } else {
            val tm = getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            tm.defaultDialerPackage == packageName
        }
    }

    private fun requestDefaultDialer(result: MethodChannel.Result) {
        if (isDefaultDialer()) {
            result.success(true)
            return
        }
        pendingResult = result
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val rm = getSystemService(RoleManager::class.java)
                val intent = rm.createRequestRoleIntent(RoleManager.ROLE_DIALER)
                startActivityForResult(intent, reqDefaultDialer)
            } else {
                val intent = Intent(TelecomManager.ACTION_CHANGE_DEFAULT_DIALER)
                    .putExtra(TelecomManager.EXTRA_CHANGE_DEFAULT_DIALER_PACKAGE_NAME, packageName)
                startActivityForResult(intent, reqDefaultDialer)
            }
        } catch (e: Exception) {
            pendingResult = null
            result.success(false)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == reqDefaultDialer) {
            pendingResult?.success(isDefaultDialer())
            pendingResult = null
        }
    }

    private fun isIgnoringBattery(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun requestIgnoreBattery() {
        try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:$packageName"))
            startActivity(intent)
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }
}
