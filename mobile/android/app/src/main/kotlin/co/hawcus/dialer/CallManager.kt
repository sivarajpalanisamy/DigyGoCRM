package co.hawcus.dialer

import android.media.MediaRecorder
import android.os.Build
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.InCallService
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

    private val callback = object : Call.Callback() {
        override fun onStateChanged(call: Call, state: Int) {
            if (state == Call.STATE_ACTIVE) startRecording()
            if (state == Call.STATE_DISCONNECTED) stopRecording()
            emitState()
        }
        override fun onDetailsChanged(call: Call, details: Call.Details) = emitState()
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
        emitState()
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
    private fun startRecording() {
        if (recorder != null) return
        val ctx = inCallService ?: return
        val number = currentCall?.details?.handle?.schemeSpecificPart ?: "unknown"
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
        if (path != null) {
            eventSink?.success(
                hashMapOf(
                    "event" to "recording",
                    "path" to path,
                    "number" to recordingNumber,
                    "startedAt" to recordingStart
                )
            )
        }
        recordingPath = null
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
