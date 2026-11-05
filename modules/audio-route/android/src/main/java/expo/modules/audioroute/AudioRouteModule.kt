package expo.modules.audioroute

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Where the phone's own sound is going: the kind of output and the name the
 * system gives it ("Pixel Buds", "USB-C headphones").
 *
 * Nothing here needs a permission. The product name of a Bluetooth device
 * comes with the AudioDeviceInfo; its address and class would want
 * BLUETOOTH_CONNECT, which a music player has no business asking for, so a
 * Bluetooth device is just Bluetooth. Everything is wrapped: audio hardware
 * that misbehaves reports the phone itself rather than taking the bridge down.
 */
class AudioRouteModule : Module() {
  private val audioManager: AudioManager? by lazy {
    appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
  }

  private val handler = Handler(Looper.getMainLooper())

  // A headset is listed a moment before the music is routed to it, so the
  // route is told again once the switch has had time to happen.
  private val resend = Runnable { sendEvent("routeChanged", currentRoute()) }

  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = changed()

    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = changed()
  }

  private fun changed() {
    sendEvent("routeChanged", currentRoute())
    handler.removeCallbacks(resend)
    handler.postDelayed(resend, 800)
  }

  private fun kindOf(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER,
    AudioDeviceInfo.TYPE_BLE_BROADCAST,
    AudioDeviceInfo.TYPE_HEARING_AID -> "bluetooth"
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_ACCESSORY,
    AudioDeviceInfo.TYPE_LINE_ANALOG,
    AudioDeviceInfo.TYPE_LINE_DIGITAL,
    AudioDeviceInfo.TYPE_AUX_LINE -> "wired"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE,
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
    AudioDeviceInfo.TYPE_TELEPHONY -> "builtin"
    else -> "other"
  }

  /** Lower wins, for when the system won't say which output music takes. */
  private fun rankOf(type: Int): Int = when (kindOf(type)) {
    "bluetooth" -> 0
    "wired" -> 1
    "other" -> 2
    else -> 3
  }

  /**
   * The output music goes to. Android 13+ answers that directly; before it,
   * the likeliest of the connected outputs, the way the system itself picks
   * (a headset over the speaker).
   */
  private fun mediaOutput(manager: AudioManager): AudioDeviceInfo? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()
      runCatching { manager.getAudioDevicesForAttributes(attributes).firstOrNull() }
        .getOrNull()
        ?.let { return it }
    }
    val outputs = runCatching { manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList() }
      .getOrElse { emptyList() }
    return outputs.minWithOrNull(compareBy({ rankOf(it.type) }, { it.id }))
  }

  private fun currentRoute(): Map<String, String> {
    val phone = mapOf("kind" to "builtin", "name" to "")
    val manager = audioManager ?: return phone
    val device = runCatching { mediaOutput(manager) }.getOrNull() ?: return phone
    val kind = kindOf(device.type)
    // The speaker's product name is the phone model, which says nothing.
    val name = if (kind == "builtin") "" else
      runCatching { device.productName?.toString()?.trim().orEmpty() }.getOrElse { "" }
    return mapOf("kind" to kind, "name" to name)
  }

  override fun definition() = ModuleDefinition {
    Name("AudioRoute")

    Events("routeChanged")

    Function("getRoute") { currentRoute() }

    OnCreate {
      runCatching { audioManager?.registerAudioDeviceCallback(deviceCallback, handler) }
    }

    OnDestroy {
      handler.removeCallbacks(resend)
      runCatching { audioManager?.unregisterAudioDeviceCallback(deviceCallback) }
    }
  }
}
