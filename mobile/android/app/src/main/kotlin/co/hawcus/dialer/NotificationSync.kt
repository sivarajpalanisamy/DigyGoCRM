package co.hawcus.dialer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Polls the CRM for THIS device's staff notifications (a new lead assigned to them,
 * follow-up due reminders) and posts them as Android notifications. Driven by the
 * persistent foreground service [CallSyncService], so alerts arrive without FCM.
 *
 * Dedup: a "watermark" (last-seen created_at) is stored in prefs and sent as `after`
 * so the server only returns newer rows. On the very first run we prime the watermark
 * to "now" and post nothing, so existing/old notifications don't flood the user.
 */
object NotificationSync {
    private const val CH = "digygo_crm_alerts"
    private const val WATERMARK = "notif_watermark"
    private const val POSTED_IDS = "notif_posted_ids"   // dedup guard (last ~300 ids)
    private const val MAX_POSTED = 300
    private val lock = Any()

    fun poll(ctx: Context) {
        val prefs = ctx.getSharedPreferences(CallSync.PREFS, Context.MODE_PRIVATE)
        val base = prefs.getString("base", null) ?: return
        val token = prefs.getString("token", null) ?: return

        synchronized(lock) {
            val after = prefs.getString(WATERMARK, "") ?: ""
            // First run: prime the watermark to now and don't post anything.
            if (after.isEmpty()) {
                prefs.edit().putString(WATERMARK, isoUtcNow()).apply()
                return
            }
            val body = httpGet(base, token, after) ?: return
            try {
                val obj = JSONObject(body)
                val arr = obj.optJSONArray("notifications") ?: return
                // Posted-id guard: never re-show a notification we've already posted,
                // even if the watermark hiccups (belt-and-braces with `nextAfter`).
                val posted = LinkedHashSet<String>(
                    (prefs.getString(POSTED_IDS, "") ?: "").split(",").filter { it.isNotEmpty() }
                )
                for (i in 0 until arr.length()) {
                    val n = arr.getJSONObject(i)
                    val id = n.optString("id")
                    if (id.isNotEmpty() && posted.contains(id)) continue
                    postNotif(ctx, id, n.optString("type"), n.optString("title"), n.optString("message"))
                    if (id.isNotEmpty()) posted.add(id)
                }
                // Advance the watermark to the server's full-precision cursor so the
                // newest row isn't matched again next poll (fixes duplicate alerts).
                val nextAfter = obj.optString("nextAfter", after)
                val trimmed = if (posted.size > MAX_POSTED) posted.toList().takeLast(MAX_POSTED) else posted.toList()
                prefs.edit()
                    .putString(WATERMARK, if (nextAfter.isNotEmpty()) nextAfter else after)
                    .putString(POSTED_IDS, trimmed.joinToString(","))
                    .apply()
            } catch (e: Exception) { /* malformed response - skip this cycle */ }
        }
    }

    private fun httpGet(base: String, token: String, after: String): String? {
        val url = base.trimEnd('/') + "/api/mobile/notifications?after=" + URLEncoder.encode(after, "UTF-8")
        val conn = (URL(url).openConnection() as HttpURLConnection)
        return try {
            conn.requestMethod = "GET"
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.setRequestProperty("Authorization", "Bearer $token")
            if (conn.responseCode == 200) conn.inputStream.bufferedReader().readText() else null
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }

    private fun postNotif(ctx: Context, id: String, type: String, title: String, message: String) {
        if (title.isBlank()) return
        val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CH, "Leads & follow-ups", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "New leads assigned to you and follow-up reminders"
            }
            mgr.createNotificationChannel(ch)
        }
        val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("dg_open", "notifications")
        }
        val pi = if (open != null)
            PendingIntent.getActivity(ctx, id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        else null
        val icon = if (type == "follow_up_due") android.R.drawable.ic_popup_reminder else android.R.drawable.ic_dialog_email
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(ctx, CH)
        else
            @Suppress("DEPRECATION") Notification.Builder(ctx)
        val n = builder
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(Notification.BigTextStyle().bigText(message))
            .setSmallIcon(icon)
            .setAutoCancel(true)
            .also { if (pi != null) it.setContentIntent(pi) }
            .build()
        try { mgr.notify(id.hashCode(), n) } catch (e: Exception) {}
    }

    private fun isoUtcNow(): String {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        f.timeZone = TimeZone.getTimeZone("UTC")
        return f.format(Date())
    }
}
