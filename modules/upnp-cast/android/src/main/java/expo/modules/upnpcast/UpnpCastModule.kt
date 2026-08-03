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

/** Lo que se le cuenta al renderer sobre la pista que va a sonar. */
class TrackInfo(
  /** Tipo MIME real (audio/flac, audio/mpeg…). Sin él, un altavoz rechaza la
   *  pista porque la librería la anuncia como vídeo (ver AvTransport). */
  @Field val mime: String? = null,
  /** El título a secas; el que va como argumento lleva además el artista, que
   *  es lo único que sabe enseñar el respaldo. */
  @Field val title: String? = null,
  @Field val artist: String? = null,
  @Field val album: String? = null,
  /** Carátula, solo si es una URL que el aparato pueda alcanzar. */
  @Field val artworkUrl: String? = null,
  @Field val durationSec: Double? = null
) : Record

/**
 * Puente Expo ↔ UPnPCast (DLNA/UPnP). Descubre renderers en la red local y
 * controla la reproducción por AVTransport. Como UPnP no empuja eventos de
 * forma fiable, el estado/progreso se sondea cada segundo mientras hay
 * conexión y se emite a JS con el evento "state".
 */
class UpnpCastModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var pollJob: Job? = null

  /** Aparatos vistos en la última búsqueda, por id (para conectar por id). */
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
     * Busca renderers en la red; resuelve con la lista al agotar el timeout.
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
     * Carga una URL en el renderer conectado. El renderer siempre arranca
     * reproduciendo; con startMs > 0 se busca esa posición nada más empezar.
     *
     * La entrega la hace `AvTransport`, que le cuenta al aparato qué es lo que
     * suena; la librería queda de respaldo por si no logramos hablar con él
     * (ver #70).
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

    /** Volumen del renderer, 0..100. */
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
