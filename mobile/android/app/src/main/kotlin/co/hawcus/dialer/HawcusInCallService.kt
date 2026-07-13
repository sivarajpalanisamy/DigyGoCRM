package co.hawcus.dialer

import android.content.Intent
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.InCallService

/**
 * Android binds this when DigyGo is the default dialer and routes every call
 * (incoming + outgoing) here. We forward the call to CallManager and bring our
 * own in-call UI (MainActivity → Flutter InCallScreen) to the foreground.
 */
class HawcusInCallService : InCallService() {

    override fun onCallAdded(call: Call) {
        super.onCallAdded(call)
        CallManager.attachService(this)
        CallManager.onCallAdded(call)
        // Show our in-app call screen.
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        startActivity(intent)
    }

    override fun onCallRemoved(call: Call) {
        super.onCallRemoved(call)
        CallManager.onCallRemoved(call)
    }

    override fun onCallAudioStateChanged(audioState: CallAudioState) {
        super.onCallAudioStateChanged(audioState)
        CallManager.attachService(this)
    }
}
