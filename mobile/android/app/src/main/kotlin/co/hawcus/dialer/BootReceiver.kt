package co.hawcus.dialer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts the background call-sync foreground service after a reboot (or app
 * update), but only if the device is still linked to the CRM. BOOT_COMPLETED is one
 * of the broadcasts allowed to start a foreground service from the background.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        val prefs = context.getSharedPreferences(CallSync.PREFS, Context.MODE_PRIVATE)
        if (prefs.getString("token", null) != null) {
            CallSyncService.start(context.applicationContext)
        }
    }
}
