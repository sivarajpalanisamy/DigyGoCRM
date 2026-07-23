package co.hawcus.dialer

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.InCallService
import androidx.core.app.ActivityCompat
import io.flutter.plugin.common.EventChannel
import java.io.File

/**
 * Singleton bridge between Android's telephony (InCallService + Call) and Flutter.
 * Holds the active call, streams its state to Dart, and exposes call controls.
 */
object CallManager {
    private var inCallService: InCallService? = null
    private var currentCall: Call? = null
    private var direction: String = "outgoing"
    private var eventSink: EventChannel.EventSink? = null

    // ── Recording (best-effort; OS-limited on Android 10+) ────────────────────
    private var recorder: MediaRecorder? = null
    private var recordingPath: String? = null
    private var recordingNumber: String? = null
    private var recordingStart: Long = 0L
    private var recordingSlot: Int? = null   // SIM slot of the call being recorded (for the upload gate)
    private var recCtx: Context? = null      // app context, so we can enqueue the upload even after the service detaches

    private val callback = object : Call.Callback() {
        override fun onStateChanged(call: Call, state: Int) {
            if (state == Call.STATE_ACTIVE) startRecording()
            if (state == Call.STATE_DISCONNECTED) stopRecording()
            captureSimSlot(call)
            emitState()
        }
        override fun onDetailsChanged(call: Call, details: Call.Details) {
            captureSimSlot(call)
            emitState()
        }
    }

    fun setEventSink(sink: EventChannel.EventSink?) {
        eventSink = sink
        emitState()
    }

    fun attachService(service: InCallService) { inCallService = service }
    fun detachService() { inCallService = null }

    fun onCallAdded(call: Call) {
        currentCall = call
        direction = if (call.state == Call.STATE_RINGING) "incoming" else "outgoing"
        call.registerCallback(callback)
        captureSimSlot(call)
        emitState()
    }

    // Record which SIM slot this live call used, resolved from its PhoneAccountHandle (which
    // is authoritative even on MIUI/Redmi where the later call-log row carries no usable SIM
    // id). CallSync consults this at sync time so the strict SIM gate can attribute the call.
    private fun captureSimSlot(call: Call) {
        try {
            val ctx = inCallService ?: return
            val handle = call.details?.accountHandle ?: return
            val number = call.details?.handle?.schemeSpecificPart ?: return
            val slot = CallSync.slotForAccountHandle(ctx, handle) ?: return
            CallSync.recordCallSlot(ctx, number, slot)
        } catch (e: Exception) { /* best-effort */ }
    }

    fun onCallRemoved(call: Call) {
        stopRecording()
        call.unregisterCallback(callback)
        if (currentCall == call) currentCall = null
        emitState()
    }

    fun hasActiveCall(): Boolean = currentCall != null

    private fun stateName(state: Int): String = when (state) {
        Call.STATE_NEW -> "new"
        Call.STATE_CONNECTING -> "dialing"
        Call.STATE_DIALING -> "dialing"
        Call.STATE_RINGING -> "ringing"
        Call.STATE_ACTIVE -> "active"
        Call.STATE_HOLDING -> "holding"
        Call.STATE_DISCONNECTING -> "disconnecting"
        Call.STATE_DISCONNECTED -> "disconnected"
        else -> "unknown"
    }

    private fun emitState() {
        val call = currentCall
        val map = HashMap<String, Any?>()
        map["event"] = "state"
        if (call == null) {
            map["state"] = "none"
        } else {
            map["state"] = stateName(call.state)
            map["direction"] = direction
            map["number"] = call.details?.handle?.schemeSpecificPart
            val audio = inCallService?.callAudioState
            map["muted"] = audio?.isMuted ?: false
            map["speaker"] = (audio?.route ?: 0) == CallAudioState.ROUTE_SPEAKER
        }
        eventSink?.success(map)
    }

    // Try VOICE_CALL → VOICE_COMMUNICATION → MIC (device-dependent; many block VOICE_CALL).
    // MIC always works (Android 10+ blocks the call-audio sources on most devices), so as the
    // default dialer we ALWAYS produce a recording file - the reliable path on MIUI/Redmi where
    // the OEM recorder saves nothing harvestable.
    private fun startRecording() {
        if (recorder != null) return
        val ctx = inCallService ?: return
        // No RECORD_AUDIO → we cannot record. Skip cleanly (the OEM harvest path may still work).
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
        val number = currentCall?.details?.handle?.schemeSpecificPart ?: "unknown"
        val slot = try { CallSync.slotForAccountHandle(ctx, currentCall?.details?.accountHandle) } catch (e: Exception) { null }
        val dir = File(ctx.filesDir, "recordings").apply { mkdirs() }
        val start = System.currentTimeMillis()
        val file = File(dir, "rec_${start}.m4a")
        val sources = intArrayOf(
            MediaRecorder.AudioSource.VOICE_CALL,
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            MediaRecorder.AudioSource.MIC
        )
        for (src in sources) {
            try {
                val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
                r.setAudioSource(src)
                r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                r.setOutputFile(file.absolutePath)
                r.prepare()
                r.start()
                recorder = r
                recordingPath = file.absolutePath
                recordingNumber = number
                recordingStart = start
                recordingSlot = slot
                recCtx = ctx.applicationContext
                return
            } catch (e: Exception) {
                // try next source
            }
        }
    }

    private fun stopRecording() {
        val r = recorder ?: return
        recorder = null
        try { r.stop() } catch (e: Exception) {}
        try { r.release() } catch (e: Exception) {}
        val path = recordingPath
        recordingPath = null
        if (path == null) return
        val f = File(path)
        // Drop empty/failed captures (a 0-byte file means the recorder never got audio).
        if (!f.exists() || f.length() <= 0L) { try { if (f.exists()) f.delete() } catch (e: Exception) {}; return }
        // Reliable path: hand the file to the native uploader (the foreground service uploads
        // it even if the app is killed right after the call - the Flutter listener may be dead).
        recCtx?.let {
            try { CallSync.enqueueOwnRecording(it, path, recordingNumber, recordingStart, recordingSlot) } catch (e: Exception) {}
        }
        // Fast path: if the app is alive, upload immediately via Flutter (idempotent server-side).
        eventSink?.success(
            hashMapOf(
                "event" to "recording",
                "path" to path,
                "number" to recordingNumber,
                "startedAt" to recordingStart
            )
        )
    }

    // ── Controls ─────────────────────────────────────────────────────────────
    fun answer() {
        currentCall?.answer(0) // VideoProfile.STATE_AUDIO_ONLY
    }

    fun reject() {
        currentCall?.let {
            if (it.state == Call.STATE_RINGING) it.reject(false, null) else it.disconnect()
        }
    }

    fun hangup() { currentCall?.disconnect() }

    fun hold(hold: Boolean) {
        currentCall?.let { if (hold) it.hold() else it.unhold() }
    }

    fun setMuted(mute: Boolean) {
        inCallService?.setMuted(mute)
        emitState()
    }

    fun setSpeaker(on: Boolean) {
        inCallService?.setAudioRoute(
            if (on) CallAudioState.ROUTE_SPEAKER else CallAudioState.ROUTE_EARPIECE
        )
        emitState()
    }

    fun dtmf(digit: String) {
        if (digit.isNotEmpty()) {
            currentCall?.playDtmfTone(digit[0])
            currentCall?.stopDtmfTone()
        }
    }

    @Suppress("unused")
    fun apiLevel(): Int = Build.VERSION.SDK_INT
}
