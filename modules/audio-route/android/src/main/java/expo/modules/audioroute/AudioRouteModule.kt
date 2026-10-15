package expo.modules.audioroute

import android.Manifest
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions.askForPermissionsWithPermissionsManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Where the sound is going, from the framework's AudioManager.
 *
 * Only the device kinds: no permission is needed to list them, while reading
 * a Bluetooth device's advertised name or class wants BLUETOOTH_CONNECT,
 * which is asked for lazily the first time a Bluetooth route has neither.
 * Everything is wrapped: audio hardware that misbehaves reports no route
 * rather than taking the bridge down.
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

  private fun hasBtConnect(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val context = appContext.reactContext ?: return false
    return ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
      PackageManager.PERMISSION_GRANTED
  }

  /**
   * What the system says the Bluetooth device is (headphones, a speaker, the
   * car), looked up by hardware address among the bonded devices. Null when
   * there is nothing to ask — no address, no permission, or an unknown class —
   * and the client keeps the generic Bluetooth mark.
   */
  private fun bluetoothClassFor(address: String?): String? {
    if (address.isNullOrEmpty() || !hasBtConnect()) return null
    return runCatching {
      val context = appContext.reactContext ?: return null
      val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      val adapter = try {
        manager?.adapter
      } catch (_: SecurityException) {
        null
      } ?: return null
      val cls = try {
        adapter.getRemoteDevice(address).bluetoothClass
      } catch (_: IllegalArgumentException) {
        null
      } catch (_: SecurityException) {
        null
      } ?: return null
      if (cls.majorDeviceClass != BluetoothClass.Device.Major.AUDIO_VIDEO) return null
      when (cls.deviceClass) {
        BluetoothClass.Device.AUDIO_VIDEO_HEADPHONES,
        BluetoothClass.Device.AUDIO_VIDEO_HEADSET,
        BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE,
        BluetoothClass.Device.AUDIO_VIDEO_MICROPHONE,
        BluetoothClass.Device.AUDIO_VIDEO_PORTABLE_AUDIO,
        BluetoothClass.Device.AUDIO_VIDEO_HIFI_AUDIO -> "headphones"
        BluetoothClass.Device.AUDIO_VIDEO_LOUDSPEAKER -> "speaker"
        BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO -> "car"
        else -> null
      }
    }.getOrNull()
  }

  private fun currentRoute(): Map<String, String> {
    val none = mapOf("kind" to "builtin", "name" to "", "deviceClass" to "", "needsPermission" to "false")
    val manager = audioManager ?: return none
    val outputs = runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
      } else {
        emptyList()
      }
    }.getOrElse { emptyList() }
    if (outputs.isEmpty()) return none
    val device = outputs.minWithOrNull(compareBy({ rankOf(it.type) }, { it.id })) ?: outputs[0]
    val kind = kindOf(device.type)
    val name = runCatching { device.productName?.toString().orEmpty() }.getOrElse { "" }
    // The hardware address is withheld without BLUETOOTH_CONNECT on Android
    // 12+, which is also what the class lookup needs: one permission covers
    // both the real name and the real kind.
    val address = runCatching { device.address.orEmpty() }.getOrElse { "" }
    val deviceClass = if (kind == "bluetooth") bluetoothClassFor(address) else null
    val needsPermission = kind == "bluetooth" &&
      deviceClass == null &&
      (address.isNullOrEmpty() || name.isEmpty()) &&
      !hasBtConnect()
    return mapOf(
      "kind" to kind,
      "name" to name,
      "deviceClass" to deviceClass.orEmpty(),
      "needsPermission" to if (needsPermission) "true" else "false",
    )
  }

  override fun definition() = ModuleDefinition {
    Name("AudioRoute")

    Events("routeChanged")

    Function("getRoute") { currentRoute() }

    AsyncFunction("requestBluetoothPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || hasBtConnect()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.BLUETOOTH_CONNECT,
      )
    }

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
