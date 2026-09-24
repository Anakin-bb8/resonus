package expo.modules.homewidget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.SystemClock
import android.view.KeyEvent

/**
 * The widget's buttons, sent as media keys: the same path a headset or a car
 * takes, which ends in the player's own next and previous (the queue lives in
 * JS, not in the native player).
 */
class WidgetActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!NowPlaying.live) {
      // The process was started for this press: nothing is loaded to control.
      NowPlaying.refresh(context)
      return
    }
    val code = when (intent.action) {
      PREVIOUS -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
      NEXT -> KeyEvent.KEYCODE_MEDIA_NEXT
      PLAY_PAUSE -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
      else -> return
    }
    sendMediaKey(context, code)
  }

  companion object {
    const val PREVIOUS = "expo.modules.homewidget.PREVIOUS"
    const val NEXT = "expo.modules.homewidget.NEXT"
    const val PLAY_PAUSE = "expo.modules.homewidget.PLAY_PAUSE"

    fun sendMediaKey(context: Context, code: Int) {
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val now = SystemClock.uptimeMillis()
      audio.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0))
      audio.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0))
    }
  }
}
