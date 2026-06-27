package co.digygo.digygo_dialer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager

/**
 * Best-effort backup trigger: when ANY call ends, run the shared [CallSync] routine.
 * The reliable path is [CallSyncService] (a foreground service that stays alive long
 * enough to finish the upload); this manifest receiver simply covers the case where
 * the service happens to be down. Double-firing is harmless - [CallSync] dedupes via
 * its watermark and the backend dedupes by clientCallId.
 *
 * Stateless on purpose: a manifest receiver's process can be torn down between the
 * OFFHOOK and IDLE broadcasts, so we act only on IDLE and let CallSync read the
 * latest call. goAsync() buys ~10s; CallSync polls for the call-log row within that.
 */
class CallEndReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        if (state != TelephonyManager.EXTRA_STATE_IDLE) return

        val ctx = context.applicationContext
        val pending = goAsync()
        Thread {
            try {
                CallSync.run(ctx, maxTries = 8) // keep within the ~10s receiver window
            } finally {
                pending.finish()
            }
        }.start()
    }
}
