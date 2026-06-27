package co.digygo.digygo_dialer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager

/**
 * Persistent foreground service that keeps DigyGo listening for calls in the
 * background - the reliable counterpart to the manifest [CallEndReceiver].
 *
 * Why a foreground service (the fix for "incoming call only synced after I reopened
 * the app"): a plain manifest receiver runs in a process the OS can kill the instant
 * onReceive returns, so the network upload often never finished; and OEM battery
 * managers frequently don't deliver background broadcasts to a deep-sleeping app.
 * A foreground service keeps the process alive, so its phone-state listener fires
 * reliably and [CallSync] has time to post the call within seconds of it ending.
 *
 * Started from [MainActivity.setSyncConfig] when the device is linked (the app is in
 * the foreground then, so the start is allowed on Android 12+) and from
 * [BootReceiver] after a reboot. Stopped on sign-out.
 */
class CallSyncService : Service() {

    private var tm: TelephonyManager? = null
    private var callback: Any? = null            // TelephonyCallback (S+)
    private var legacyListener: PhoneStateListener? = null
    @Volatile private var sawNonIdle = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        goForeground()
        registerCallStateListener()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Linked check: if the device was signed out, don't keep running.
        val prefs = getSharedPreferences(CallSync.PREFS, Context.MODE_PRIVATE)
        if (prefs.getString("token", null) == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY // OS restarts us if killed
    }

    // Called on every call-state change. Sync once when a call ENDS (IDLE after a
    // RINGING/OFFHOOK), covering incoming + outgoing, answered + missed.
    private fun onCallState(state: Int) {
        if (state != TelephonyManager.CALL_STATE_IDLE) {
            sawNonIdle = true
        } else if (sawNonIdle) {
            sawNonIdle = false
            Thread {
                CallSync.run(applicationContext, maxTries = 12)
                // After syncing, surface the post-call screen for the call that just ended.
                val info = CallSync.lastCallInfo(applicationContext)
                if (info != null) postCallDetailsNotification(info)
            }.start()
        }
    }

    // High-priority notification that opens the Call Details screen for the just-ended
    // call (full-screen intent so it can pop even from the background, where allowed;
    // otherwise it's a heads-up the agent taps).
    private fun postCallDetailsNotification(info: Map<String, Any?>) {
        val phone = (info["phone"] ?: "").toString()
        if (phone.isBlank()) return
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CALL_CH, "Call details", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Prompts to view or add the lead after a call"
            }
            mgr.createNotificationChannel(ch)
        }
        val open = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("dg_call_phone", phone)
            putExtra("dg_call_direction", (info["direction"] ?: "").toString())
            putExtra("dg_call_outcome", (info["outcome"] ?: "").toString())
            putExtra("dg_call_duration", (info["duration"] as? Int) ?: 0)
            putExtra("dg_call_ts", (info["date"] as? Long) ?: 0L)
        }
        val reqCode = ((info["date"] as? Long) ?: System.currentTimeMillis()).toInt()
        val pi = PendingIntent.getActivity(
            this, reqCode, open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CALL_CH)
        else
            @Suppress("DEPRECATION") Notification.Builder(this)
        val n = builder
            .setContentTitle("Log call: $phone")
            .setContentText("Tap to view or add this lead in the CRM")
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_CALL)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .build()
        try { mgr.notify(CALL_NOTIF_ID, n) } catch (e: Exception) {}
    }

    private fun registerCallStateListener() {
        tm = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                override fun onCallStateChanged(state: Int) = onCallState(state)
            }
            callback = cb
            try { tm?.registerTelephonyCallback(mainExecutor, cb) } catch (e: Exception) {}
        } else {
            val l = object : PhoneStateListener() {
                @Deprecated("Deprecated in Java")
                override fun onCallStateChanged(state: Int, phoneNumber: String?) = onCallState(state)
            }
            legacyListener = l
            @Suppress("DEPRECATION")
            try { tm?.listen(l, PhoneStateListener.LISTEN_CALL_STATE) } catch (e: Exception) {}
        }
    }

    override fun onDestroy() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (callback as? TelephonyCallback)?.let { tm?.unregisterTelephonyCallback(it) }
            } else {
                @Suppress("DEPRECATION")
                legacyListener?.let { tm?.listen(it, PhoneStateListener.LISTEN_NONE) }
            }
        } catch (e: Exception) {}
        super.onDestroy()
    }

    private fun goForeground() {
        val notif = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    private fun buildNotification(): Notification {
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL, "Call sync", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Keeps your calls syncing to the CRM in the background"
                setShowBadge(false)
            }
            mgr.createNotificationChannel(ch)
        }
        val open = packageManager.getLaunchIntentForPackage(packageName)
        val pi = if (open != null)
            PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        else null

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL)
        else
            @Suppress("DEPRECATION") Notification.Builder(this)

        return builder
            .setContentTitle("DigyGo Dialer")
            .setContentText("Syncing your calls to the CRM")
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setOngoing(true)
            .also { if (pi != null) it.setContentIntent(pi) }
            .build()
    }

    companion object {
        private const val CHANNEL = "digygo_call_sync"
        private const val NOTIF_ID = 4711
        private const val CALL_CH = "digygo_call_details"
        private const val CALL_NOTIF_ID = 4712

        fun start(ctx: Context) {
            val i = Intent(ctx, CallSyncService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
                else ctx.startService(i)
            } catch (e: Exception) {
                // Background-start restrictions (e.g. invoked while not visible) - the
                // manifest CallEndReceiver remains as the fallback path.
            }
        }

        fun stop(ctx: Context) {
            try { ctx.stopService(Intent(ctx, CallSyncService::class.java)) } catch (e: Exception) {}
        }
    }
}
