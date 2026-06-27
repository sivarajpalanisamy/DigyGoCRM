package co.digygo.digygo_dialer

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Environment
import android.provider.CallLog
import java.io.File
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Shared call-sync routine. Reads the most-recent call, posts it to the CRM, then
 * finds + uploads the matching OEM recording - all in the background, even if the
 * app is never opened.
 *
 * Used by BOTH:
 *  - [CallSyncService] (the reliable path: a foreground service keeps the process
 *    alive long enough to finish the upload), and
 *  - [CallEndReceiver] (a best-effort manifest receiver that also fires when the
 *    service happens to be down).
 *
 * Idempotent on purpose: a persisted watermark skips already-synced calls, and the
 * backend dedupes by clientCallId - so a double-fire from both callers is harmless.
 *
 * KEY FIX (incoming calls not syncing until app reopened): instead of a single fixed
 * sleep, we POLL for the call-log row to appear. Some OEMs write the row a few
 * seconds after the call ends, so a one-shot read used to come back empty (or with
 * the previous, already-synced call) and nothing got posted until the in-app
 * harvester ran on next open. Polling + posting metadata first makes it reliable.
 */
object CallSync {
    const val PREFS = "digygo_sync"
    private const val WATERMARK_KEY = "last_synced_call_date"
    private const val REC_WATERMARK_KEY = "last_uploaded_rec_ms"
    private const val RECENT_WINDOW_MS = 5 * 60 * 1000L     // only sync calls that just ended
    private const val REC_MATCH_WINDOW_MS = 6 * 60 * 1000L  // recording file ↔ call time tolerance

    // Known OEM call-recording folders (fast-path seeds). Auto-discovery finds the rest.
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
    private val recDirHints = listOf("call", "record", "voice", "sound", "recording")
    private fun looksLikeRecDir(name: String) = recDirHints.any { name.lowercase().contains(it) }
    private fun looksLikeCallRecording(path: String): Boolean {
        val p = path.lowercase()
        return p.contains("call") || p.contains("phonerecord") || p.contains("/record/")
    }

    // Receiver and service run in the same process; serialise so they don't both
    // post the same call (watermark is read-modify-write).
    private val lock = Any()

    private data class CallRow(val number: String, val type: Int, val duration: Int, val date: Long)

    /**
     * @param maxTries number of 1-second polls waiting for the call-log row. Keep ≤8
     *   when called from a BroadcastReceiver (so the whole job fits the ~10s receiver
     *   limit); the foreground service can afford to poll longer.
     */
    fun run(ctx: Context, maxTries: Int = 12) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val base = prefs.getString("base", null) ?: return
        val token = prefs.getString("token", null) ?: return // not linked → do nothing

        synchronized(lock) {
            val watermark = prefs.getLong(WATERMARK_KEY, 0L)

            // Poll until at least one fresh call-log row appears (some OEMs write the
            // row a few seconds after the call ends).
            var appeared = false
            for (attempt in 0 until maxTries) {
                val latest = readLatestCall(ctx)
                if (latest != null && latest.date > watermark) { appeared = true; break }
                try { Thread.sleep(1000) } catch (e: InterruptedException) { return }
            }
            if (!appeared) return

            // Gather EVERY new call since the watermark that just ended - incoming or
            // outgoing, answered or not. Reading all (not just the latest) means a
            // burst of calls can't slip through the real-time path.
            val calls = readCallsSince(ctx, watermark)
            if (calls.isEmpty()) return

            // 1) Post the metadata batch FIRST - small + fast, the part the user needs.
            //    Advance the watermark only on success so a network failure retries later.
            try {
                postCalls(base, token, calls)
                prefs.edit().putLong(WATERMARK_KEY, calls.maxOf { it.date }).apply()
            } catch (e: Exception) {
                return // CRM unreachable → next call / app open retries
            }

            // 2) Find + upload each call's recording (best-effort; the recorder may
            //    still be finalising the file, so this retries internally).
            for (call in calls) {
                try { uploadRecordingFor(ctx, prefs, base, token, call) } catch (e: Exception) { /* best-effort */ }
            }
        }
    }

    // All call-log rows strictly newer than afterMs that ended within the recency
    // window, oldest-first (so the watermark advances monotonically). Capped to avoid
    // posting a huge backlog from the real-time path - the in-app fallback batch
    // handles any older backfill.
    private fun readCallsSince(ctx: Context, afterMs: Long): List<CallRow> {
        val out = ArrayList<CallRow>()
        try {
            val cursor = ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DURATION, CallLog.Calls.DATE),
                "${CallLog.Calls.DATE} > ?", arrayOf(afterMs.toString()),
                "${CallLog.Calls.DATE} ASC"
            ) ?: return out
            cursor.use {
                val now = System.currentTimeMillis()
                while (it.moveToNext() && out.size < 50) {
                    val row = CallRow(
                        number = it.getString(0) ?: "",
                        type = it.getInt(1),
                        duration = it.getInt(2),
                        date = it.getLong(3)
                    )
                    val endedAtMs = row.date + row.duration * 1000L
                    if (now - endedAtMs <= RECENT_WINDOW_MS) out.add(row)
                }
            }
        } catch (e: Exception) {
            // fall through with whatever we collected
        }
        return out
    }

    private fun readLatestCall(ctx: Context): CallRow? {
        return try {
            val cursor = ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DURATION, CallLog.Calls.DATE),
                null, null,
                "${CallLog.Calls.DATE} DESC"
            ) ?: return null
            cursor.use {
                if (!it.moveToFirst()) return null
                CallRow(
                    number = it.getString(0) ?: "",
                    type = it.getInt(1),
                    duration = it.getInt(2),
                    date = it.getLong(3)
                )
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun outcomeOf(c: CallRow): String = when {
        c.type == CallLog.Calls.MISSED_TYPE -> "MISSED"
        c.type == CallLog.Calls.REJECTED_TYPE -> "REJECTED"
        c.duration > 0 -> "ANSWERED"
        c.type == CallLog.Calls.OUTGOING_TYPE -> "NO_ANSWER"
        else -> "MISSED"
    }

    // Build one JSON object for a call. Direction + outcome cover every case:
    // incoming answered (INBOUND/ANSWERED), incoming missed (INBOUND/MISSED),
    // incoming rejected (INBOUND/REJECTED), outgoing answered/unanswered.
    private fun callJson(c: CallRow): String {
        val direction = if (c.type == CallLog.Calls.OUTGOING_TYPE) "OUTBOUND" else "INBOUND"
        val num = jsonEscape(c.number)
        return """{"clientCallId":"${num}_${c.date}","phone":"$num","direction":"$direction",""" +
                """"outcome":"${outcomeOf(c)}","durationSeconds":${c.duration},"startedAt":"${isoUtc(c.date)}"}"""
    }

    /** Most-recent call (phone/direction/outcome/duration) for the post-call screen. */
    fun lastCallInfo(ctx: Context): Map<String, Any?>? {
        val c = readLatestCall(ctx) ?: return null
        if (c.number.isBlank()) return null
        return mapOf(
            "phone" to c.number,
            "direction" to (if (c.type == CallLog.Calls.OUTGOING_TYPE) "OUTBOUND" else "INBOUND"),
            "outcome" to outcomeOf(c),
            "duration" to c.duration,
            "date" to c.date
        )
    }

    private fun postCalls(base: String, token: String, calls: List<CallRow>) {
        if (calls.isEmpty()) return
        val body = calls.joinToString(prefix = "[", postfix = "]", separator = ",") { callJson(it) }

        val conn = (URL(base.trimEnd('/') + "/api/mobile/calls").openConnection() as HttpURLConnection)
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $token")
            val os: OutputStream = conn.outputStream
            os.write(body.toByteArray(Charsets.UTF_8))
            os.flush(); os.close()
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    }

    private fun uploadRecordingFor(ctx: Context, prefs: SharedPreferences,
                                   base: String, token: String, c: CallRow) {
        if (!hasAllFilesAccess()) return
        val recWatermark = prefs.getLong(REC_WATERMARK_KEY, 0L)
        val callEnd = c.date + c.duration * 1000L

        var file: File? = null
        for (attempt in 0 until 4) {
            file = findRecording(callEnd, c.date, recWatermark)
            if (file != null) break
            try { Thread.sleep(1500) } catch (e: InterruptedException) { return }
        }
        val f = file ?: return

        uploadRecording(base, token, f, c.number, c.date)
        prefs.edit().putLong(REC_WATERMARK_KEY, f.lastModified()).apply()
    }

    // Find the OEM recording for a call: newest audio file written around call-end,
    // searching known folders + auto-discovered call-recording folders (any OEM).
    private fun findRecording(callEndMs: Long, callStartMs: Long, afterMs: Long): File? {
        val root = Environment.getExternalStorageDirectory()
        var best: File? = null
        var bestDelta = REC_MATCH_WINDOW_MS
        val consider = { f: File ->
            val m = f.lastModified()
            if (m > afterMs && m >= callStartMs - 60_000) {
                val delta = Math.abs(m - callEndMs)
                if (delta <= bestDelta) { bestDelta = delta; best = f }
            }
        }
        // 1) Known folders - trusted, any audio.
        for (rel in recordingDirs) {
            val dir = File(root, rel)
            if (dir.isDirectory) collect(dir, 0, true, consider)
        }
        // 2) Auto-discover call recordings anywhere under storage + Android/media.
        autoDiscover(root, 0, consider)
        File(root, "Android/media").listFiles()?.forEach { pkg ->
            if (pkg.isDirectory) autoDiscover(pkg, 0, consider)
        }
        return best
    }

    private fun collect(dir: File, depth: Int, trusted: Boolean, onFile: (File) -> Unit) {
        if (depth > 3) return
        val files = dir.listFiles() ?: return
        for (f in files) {
            if (f.isDirectory) { collect(f, depth + 1, trusted, onFile); continue }
            val lower = f.name.lowercase()
            if (audioExt.none { lower.endsWith(it) }) continue
            if (!trusted && !looksLikeCallRecording(f.absolutePath)) continue
            onFile(f)
        }
    }

    private fun autoDiscover(dir: File, depth: Int, onFile: (File) -> Unit) {
        if (depth > 5) return
        val files = dir.listFiles() ?: return
        for (f in files) {
            if (f.isDirectory) {
                if (depth == 0 && f.name.equals("Android", true)) continue
                if (depth == 0 || looksLikeRecDir(f.name)) autoDiscover(f, depth + 1, onFile)
            } else {
                val lower = f.name.lowercase()
                if (audioExt.none { lower.endsWith(it) }) continue
                if (!looksLikeCallRecording(f.absolutePath)) continue
                onFile(f)
            }
        }
    }

    private fun uploadRecording(base: String, token: String, file: File, phone: String, startedAtMs: Long) {
        val boundary = "----digygo" + System.nanoTime()
        val nl = "\r\n"
        val conn = (URL(base.trimEnd('/') + "/api/mobile/calls/by-key/recording").openConnection() as HttpURLConnection)
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 20000
            conn.readTimeout = 60000
            conn.doOutput = true
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            val os = conn.outputStream
            fun field(name: String, value: String) {
                os.write(("--$boundary$nl").toByteArray())
                os.write(("Content-Disposition: form-data; name=\"$name\"$nl$nl").toByteArray())
                os.write((value + nl).toByteArray())
            }
            field("phone", phone)
            field("startedAt", startedAtMs.toString())
            os.write(("--$boundary$nl").toByteArray())
            os.write(("Content-Disposition: form-data; name=\"recording\"; filename=\"${file.name}\"$nl").toByteArray())
            os.write(("Content-Type: ${mimeFor(file.name)}$nl$nl").toByteArray())
            file.inputStream().use { it.copyTo(os) }
            os.write(nl.toByteArray())
            os.write(("--$boundary--$nl").toByteArray())
            os.flush(); os.close()
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    }

    private fun mimeFor(name: String): String {
        val n = name.lowercase()
        return when {
            n.endsWith(".m4a") || n.endsWith(".mp4") || n.endsWith(".aac") -> "audio/mp4"
            n.endsWith(".wav") -> "audio/wav"
            n.endsWith(".ogg") -> "audio/ogg"
            n.endsWith(".amr") -> "audio/amr"
            n.endsWith(".3gp") -> "audio/3gpp"
            else -> "audio/mpeg"
        }
    }

    private fun hasAllFilesAccess(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager() else true

    private fun isoUtc(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(ms))

    private fun jsonEscape(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"")
}
