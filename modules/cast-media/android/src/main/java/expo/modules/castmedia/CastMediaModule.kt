package expo.modules.castmedia

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * Expo bridge to the media session used while casting. `start`, `update` and
 * `setState` push metadata and state into `CastMediaService`, which keeps the
 * notification up and catches the volume keys, and whatever is pressed there
 * comes back to JS as a "command" event. The JS API lives in
 * `src/store/castMedia.ts`.
 */
class CastMediaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CastMedia")

    Events("command")

    OnCreate {
      instance = this@CastMediaModule
    }

    OnDestroy {
      if (instance === this@CastMediaModule) instance = null
    }

    /** Opens the session with the track's initial metadata and state. */
    Function("start") { json: String ->
      val ctx = appContext.reactContext?.applicationContext ?: return@Function
      val info = parseInfo(json)
      val running = CastMediaService.instance
      if (running != null) {
        running.update(info)
        return@Function
      }
      startService(ctx, info)
    }

    /** Fresh metadata and state, for a track change. */
    Function("update") { json: String ->
      val info = parseInfo(json)
      val running = CastMediaService.instance
      if (running != null) {
        running.update(info)
      } else {
        // Not running yet: go through the same path `start` takes.
        val ctx = appContext.reactContext?.applicationContext ?: return@Function
        startService(ctx, info)
      }
    }

    /** Playback state only: playing or paused, and how far in. */
    Function("setState") { isPlaying: Boolean, positionMs: Double ->
      CastMediaService.instance?.setState(isPlaying, positionMs.toLong())
    }

    /** Syncs the level the system's volume overlay shows (a 0..1 fraction). */
    Function("setVolumeLevel") { fraction: Double ->
      CastMediaService.instance?.setVolumeLevel(fraction)
    }

    /** Closes the session and takes the notification down. */
    Function("stop") {
      CastMediaService.instance?.stopEverything()
    }
  }

  /** Hands JS a control pressed on the notification, the lock screen or the
   *  volume keys. */
  fun emitCommand(action: String, value: Double?) {
    val payload = HashMap<String, Any>(2)
    payload["action"] = action
    if (value != null) payload["value"] = value
    sendEvent("command", payload)
  }

  companion object {
    @Volatile var instance: CastMediaModule? = null
      private set

    /**
     * Starts the foreground service with the initial state. Wrapped in
     * runCatching because on Android 12+ starting a foreground service from the
     * background throws: casting is always started from the foreground, but if
     * the system refuses anyway, swallowing it beats taking the app down.
     */
    private fun startService(ctx: Context, info: CastMediaService.Info) {
      CastMediaService.bootInfo = info
      val intent = Intent(ctx, CastMediaService::class.java).setAction(CastMediaService.ACTION_START)
      runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          ctx.startForegroundService(intent)
        } else {
          ctx.startService(intent)
        }
      }
    }
  }
}

private fun parseInfo(json: String): CastMediaService.Info {
  val o = runCatching { JSONObject(json) }.getOrNull() ?: JSONObject()
  return CastMediaService.Info(
    title = o.optString("title").takeIf { it.isNotEmpty() },
    artist = o.optString("artist").takeIf { it.isNotEmpty() },
    album = o.optString("album").takeIf { it.isNotEmpty() },
    artworkUrl = o.optString("artworkUrl").takeIf { it.isNotEmpty() },
    durationMs = o.optLong("durationMs", 0L),
    positionMs = o.optLong("positionMs", 0L),
    isPlaying = o.optBoolean("isPlaying", false),
  )
}
