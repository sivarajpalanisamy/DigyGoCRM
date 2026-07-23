package co.hawcus.dialer

import android.Manifest
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.database.Cursor
import android.os.Build
import android.os.Environment
import android.provider.CallLog
import android.telecom.PhoneAccountHandle
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.app.ActivityCompat
import org.json.JSONArray
import org.json.JSONObject
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
    // Max active-SIM count ever seen - persisted so a later permission revocation can't
    // silently downgrade a dual-SIM phone to "single SIM" and let the skipped SIM leak.
    private const val SIM_TOTAL_KEY = "sim_total_seen"
    private const val RECENT_WINDOW_MS = 5 * 60 * 1000L     // only sync calls that just ended
    private const val REC_MATCH_WINDOW_MS = 6 * 60 * 1000L  // recording file ↔ call time tolerance
    // Real-time SIM capture: the InCallService records each call's SIM slot AT CALL TIME
    // (from its PhoneAccountHandle - authoritative, OEM-independent), keyed by number+time.
    // The sync gate consults this first, so attribution works even on MIUI/Redmi where the
    // call-log's PHONE_ACCOUNT_ID maps to no SIM. This is what lets us gate STRICTLY.
    private const val RT_SLOTS_KEY = "rt_call_slots"
    private const val RT_MATCH_WINDOW_MS = 5 * 60 * 1000L   // captured-slot ↔ call-log time tolerance
    private const val RT_TTL_MS = 12L * 60 * 60 * 1000L     // forget captured slots after 12h
    private const val RT_MAX = 40                           // ring-buffer size
    // Own-recorder upload queue: the InCallService records the call to a file (mic-based, the
    // reliable source on OEMs whose built-in recorder saves nothing), enqueues it here, and the
    // foreground service uploads it - so a recording survives the app being killed after a call.
    private const val OWN_REC_KEY = "pending_own_recordings"
    private const val OWN_REC_TTL_MS = 3L * 24 * 60 * 60 * 1000L  // give up on a file after 3 days
    private const val OWN_REC_MAX = 30

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

    private data class CallRow(
        val number: String, val type: Int, val duration: Int, val date: Long,
        val phoneAccountId: String? = null,
        // Extra SIM signals some OEMs (notably MIUI/Xiaomi) put on the call-log row even
        // when PHONE_ACCOUNT_ID is useless: an integer subscription id and/or a "simid".
        val subId: Int? = null, val simId: Int? = null,
        val simSlot: Int? = null, val simNumber: String? = null,
    )

    // A SIM the user verified in-app (slot + the number they entered for it).
    private data class SimRef(val slot: Int, val number: String?)

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
          try {
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
            val maxDate = calls.maxOf { it.date }

            // SIM gate - only sync calls made/received on a verified SIM. On a dual-SIM
            // phone, calls on the SIM the user skipped must NOT reach the CRM. Each kept
            // call is tagged with its SIM slot + number so the backend can double-check.
            val toSync = filterAndTag(ctx, prefs, calls, readVerifiedSims(prefs))
            val simCount = reportedSimCount(ctx, prefs)

            // Advance the watermark past EVERYTHING scanned (dropped unverified-SIM calls
            // included) so they're never rescanned. If nothing survives the gate, we're done.
            if (toSync.isEmpty()) {
                prefs.edit().putLong(WATERMARK_KEY, maxDate).apply()
                return
            }

            // 1) Post the metadata batch FIRST - small + fast, the part the user needs.
            //    Advance the watermark only on success so a network failure retries later.
            try {
                postCalls(base, token, toSync, simCount)
                prefs.edit().putLong(WATERMARK_KEY, maxDate).apply()
            } catch (e: Exception) {
                return // CRM unreachable → next call / app open retries
            }

            // 2) Find + upload each call's recording (best-effort; the recorder may
            //    still be finalising the file, so this retries internally).
            for (call in toSync) {
                try { uploadRecordingFor(ctx, prefs, base, token, call) } catch (e: Exception) { /* best-effort */ }
            }
          } finally {
            // Always flush queued own-recorder files, even when no new call appeared this run
            // (a recording can finalise after its call-log row was already synced).
            try { uploadPendingOwnRecordings(ctx, prefs, base, token) } catch (e: Exception) { /* best-effort */ }
          }
        }
    }

    // ── Own-recorder upload queue ────────────────────────────────────────────────────────
    // The InCallService recorder enqueues each finished file here; the foreground service (via
    // run() above) uploads it, gated by the verified SIM. This decouples recording from upload
    // so a recording is not lost when MIUI kills the app right after the call ends.
    fun enqueueOwnRecording(ctx: Context, path: String?, number: String?, startedAtMs: Long, slot: Int?) {
        if (path.isNullOrBlank()) return
        try {
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            val arr = try { JSONArray(prefs.getString(OWN_REC_KEY, "[]")) } catch (e: Exception) { JSONArray() }
            val kept = JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (now - o.optLong("t", 0) <= OWN_REC_TTL_MS) kept.put(o)
            }
            kept.put(JSONObject()
                .put("p", path)
                .put("n", number ?: "")
                .put("st", startedAtMs)
                .put("slot", slot ?: -1)
                .put("t", now))
            val bounded = if (kept.length() > OWN_REC_MAX) {
                val b = JSONArray()
                for (i in (kept.length() - OWN_REC_MAX) until kept.length()) b.put(kept.get(i))
                b
            } else kept
            prefs.edit().putString(OWN_REC_KEY, bounded.toString()).apply()
        } catch (e: Exception) { /* best-effort */ }
    }

    // Upload every queued own-recording whose call is on a verified SIM. One attempt per entry
    // per run (the metadata row may not exist yet → a 404 keeps the entry for the next run).
    private fun uploadPendingOwnRecordings(ctx: Context, prefs: SharedPreferences, base: String, token: String) {
        val raw = prefs.getString(OWN_REC_KEY, null) ?: return
        val arr = try { JSONArray(raw) } catch (e: Exception) { return }
        if (arr.length() == 0) return
        val verifiedSlots = readVerifiedSims(prefs).mapNotNull { if (it.slot >= 0) it.slot else null }.toSet()
        val gated = isMultiSim(ctx, prefs) && verifiedSlots.isNotEmpty()
        val now = System.currentTimeMillis()
        val remaining = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val path = o.optString("p", "")
            val file = if (path.isNotEmpty()) File(path) else null
            // Drop stale or vanished files.
            if (file == null || !file.exists() || now - o.optLong("t", 0) > OWN_REC_TTL_MS) {
                try { file?.delete() } catch (e: Exception) {}
                continue
            }
            // SIM gate: never upload a recording for a call on the unverified SIM.
            val slot = o.optInt("slot", -1)
            if (gated && (slot < 0 || !verifiedSlots.contains(slot))) {
                try { file.delete() } catch (e: Exception) {}
                continue
            }
            val number = o.optString("n", "")
            val startedAt = o.optLong("st", 0)
            val code = try { uploadRecording(base, token, file, number, startedAt) } catch (e: Exception) { -1 }
            when (code) {
                in 200..299 -> { try { file.delete() } catch (e: Exception) {} }   // done
                404 -> remaining.put(o)   // call row not synced yet → retry next run
                else -> remaining.put(o)  // transient/network error → retry next run
            }
        }
        prefs.edit().putString(OWN_REC_KEY, remaining.toString()).apply()
    }

    // All call-log rows strictly newer than afterMs that ended within the recency
    // window, oldest-first (so the watermark advances monotonically). Capped to avoid
    // posting a huge backlog from the real-time path - the in-app fallback batch
    // handles any older backfill.
    private fun readCallsSince(ctx: Context, afterMs: Long): List<CallRow> {
        val out = ArrayList<CallRow>()
        try {
            // null projection = all columns, so we can pick up OEM SIM columns (subscription_id,
            // simid) by name where they exist without a projection that throws where they don't.
            val cursor = ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI, null,
                "${CallLog.Calls.DATE} > ?", arrayOf(afterMs.toString()),
                "${CallLog.Calls.DATE} ASC"
            ) ?: return out
            cursor.use {
                val now = System.currentTimeMillis()
                while (it.moveToNext() && out.size < 50) {
                    val row = rowFrom(it)
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
                CallLog.Calls.CONTENT_URI, null, null, null,
                "${CallLog.Calls.DATE} DESC"
            ) ?: return null
            cursor.use { if (it.moveToFirst()) rowFrom(it) else null }
        } catch (e: Exception) {
            null
        }
    }

    // Read a call-log row by COLUMN NAME (tolerant of columns that don't exist on a device).
    private fun rowFrom(c: Cursor): CallRow {
        fun idx(name: String): Int = try { c.getColumnIndex(name) } catch (e: Exception) { -1 }
        fun str(name: String): String? { val i = idx(name); return if (i >= 0 && !c.isNull(i)) c.getString(i) else null }
        fun lng(name: String): Long { val i = idx(name); return if (i >= 0 && !c.isNull(i)) c.getLong(i) else 0L }
        fun intOpt(name: String): Int? { val i = idx(name); return if (i >= 0 && !c.isNull(i)) c.getInt(i) else null }
        return CallRow(
            number = str(CallLog.Calls.NUMBER) ?: "",
            type = intOpt(CallLog.Calls.TYPE) ?: 0,
            duration = intOpt(CallLog.Calls.DURATION) ?: 0,
            date = lng(CallLog.Calls.DATE),
            phoneAccountId = str(CallLog.Calls.PHONE_ACCOUNT_ID),
            subId = intOpt("subscription_id"),
            simId = intOpt("simid"),
        )
    }

    // True when a call is allowed to surface/sync (STRICT, mirrors [filterAndTag] and the
    // Dart rule): on a dual-SIM device with a verified SIM, a call is allowed ONLY when it
    // resolves to a verified slot. A call we cannot attribute is NOT allowed - stamping it as
    // the verified SIM was leaking the unverified (personal) SIM's calls into the CRM.
    // Attribution is now multi-signal (real-time capture + subscription_id/simid + PHONE_
    // ACCOUNT_ID), so genuine verified-SIM calls still resolve on OEMs that break one signal.
    private fun isOnVerifiedSim(ctx: Context, prefs: SharedPreferences, c: CallRow): Boolean {
        val verifiedSlots = readVerifiedSims(prefs)
            .mapNotNull { if (it.slot >= 0) it.slot else null }.toSet()
        if (isMultiSim(ctx, prefs) && verifiedSlots.isNotEmpty()) {
            val slot = resolveSlot(ctx, prefs, buildAccountSlotMap(ctx), c)
            return slot != null && verifiedSlots.contains(slot)
        }
        return true
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
    // simSlot/simNumber (when known) let the backend confirm the call is on a verified SIM.
    private fun callJson(c: CallRow): String {
        val direction = if (c.type == CallLog.Calls.OUTGOING_TYPE) "OUTBOUND" else "INBOUND"
        val num = jsonEscape(c.number)
        val sb = StringBuilder()
        sb.append("""{"clientCallId":"${num}_${c.date}","phone":"$num","direction":"$direction",""")
        sb.append(""""outcome":"${outcomeOf(c)}","durationSeconds":${c.duration},"startedAt":"${isoUtc(c.date)}"""")
        if (c.simSlot != null) sb.append(""","simSlot":${c.simSlot}""")
        if (!c.simNumber.isNullOrEmpty()) sb.append(""","simNumber":"${jsonEscape(c.simNumber)}"""")
        sb.append("}")
        return sb.toString()
    }

    // ── SIM gating ───────────────────────────────────────────────────────────────
    // STRICT: on a dual-SIM device with a verified SIM, keep a call ONLY when it resolves to
    // a verified slot. A call whose SIM we cannot attribute is DROPPED (not stamped as the
    // verified SIM) - the previous fail-open stamp was leaking the unverified (personal)
    // SIM's calls into the CRM on OEMs that break PHONE_ACCOUNT_ID.
    //
    // To keep this from blanking the CRM on those OEMs, attribution is multi-signal: the
    // InCallService captures each call's slot AT CALL TIME (authoritative), and the call-log
    // row's subscription_id / simid are read on top of PHONE_ACCOUNT_ID. A genuine verified-
    // SIM call resolves via at least one of these on essentially every device.
    private fun filterAndTag(ctx: Context, prefs: SharedPreferences, calls: List<CallRow>, verified: List<SimRef>): List<CallRow> {
        val verifiedSlots = verified.mapNotNull { if (it.slot >= 0) it.slot else null }.toSet()
        val numberBySlot = verified.filter { it.slot >= 0 && !it.number.isNullOrEmpty() }
            .associate { it.slot to it.number!! }
        val multiSim = isMultiSim(ctx, prefs)
        val accountSlot = if (multiSim) buildAccountSlotMap(ctx) else emptyMap()
        val gated = multiSim && verifiedSlots.isNotEmpty()

        val out = ArrayList<CallRow>()
        for (c in calls) {
            if (gated) {
                val slot = resolveSlot(ctx, prefs, accountSlot, c)
                // Keep ONLY calls proven to be on a verified SIM. Unresolved or unverified → drop.
                if (slot == null || !verifiedSlots.contains(slot)) continue
                out.add(c.copy(simSlot = slot, simNumber = numberBySlot[slot]))
            } else {
                out.add(c) // single-SIM, or no verified SIM configured → no gating
            }
        }
        return out
    }

    // Resolve a call's SIM slot from every signal we have, most-authoritative first:
    //  1) real-time capture from the InCallService (by number + time) - OEM-independent;
    //  2) the call-log subscription_id column → SubscriptionManager slot;
    //  3) PHONE_ACCOUNT_ID → subscriptionId/ICCID → slot (works on stock Android);
    //  4) the Xiaomi "simid" column (as a subscriptionId, else a 1-based slot).
    // Returns null when the SIM genuinely can't be determined (→ dropped under strict gating).
    private fun resolveSlot(ctx: Context, prefs: SharedPreferences, accountSlot: Map<String, Int>, c: CallRow): Int? {
        rtSlotFor(prefs, c.number, c.date)?.let { return it }
        c.subId?.let { accountSlot[it.toString()]?.let { s -> return s } }
        c.phoneAccountId?.let { accountSlot[it]?.let { s -> return s } }
        c.simId?.let { sid ->
            accountSlot[sid.toString()]?.let { return it }            // simid stored as subscriptionId
            if (sid in 1..2 && accountSlot.containsValue(sid - 1)) return sid - 1  // simid as 1-based slot
        }
        return null
    }

    // ── Real-time SIM capture (called by CallManager from the InCallService) ─────────────
    // Records the SIM slot resolved from a live call's PhoneAccountHandle, keyed by number +
    // time, so the (later) call-log sync can attribute the row even when the OS wrote no
    // usable SIM id onto it. This is the signal that makes strict gating safe on MIUI/Redmi.
    fun recordCallSlot(ctx: Context, number: String?, slot: Int) {
        if (number.isNullOrBlank() || slot < 0) return
        try {
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            val arr = try { JSONArray(prefs.getString(RT_SLOTS_KEY, "[]")) } catch (e: Exception) { JSONArray() }
            val kept = JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (now - o.optLong("t", 0) <= RT_TTL_MS) kept.put(o)
            }
            kept.put(JSONObject().put("n", normNum(number)).put("s", slot).put("t", now))
            val bounded = if (kept.length() > RT_MAX) {
                val b = JSONArray()
                for (i in (kept.length() - RT_MAX) until kept.length()) b.put(kept.get(i))
                b
            } else kept
            prefs.edit().putString(RT_SLOTS_KEY, bounded.toString()).apply()
        } catch (e: Exception) { /* best-effort */ }
    }

    // Slot captured in real time for a call matching this number within the time window.
    private fun rtSlotFor(prefs: SharedPreferences, number: String, dateMs: Long): Int? {
        val raw = prefs.getString(RT_SLOTS_KEY, null) ?: return null
        val target = normNum(number)
        if (target.isEmpty()) return null
        return try {
            val arr = JSONArray(raw)
            var best: Int? = null
            var bestDelta = RT_MATCH_WINDOW_MS
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (o.optString("n") != target) continue
                val delta = Math.abs(o.optLong("t") - dateMs)
                if (delta <= bestDelta) { bestDelta = delta; best = o.optInt("s") }
            }
            best
        } catch (e: Exception) { null }
    }

    // Resolve a live call's SIM slot from its PhoneAccountHandle (used by CallManager at call
    // time). getSubscriptionId(handle) is authoritative on API 30+; older devices fall back to
    // matching the handle id against the subscriptionId/ICCID map.
    fun slotForAccountHandle(ctx: Context, handle: PhoneAccountHandle?): Int? {
        if (handle == null) return null
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE)
            != PackageManager.PERMISSION_GRANTED) return null
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
                val subId = tm.getSubscriptionId(handle)   // API 30: handle → subscriptionId
                if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
                    val sm = ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
                    sm.activeSubscriptionInfoList?.firstOrNull { it.subscriptionId == subId }?.let { return it.simSlotIndex }
                }
            }
        } catch (e: Exception) { /* fall through */ }
        return try { buildAccountSlotMap(ctx)[handle.id] } catch (e: Exception) { null }
    }

    // Last-10 digits, the SIM-agnostic key used to match a live capture to a call-log row.
    private fun normNum(number: String): String {
        val d = number.filter { it.isDigit() }
        return if (d.length >= 10) d.takeLast(10) else d
    }

    // True if the device has (or has ever had) ≥2 active SIMs. Persists the max count seen
    // so a permission blip can't downgrade a dual-SIM phone to single-SIM mid-life.
    private fun isMultiSim(ctx: Context, prefs: SharedPreferences): Boolean {
        val live = activeSimCount(ctx)
        val seen = prefs.getInt(SIM_TOTAL_KEY, 0)
        if (live > seen) prefs.edit().putInt(SIM_TOTAL_KEY, live).apply()
        return maxOf(live, seen) > 1
    }

    // The live SIM count to report to the backend (≥1). Uses the persisted max so the
    // server's multi-SIM enforcement stays correct even if the permission is later revoked.
    private fun reportedSimCount(ctx: Context, prefs: SharedPreferences): Int =
        maxOf(activeSimCount(ctx), prefs.getInt(SIM_TOTAL_KEY, 0)).coerceAtLeast(1)

    // Public SIM-gate snapshot for the in-app (Dart) call harvester, so BOTH ingest paths
    // apply the exact same gate. Keys mirror the fields used by filterAndTag.
    fun simGateInfo(ctx: Context): Map<String, Any?> {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val verified = readVerifiedSims(prefs)
        val multiSim = isMultiSim(ctx, prefs)
        val accountSlot = if (multiSim) buildAccountSlotMap(ctx) else emptyMap()
        return mapOf(
            "multiSim" to multiSim,
            "simCount" to reportedSimCount(ctx, prefs),
            "accountSlot" to accountSlot,                                   // {accountId(String) -> slot(Int)}
            "verifiedSlots" to verified.mapNotNull { if (it.slot >= 0) it.slot else null }, // [Int]
            "numberBySlot" to verified.filter { it.slot >= 0 && !it.number.isNullOrEmpty() }
                .associate { it.slot.toString() to it.number!! },           // {slot(String) -> number(String)}
            // Native's full multi-signal resolution of recent calls, so the in-app (Dart)
            // display gate resolves EXACTLY like the sync gate - Dart's call_log package can't
            // see subscription_id/simid or the real-time capture store on its own.
            "resolvedSlots" to if (multiSim) recentResolvedSlots(ctx, prefs, accountSlot) else emptyMap()
        )
    }

    // {"<number>_<dateMs>" -> slot} for the most recent calls that we could attribute. Keys
    // mirror what the Dart side builds from its own call_log entries. Absent key → Dart falls
    // back to PHONE_ACCOUNT_ID, then (strict) hides the call.
    private fun recentResolvedSlots(ctx: Context, prefs: SharedPreferences, accountSlot: Map<String, Int>): Map<String, Int> {
        val out = HashMap<String, Int>()
        try {
            val cursor = ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI, null, null, null, "${CallLog.Calls.DATE} DESC"
            ) ?: return out
            cursor.use {
                var n = 0
                while (it.moveToNext() && n < 400) {
                    n++
                    val c = rowFrom(it)
                    val slot = resolveSlot(ctx, prefs, accountSlot, c)
                    if (slot != null) out["${c.number}_${c.date}"] = slot
                }
            }
        } catch (e: Exception) { /* best-effort */ }
        return out
    }

    private fun readVerifiedSims(prefs: SharedPreferences): List<SimRef> {
        val raw = prefs.getString("verified_sims", null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                val n = o.optString("number", "")
                SimRef(o.optInt("slot", -1), if (n.isEmpty()) null else n)
            }
        } catch (e: Exception) { emptyList() }
    }

    // Map a call-log PHONE_ACCOUNT_ID → SIM slot. Different OEMs put the subscription id
    // OR the ICCID in PHONE_ACCOUNT_ID, so we index both.
    private fun buildAccountSlotMap(ctx: Context): Map<String, Int> {
        val map = HashMap<String, Int>()
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE)
            != PackageManager.PERMISSION_GRANTED) return map
        try {
            val sm = ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
            val subs = sm.activeSubscriptionInfoList ?: return map
            for (info in subs) {
                map[info.subscriptionId.toString()] = info.simSlotIndex
                val icc = info.iccId
                if (!icc.isNullOrEmpty()) map[icc] = info.simSlotIndex
            }
        } catch (e: Exception) { /* fall through with what we have */ }
        return map
    }

    private fun activeSimCount(ctx: Context): Int {
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE)
            != PackageManager.PERMISSION_GRANTED) return 1
        return try {
            val sm = ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
            sm.activeSubscriptionInfoList?.size ?: 1
        } catch (e: Exception) { 1 }
    }

    /** Most-recent call (phone/direction/outcome/duration) for the post-call screen. */
    fun lastCallInfo(ctx: Context): Map<String, Any?>? {
        val c = readLatestCall(ctx) ?: return null
        if (c.number.isBlank()) return null
        // SIM gate: never surface a call on an unverified/skipped SIM (dual-SIM
        // phones), so the post-call notification can't pre-fill a number from the
        // wrong SIM into the create-lead screen. Matches the background sync gate.
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!isOnVerifiedSim(ctx, prefs, c)) return null
        return mapOf(
            "phone" to c.number,
            "direction" to (if (c.type == CallLog.Calls.OUTGOING_TYPE) "OUTBOUND" else "INBOUND"),
            "outcome" to outcomeOf(c),
            "duration" to c.duration,
            "date" to c.date
        )
    }

    private fun postCalls(base: String, token: String, calls: List<CallRow>, simCount: Int) {
        if (calls.isEmpty()) return
        val arr = calls.joinToString(prefix = "[", postfix = "]", separator = ",") { callJson(it) }
        // Envelope carries the live SIM count so the backend knows this is a SIM-aware
        // client and whether the device is multi-SIM (drives its fail-closed enforcement).
        val body = """{"calls":$arr,"simCount":$simCount}"""

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

    private fun uploadRecording(base: String, token: String, file: File, phone: String, startedAtMs: Long): Int {
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
            return conn.responseCode
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
