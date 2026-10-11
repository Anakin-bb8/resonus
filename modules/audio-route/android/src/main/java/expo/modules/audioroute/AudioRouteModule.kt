package expo.modules.audioroute

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Where the sound is going, from the framework's AudioManager.
 *
 * Only the device kinds: no permission is needed to list them, while reading
 * a Bluetooth device's advertised name wants BLUETOOTH_CONNECT, which the app
 * does not ask for — so Bluetooth names may come back empty and the client
 * falls back to a generic label. Everything is wrapped: audio hardware that
 * misbehaves reports no route rather than taking the bridge down.
 */
class AudioRouteModule : Module() {
  private val audioManager: AudioManager? by lazy {
    appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
  }

  private val deviceCallback = object : AudioManager.AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
      sendEvent("routeChanged", currentRoute())
    }

    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
      sendEvent("routeChanged", currentRoute())
    }
  }

  private fun kindOf(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER,
    AudioDeviceInfo.TYPE_HEARING_AID -> "bluetooth"
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_ACCESSORY -> "wired"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "builtin"
    else -> "other"
  }

  /** Lower wins: the first interesting output, else whatever is there. */
  private fun rankOf(type: Int): Int = when (kindOf(type)) {
    "bluetooth" -> 0
    "wired" -> 1
    "other" -> 2
    else -> 3
  }

  private fun currentRoute(): Map<String, String> {
    val manager = audioManager ?: return mapOf("kind" to "builtin", "name" to "")
    val outputs = runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
      } else {
        emptyList()
      }
    }.getOrElse { emptyList() }
    if (outputs.isEmpty()) return mapOf("kind" to "builtin", "name" to "")
    val device = outputs.minWithOrNull(compareBy({ rankOf(it.type) }, { it.id })) ?: outputs[0]
    val name = runCatching { device.productName?.toString().orEmpty() }.getOrElse { "" }
    return mapOf("kind" to kindOf(device.type), "name" to name)
  }

  override fun definition() = ModuleDefinition {
    Name("AudioRoute")

    Events("routeChanged")

    Function("getRoute") { currentRoute() }

    OnCreate {
      runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          audioManager?.registerAudioDeviceCallback(
            deviceCallback,
            Handler(Looper.getMainLooper()),
          )
        }
      }
    }

    OnDestroy {
      runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          audioManager?.unregisterAudioDeviceCallback(deviceCallback)
        }
      }
    }
  }
}
