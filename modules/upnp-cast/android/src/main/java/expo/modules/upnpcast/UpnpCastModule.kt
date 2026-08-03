package expo.modules.upnpcast

import com.yinnho.upnpcast.DLNACast
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** What the renderer is told about the track it is about to play. */
class TrackInfo(
  /** The real MIME type (audio/flac, audio/mpeg…). Without it a speaker turns
   *  the track down, because the library announces it as video (see
   *  AvTransport). */
  @Field val mime: String? = null,
  /** The title on its own; the one passed as an argument carries the artist
   *  too, which is all the fallback path knows how to show. */
  @Field val title: String? = null,
  @Field val artist: String? = null,
  @Field val album: String? = null,
  /** The cover, only when it is a URL the device can reach. */
  @Field val artworkUrl: String? = null,
  @Field val durationSec: Double? = null
) : Record

/**
 * Expo bridge to UPnPCast (DLNA/UPnP). Finds renderers on the local network and
 * drives playback over AVTransport. UPnP has no reliable way of pushing events,
 * so state and progress are polled once a second for as long as there is a
 * session and sent to JS as a "state" event.
 */
class UpnpCastModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var pollJob: Job? = null

  /** What the last search found, by id, so a device can be connected to by id. */
  private var devices: Map<String, DLNACast.Device> = emptyMap()
  private var current: DLNACast.Device? = null

  override fun definition() = ModuleDefinition {
    Name("UpnpCast")

    Events("state")

    OnCreate {
      appContext.reactContext?.applicationContext?.let { DLNACast.init(it) }
    }

    OnDestroy {
      pollJob?.cancel()
      runCatching { DLNACast.cleanup() }
      scope.cancel()
    }

    /**
     * Searches the network for renderers, resolving with the list once the
     * timeout is up.
     *
     * A search has to go out to the whole network, so everything on it answers,
     * and almost nothing in a house can play a note. The router is the usual
     * one: it speaks UPnP to open ports, and it ended up in a list of speakers,
     * which is all anyone without one would find there. Devices that answer
     * that they have no AVTransport are dropped; the ones that answer nothing
     * still show, since not having been able to ask is not a no.
     */
    AsyncFunction("search") { timeoutMs: Double, promise: Promise ->
      scope.launch {
        // Both searches speak SSDP and both are mostly spent waiting, so they
        // wait together: asking what each device is costs no extra seconds.
        val locations = async { runCatching { AvTransport.locations() }.getOrDefault(emptyMap()) }
        val found = runCatching { DLNACast.search(timeoutMs.toLong()) }.getOrDefault(emptyList())
        val verdicts = runCatching { AvTransport.renderers(found.map { it.address }, locations.await()) }
          .getOrDefault(emptyMap())
        val playable = found.filter { verdicts[it.address] != false }
        devices = devices + playable.associateBy { it.id }
        promise.resolve(
          playable.map {
            mapOf("id" to it.id, "name" to it.name, "address" to it.address, "isTV" to it.isTV)
          },
        )
      }
    }

    AsyncFunction("connect") { deviceId: String, promise: Promise ->
      val device = devices[deviceId]
      if (device == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      current = device
      startPolling()
      promise.resolve(true)
    }

    /**
     * Loads a URL on the connected renderer. It always starts playing; with
     * startMs > 0 that position is sought as soon as it does.
     *
     * The handover is `AvTransport`'s, which tells the device what it is being
     * sent; the library stays as the fallback for when we cannot make ourselves
     * understood (see #70).
     */
    AsyncFunction("load") { url: String, title: String, startMs: Double, track: TrackInfo?, promise: Promise ->
      val device = current
      if (device == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      scope.launch {
        val ours = track?.let {
          runCatching {
            AvTransport.play(
              device.address,
              AvTransport.Track(
                url = url,
                mime = it.mime ?: "audio/mpeg",
                title = it.title ?: title,
                artist = it.artist,
                album = it.album,
                artworkUrl = it.artworkUrl,
                durationSec = (it.durationSec ?: 0.0).toInt()
              )
            )
          }.getOrDefault(false)
        } ?: false
        val ok = ours || runCatching { DLNACast.castToDevice(device, url, title) }.getOrDefault(false)
        if (ok && startMs > 0) {
          delay(800)
          runCatching { DLNACast.seek(startMs.toLong()) }
        }
        promise.resolve(ok)
      }
    }

    AsyncFunction("play") { promise: Promise ->
      scope.launch { promise.resolve(runCatching { DLNACast.play() }.getOrDefault(false)) }
    }

    AsyncFunction("pause") { promise: Promise ->
      scope.launch { promise.resolve(runCatching { DLNACast.pause() }.getOrDefault(false)) }
    }

    AsyncFunction("seek") { positionMs: Double, promise: Promise ->
      scope.launch {
        promise.resolve(runCatching { DLNACast.seek(positionMs.toLong()) }.getOrDefault(false))
      }
    }

    /** The renderer's volume, 0..100. */
    AsyncFunction("setVolume") { volume: Int, promise: Promise ->
      scope.launch {
        promise.resolve(runCatching { DLNACast.setVolume(volume) }.getOrDefault(false))
      }
    }

    AsyncFunction("disconnect") { promise: Promise ->
      pollJob?.cancel()
      pollJob = null
      current = null
      AvTransport.forget()
      scope.launch {
        runCatching { DLNACast.stop() }
        promise.resolve(true)
      }
    }
  }

  private fun startPolling() {
    pollJob?.cancel()
    pollJob = scope.launch {
      while (isActive) {
        val state = runCatching { DLNACast.getState() }.getOrNull()
        val progress = runCatching { DLNACast.getProgressRealtime() }.getOrNull()
        if (state != null) {
          sendEvent(
            "state",
            mapOf(
              "playbackState" to state.playbackState.name,
              "positionMs" to (progress?.first ?: 0L).toDouble(),
              "durationMs" to (progress?.second ?: 0L).toDouble(),
            ),
          )
        }
        delay(1000)
      }
    }
  }
}
