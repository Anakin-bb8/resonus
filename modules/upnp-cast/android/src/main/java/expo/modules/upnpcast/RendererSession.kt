package expo.modules.upnpcast

import android.util.Log

class RendererSession(
  val deviceId: String,
  val address: String,
  val location: String,
  initialDescription: DeviceDescription
) {
  @Volatile
  private var description: DeviceDescription = initialDescription

  @Volatile
  private var avTransport: String? = initialDescription.controlUrl(Services.AV_TRANSPORT)

  private val renderingControl: String? =
    initialDescription.controlUrl(Services.RENDERING_CONTROL)

  data class State(val playbackState: String, val positionMs: Long, val durationMs: Long, val trackNumber: Int?)

  private data class TransportTarget(val controlUrl: String, val uid: String)

  suspend fun load(track: Track): Boolean {
    val target = resolveTransportTarget() ?: return false
    val accepted = setUri(target.controlUrl, track, withMetadata = true) ||
      setUri(target.controlUrl, track, withMetadata = false)

    if (!accepted) {
      avTransport = null
      return false
    }
    return true
  }

  suspend fun loadQueue(tracks: List<Track>, currentIndex: Int, autoplay: Boolean, positionMs: Long, playMode: String?): Boolean {
    val target = resolveTransportTarget() ?: return false

    val accepted = replaceQueue(target.controlUrl, target.uid, tracks, currentIndex, autoplay, positionMs, playMode)

    if (!accepted) {
      avTransport = null
      return false
    }
    return true
  }

  private suspend fun setUri(control: String, track: Track, withMetadata: Boolean): Boolean {
    val escapedMetadata = if (withMetadata) Soap.escape(Didl.forTrack(track)) else ""
    Log.d(
      Soap.TAG,
      "SetAVTransportURI ${if (withMetadata) "with" else "without"} metadata title=${track.title} artist=${track.artist} album=${track.album} artworkUrl=${track.artworkUrl} metadataBytes=${escapedMetadata.length}"
    )
    val result = Soap.call(
      control,
      Services.AV_TRANSPORT,
      "SetAVTransportURI",
      "<InstanceID>0</InstanceID>" +
        "<CurrentURI>${Soap.escape(track.url)}</CurrentURI>" +
        "<CurrentURIMetaData>$escapedMetadata</CurrentURIMetaData>"
    )
    if (!result.ok && withMetadata) {
      Log.w(Soap.TAG, "renderer refused metadata payload; retrying URI without metadata")
    }
    return result.ok
  }

  private suspend fun enqueueTrack(control: String, track: Track, withMetadata: Boolean): Boolean {
    val escapedMetadata = if (withMetadata) Soap.escape(Didl.forTrack(track)) else ""
    val result = Soap.call(
      control,
      Services.AV_TRANSPORT,
      "AddURIToQueue",
      "<InstanceID>0</InstanceID>" +
        "<EnqueuedURI>${Soap.escape(track.url)}</EnqueuedURI>" +
        "<EnqueuedURIMetaData>$escapedMetadata</EnqueuedURIMetaData>" +
        "<DesiredFirstTrackNumberEnqueued>0</DesiredFirstTrackNumberEnqueued>" +
        "<EnqueueAsNext>0</EnqueueAsNext>"
    )
    if (!result.ok && withMetadata) {
      Log.w(Soap.TAG, "renderer refused queue metadata payload; retrying URI without metadata")
    }
    return result.ok
  }

  private suspend fun replaceQueue(control: String, queueOwnerUid: String, tracks: List<Track>, currentIndex: Int, autoplay: Boolean, positionMs: Long, playMode: String?): Boolean {
    if (tracks.isEmpty()) return false
    val selectedIndex = currentIndex.coerceIn(0, tracks.lastIndex)

    if (!transport("RemoveAllTracksFromQueue", INSTANCE)) return false
    for (track in tracks) {
      val accepted = enqueueTrack(control, track, withMetadata = true) ||
        enqueueTrack(control, track, withMetadata = false)
      if (!accepted) return false
    }

    val queueUri = "x-rincon-queue:$queueOwnerUid#0"
    if (!Soap.call(
        control,
        Services.AV_TRANSPORT,
        "SetAVTransportURI",
        "<InstanceID>0</InstanceID>" +
          "<CurrentURI>${Soap.escape(queueUri)}</CurrentURI>" +
          "<CurrentURIMetaData></CurrentURIMetaData>"
      ).ok
    ) {
      return false
    }

    if (!playMode.isNullOrBlank()) {
      if (!Soap.call(
          control,
          Services.AV_TRANSPORT,
          "SetPlayMode",
          "<InstanceID>0</InstanceID><NewPlayMode>${Soap.escape(playMode)}</NewPlayMode>"
        ).ok
      ) {
        return false
      }
    }

    if (!transport("Seek", "<InstanceID>0</InstanceID><Unit>TRACK_NR</Unit><Target>${selectedIndex + 1}</Target>")) {
      return false
    }

    if (positionMs > 0) {
      if (!seek(positionMs)) return false
    }

    if (autoplay) {
      if (!play()) return false
    }
    return true
  }

  suspend fun play(): Boolean = transport("Play", "<InstanceID>0</InstanceID><Speed>1</Speed>")

  suspend fun pause(): Boolean {
    if (transport("Pause", "<InstanceID>0</InstanceID>")) return true
    return transport("Stop", "<InstanceID>0</InstanceID>")
  }

  suspend fun stop(): Boolean = transport("Stop", "<InstanceID>0</InstanceID>")

  suspend fun join(target: RendererSession): Boolean {
    val ownControl = avTransport ?: refreshControlUrl() ?: return false
    val targetUid = target.resolveTransportTarget()?.uid ?: return false
    return Soap.call(
      ownControl,
      Services.AV_TRANSPORT,
      "SetAVTransportURI",
      "<InstanceID>0</InstanceID>" +
        "<CurrentURI>${Soap.escape("x-rincon:$targetUid")}</CurrentURI>" +
        "<CurrentURIMetaData></CurrentURIMetaData>"
    ).ok
  }

  suspend fun ungroup(): Boolean {
    val ownControl = description.controlUrl(Services.AV_TRANSPORT) ?: refreshControlUrl() ?: return false
    return Soap.call(
      ownControl,
      Services.AV_TRANSPORT,
      "BecomeCoordinatorOfStandaloneGroup",
      INSTANCE
    ).ok
  }

  suspend fun seek(positionMs: Long): Boolean = transport(
    "Seek",
    "<InstanceID>0</InstanceID><Unit>REL_TIME</Unit>" +
      "<Target>${Didl.hms((positionMs / 1000).toInt())}</Target>"
  )

  private suspend fun transport(action: String, arguments: String): Boolean {
    val control = avTransport ?: refreshControlUrl() ?: return false
    return Soap.call(control, Services.AV_TRANSPORT, action, arguments).ok
  }

  private suspend fun resolveTransportTarget(): TransportTarget? {
    val control = avTransport ?: refreshControlUrl() ?: return null
    val coordinator = SonosTopology.coordinatorTarget(description)
    if (coordinator != null) {
      avTransport = coordinator.controlUrl
      return TransportTarget(coordinator.controlUrl, coordinator.uid)
    }
    val uid = description.udn?.removePrefix("uuid:")?.trim()?.uppercase() ?: deviceId
    return TransportTarget(control, uid)
  }

  suspend fun setPlayMode(playMode: String): Boolean {
    val control = avTransport ?: refreshControlUrl() ?: return false
    return Soap.call(
      control,
      Services.AV_TRANSPORT,
      "SetPlayMode",
      "<InstanceID>0</InstanceID><NewPlayMode>${Soap.escape(playMode)}</NewPlayMode>"
    ).ok
  }

  suspend fun setVolume(volume: Int): Boolean {
    val control = renderingControl ?: return false
    return Soap.call(
      control,
      Services.RENDERING_CONTROL,
      "SetVolume",
      "<InstanceID>0</InstanceID><Channel>Master</Channel>" +
        "<DesiredVolume>${volume.coerceIn(0, 100)}</DesiredVolume>"
    ).ok
  }

  suspend fun state(): State? {
    val control = avTransport ?: return null
    val transport = Soap.call(control, Services.AV_TRANSPORT, "GetTransportInfo", INSTANCE)
    val playbackState = Soap.argument(transport.body, "CurrentTransportState") ?: return null
    val position = Soap.call(control, Services.AV_TRANSPORT, "GetPositionInfo", INSTANCE)
    val trackNumber = Soap.argument(position.body, "Track")?.toIntOrNull()
    return State(
      playbackState = playbackState,
      positionMs = Didl.parseDuration(Soap.argument(position.body, "RelTime")),
      durationMs = Didl.parseDuration(Soap.argument(position.body, "TrackDuration")),
      trackNumber = trackNumber
    )
  }

  private suspend fun refreshControlUrl(): String? {
    val fresh = Soap.fetch(location)?.let { DeviceDescription.parse(it, location) } ?: return null
    description = fresh
    avTransport = fresh.controlUrl(Services.AV_TRANSPORT)
    return avTransport
  }

  private companion object {
    const val INSTANCE = "<InstanceID>0</InstanceID>"
  }
}
