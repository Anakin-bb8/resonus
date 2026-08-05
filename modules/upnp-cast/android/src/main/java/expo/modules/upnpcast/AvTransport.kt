package expo.modules.upnpcast

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URL

/**
 * Handing a track to a UPnP renderer, ourselves.
 *
 * The library we use for discovery and for the transport controls decides what
 * it is sending by looking for a file extension in the URL, and calls anything
 * it doesn't recognise a video (`video/mp4`, `object.item.videoItem`). A
 * Subsonic stream URL carries no extension, so every song went out announced as
 * a video: a TV takes it anyway, a speaker rejects it and the whole thing came
 * back as "this song can't be cast" (#70).
 *
 * There is no way to tell the library otherwise, so the one call that carries
 * the metadata is made here instead: SetAVTransportURI with a DIDL that says
 * what the track actually is, and Play. Everything else (finding the devices,
 * the state polling, volume, seek) is still the library's.
 *
 * If any of this doesn't work out the caller falls back to the library, so the
 * devices that were casting before keep casting.
 */
object AvTransport {
  private const val TAG = "UpnpCast"
  private const val SSDP_HOST = "239.255.255.250"
  private const val SSDP_PORT = 1900

  /** Resolved AVTransport control URL per device address. Finding it costs a
   *  discovery round, and the answer holds for as long as the device is there. */
  private val controlUrls = mutableMapOf<String, String>()

  /** What the renderer is told about the track. */
  data class Track(
    val url: String,
    val mime: String,
    val title: String,
    val artist: String?,
    val album: String?,
    val artworkUrl: String?,
    val durationSec: Int
  )

  /**
   * Loads the track on the renderer at `address` and starts it.
   *
   * Returns false without touching anything if the device can't be resolved or
   * refuses the request, which is the caller's cue to try the library.
   */
  suspend fun play(address: String, track: Track): Boolean {
    val control = controlUrl(address) ?: return false
    var accepted = setUri(control, track, withMetadata = true)
    // Turned down with the metadata, offered again without it. The DIDL is what
    // says the track is audio and not a video, so it goes first every time, but
    // a renderer that dislikes something in it refuses the whole call and the
    // URI alone is better than nothing (#121).
    if (!accepted) accepted = setUri(control, track, withMetadata = false)
    // Sonos, and only Sonos: speakers that are grouped or paired take their
    // orders through one of them, and the others answer a SetAVTransportURI
    // with a refusal no matter what is in it. Which one is the coordinator is
    // in the group topology, so it is asked, and the same two attempts are made
    // there. On a speaker that is on its own the coordinator is itself, so this
    // resolves to the address we already tried and costs one lookup.
    if (!accepted) {
      val coordinator = sonosCoordinatorControl(address)
      if (coordinator != null && coordinator != control) {
        accepted = setUri(coordinator, track, withMetadata = true) ||
          setUri(coordinator, track, withMetadata = false)
        if (accepted) {
          // It answers for this speaker from here on, including the Play below
          // and everything the session sends afterwards.
          controlUrls[address] = coordinator
          soap(coordinator, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>")
          return true
        }
      }
    }
    if (!accepted) {
      // Whatever we had cached about this device is worth nothing if it is not
      // answering, so the next attempt looks it up again.
      controlUrls.remove(address)
      return false
    }
    // Renderers differ on whether handing over a URI starts playback. Asking
    // for it is harmless on the ones that already did.
    soap(control, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>")
    return true
  }

  /** The one call that hands the track over, with or without the DIDL. */
  private suspend fun setUri(control: String, track: Track, withMetadata: Boolean): Boolean =
    soap(
      control,
      "SetAVTransportURI",
      """
      <InstanceID>0</InstanceID>
      <CurrentURI>${escape(track.url)}</CurrentURI>
      <CurrentURIMetaData>${if (withMetadata) escape(didl(track)) else ""}</CurrentURIMetaData>
      """.trimIndent()
    )

  /** Forgets what was resolved, for a session that is ending. */
  fun forget() = controlUrls.clear()

  // ── Finding the device ─────────────────────────────────────────────────────

  private suspend fun controlUrl(address: String): String? {
    controlUrls[address]?.let { return it }
    val location = discover(address) ?: return null
    val description = fetch(location) ?: return null
    val control = avTransportControlUrl(description, location) ?: return null
    controlUrls[address] = control
    return control
  }

  /**
   * The device's description URL, asked for over SSDP.
   *
   * The search goes to the whole network because that is the only way to ask,
   * and the answers that are not from the device we mean are dropped. Answers
   * come back to our own port, so this needs no multicast lock.
   */
  private suspend fun discover(address: String, timeoutMs: Long = 3000): String? =
    ssdpLocations(timeoutMs, until = address)[address]

  /**
   * Where each device on the network says its description lives, address →
   * LOCATION. With `until` set it stops as soon as that address has answered,
   * which is all `discover` waits for; without it the whole window is spent
   * listening, so one search serves every device at once.
   */
  suspend fun locations(): Map<String, String> = ssdpLocations()

  private suspend fun ssdpLocations(
    timeoutMs: Long = 3000,
    until: String? = null
  ): Map<String, String> =
    withContext(Dispatchers.IO) {
      // Asked for twice: not every renderer answers a search for its own device
      // type, and the ones that don't do answer a search for anything at all.
      val searches = listOf("urn:schemas-upnp-org:device:MediaRenderer:1", "ssdp:all").map {
        (
          "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: $SSDP_HOST:$SSDP_PORT\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 2\r\n" +
            "ST: $it\r\n\r\n"
          ).toByteArray()
      }
      val found = mutableMapOf<String, String>()
      runCatching {
        DatagramSocket().use { socket ->
          socket.soTimeout = 500
          val group = InetAddress.getByName(SSDP_HOST)
          for (request in searches) {
            socket.send(DatagramPacket(request, request.size, group, SSDP_PORT))
          }
          val deadline = System.currentTimeMillis() + timeoutMs
          val buffer = ByteArray(4096)
          while (System.currentTimeMillis() < deadline) {
            val packet = DatagramPacket(buffer, buffer.size)
            try {
              socket.receive(packet)
            } catch (e: SocketTimeoutException) {
              continue
            }
            val from = packet.address?.hostAddress ?: continue
            val answer = String(packet.data, 0, packet.length)
            val location = answer.lineSequence()
              .firstOrNull { it.startsWith("LOCATION:", ignoreCase = true) }
              ?.substringAfter(":")
              ?.trim()
            if (location.isNullOrEmpty()) continue
            found.putIfAbsent(from, location)
            if (until != null && from == until) break
          }
        }
      }
      found
    }

  /**
   * Which of these addresses can be played to, as far as they are willing to
   * say. Answers by address: true is a renderer, false is something that
   * answered and cannot play, and absent means it did not say.
   *
   * A search has to go out to the whole network to reach anything at all, so
   * everything on it answers, and most of what is on a home network cannot play
   * a note. A router is the usual one: it speaks UPnP to open ports, has no
   * business in a list of speakers, and is what people find there when they
   * have nothing else. Anything that does play audio over UPnP has an
   * AVTransport service in its description, and that is what is asked here.
   *
   * Silence is not a "no": a device that does not answer in time, or whose
   * description cannot be fetched right now, says nothing about what it is, and
   * is left for the caller to decide. Better a router on the list than a
   * speaker missing from it.
   *
   * `locations` is what `locations()` collected, taken as an argument so the
   * caller can have that search running while it does its own.
   */
  suspend fun renderers(
    addresses: List<String>,
    locations: Map<String, String>
  ): Map<String, Boolean> {
    if (addresses.isEmpty()) return emptyMap()
    val known = addresses.filter { controlUrls.containsKey(it) }.associateWith { true }
    val rest = addresses.filter { it !in known }
    if (rest.isEmpty()) return known
    val checked = withContext(Dispatchers.IO) {
      // At once: each description is a request to a different device, and one
      // that is slow to answer should not decide how long the list takes.
      rest.map { address ->
        async {
          val location = locations[address] ?: return@async null
          val description = fetch(location) ?: return@async null
          val control = avTransportControlUrl(description, location)
          // Resolved on the way: playing to it later is one round trip shorter.
          if (control != null) controlUrls[address] = control
          address to (control != null)
        }
      }.awaitAll().filterNotNull()
    }
    return known + checked
  }

  /**
   * The AVTransport control URL out of the device description.
   *
   * Read rather than assumed: the paths are the manufacturer's to choose, and
   * guessing one is how a device that answers everything else ends up unable to
   * play anything.
   */
  private fun avTransportControlUrl(description: String, location: String): String? =
    serviceControlUrl(description, location, "AVTransport")

  /**
   * The control URL of a service, wherever it sits in the description. Nesting
   * is not looked at on purpose: on Sonos the AVTransport belongs to a
   * MediaRenderer that hangs inside the ZonePlayer, and the only thing that
   * matters is which `<service>` block carries the name.
   */
  private fun serviceControlUrl(description: String, location: String, name: String): String? {
    val service = Regex("<service>(.*?)</service>", RegexOption.DOT_MATCHES_ALL)
      .findAll(description)
      .map { it.groupValues[1] }
      .firstOrNull { it.contains(name, ignoreCase = true) }
      ?: return null
    val control = Regex("<controlURL>(.*?)</controlURL>", RegexOption.DOT_MATCHES_ALL)
      .find(service)
      ?.groupValues
      ?.get(1)
      ?.trim()
      ?: return null
    if (control.isEmpty()) return null
    // Relative to <URLBase> when the description gives one, and to the address
    // the description itself came from otherwise.
    val base = Regex("<URLBase>(.*?)</URLBase>", RegexOption.DOT_MATCHES_ALL)
      .find(description)
      ?.groupValues
      ?.get(1)
      ?.trim()
      ?.takeIf { it.isNotEmpty() }
      ?: location
    return runCatching { URL(URL(base), control).toString() }.getOrNull()
  }

  // ── Sonos, which does not answer for itself ────────────────────────────────

  /**
   * Where AVTransport has to be sent for the group this speaker belongs to, or
   * null if there is nothing to change: not a Sonos, on its own, or already the
   * one in charge.
   *
   * Sonos speakers that are grouped, and the two halves of a stereo pair, are
   * driven through one of them. The others accept being discovered, appear in
   * the list, answer for their volume, and then refuse to be handed a track, so
   * casting to a speaker that happened not to be the coordinator failed with
   * nothing to say about why (#121). Which one it is comes from the group
   * topology, which every Sonos will describe on request.
   *
   * Only on the way out of a failure, so a renderer that took the track never
   * pays for any of this.
   */
  private suspend fun sonosCoordinatorControl(address: String): String? {
    val location = discover(address) ?: return null
    val description = fetch(location) ?: return null
    if (!description.contains("Sonos", ignoreCase = true)) return null
    val uuid = Regex("<UDN>\\s*(?:uuid:)?(.*?)</UDN>", RegexOption.DOT_MATCHES_ALL)
      .find(description)
      ?.groupValues
      ?.get(1)
      ?.trim()
      ?: return null
    val topology = serviceControlUrl(description, location, "ZoneGroupTopology") ?: return null
    val answer = soapText(
      topology,
      "urn:schemas-upnp-org:service:ZoneGroupTopology:1",
      "GetZoneGroupState",
      ""
    ) ?: return null
    // The state is a whole XML document escaped inside the answer, so it comes
    // back out before anything can be read from it.
    val state = unescape(answer)
    val group = Regex("<ZoneGroup\\b(.*?)</ZoneGroup>", RegexOption.DOT_MATCHES_ALL)
      .findAll(state)
      .map { it.groupValues[1] }
      .firstOrNull { it.contains(uuid) }
      ?: return null
    val coordinator = Regex("Coordinator=\"(.*?)\"").find(group)?.groupValues?.get(1) ?: return null
    if (coordinator == uuid) return null
    val member = Regex(
      "<ZoneGroupMember\\b[^>]*UUID=\"${Regex.escape(coordinator)}\"[^>]*>"
    ).find(group)?.value ?: return null
    val where = Regex("Location=\"(.*?)\"").find(member)?.groupValues?.get(1)?.let { unescape(it) }
      ?: return null
    Log.w(TAG, "$address is not the coordinator of its group; trying $where")
    val coordinatorDescription = fetch(where) ?: return null
    return serviceControlUrl(coordinatorDescription, where, "AVTransport")
  }

  // ── Talking to it ──────────────────────────────────────────────────────────

  /** A SOAP action on AVTransport. True when the renderer accepted it. */
  private suspend fun soap(controlUrl: String, action: String, body: String): Boolean =
    soapText(controlUrl, "urn:schemas-upnp-org:service:AVTransport:1", action, body) != null

  /** The same, on any service, and answering with what came back. */
  private suspend fun soapText(
    controlUrl: String,
    service: String,
    action: String,
    body: String
  ): String? =
    withContext(Dispatchers.IO) {
      val envelope = """
        <?xml version="1.0" encoding="utf-8"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
          <s:Body>
            <u:$action xmlns:u="$service">
              $body
            </u:$action>
          </s:Body>
        </s:Envelope>
      """.trimIndent()
      var connection: HttpURLConnection? = null
      runCatching {
        connection = (URL(controlUrl).openConnection() as HttpURLConnection).apply {
          requestMethod = "POST"
          setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"")
          setRequestProperty("SOAPAction", "\"$service#$action\"")
          connectTimeout = 5000
          readTimeout = 5000
          doOutput = true
        }
        connection!!.outputStream.use { it.write(envelope.toByteArray(Charsets.UTF_8)) }
        val code = connection!!.responseCode
        if (code != 200) {
          // The fault body says which of the two it is: a renderer that will not
          // take this format, or one that did not understand the request.
          val fault = runCatching {
            connection!!.errorStream?.bufferedReader()?.use { it.readText() }
          }.getOrNull()
          Log.w(TAG, "$action refused ($code): ${fault?.take(400)}")
          null
        } else {
          connection!!.inputStream.bufferedReader().use { it.readText() }
        }
      }.getOrNull().also { connection?.disconnect() }
    }

  private fun fetch(url: String): String? = runCatching {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 4000
      readTimeout = 4000
    }
    try {
      if (connection.responseCode != 200) null
      else connection.inputStream.bufferedReader().use { it.readText() }
    } finally {
      connection.disconnect()
    }
  }.getOrNull()

  // ── What we say the track is ───────────────────────────────────────────────

  /**
   * The item description the renderer reads to decide whether it can play this.
   *
   * `protocolInfo` is the part that matters: the fourth field is left as `*`
   * rather than naming a DLNA profile, which is what a server-side transcode
   * cannot promise anyway, and every renderer takes the wildcard.
   */
  private fun didl(track: Track): String {
    val art = track.artworkUrl
      ?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
      ?.let { "<upnp:albumArtURI>${escape(it)}</upnp:albumArtURI>" }
      ?: ""
    val artist = track.artist?.takeIf { it.isNotEmpty() }?.let {
      "<upnp:artist>${escape(it)}</upnp:artist><dc:creator>${escape(it)}</dc:creator>"
    } ?: ""
    val album = track.album?.takeIf { it.isNotEmpty() }?.let {
      "<upnp:album>${escape(it)}</upnp:album>"
    } ?: ""
    val duration = if (track.durationSec > 0) " duration=\"${hms(track.durationSec)}\"" else ""
    return """
      <DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
        <item id="0" parentID="-1" restricted="1">
          <dc:title>${escape(track.title)}</dc:title>
          $artist
          $album
          $art
          <upnp:class>object.item.audioItem.musicTrack</upnp:class>
          <res protocolInfo="http-get:*:${escape(track.mime)}:*"$duration>${escape(track.url)}</res>
        </item>
      </DIDL-Lite>
    """.trimIndent()
  }

  private fun hms(seconds: Int): String =
    "%d:%02d:%02d".format(seconds / 3600, (seconds % 3600) / 60, seconds % 60)

  private fun escape(text: String): String = text
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("\"", "&quot;")
    .replace("'", "&apos;")

  /** The way back, for a document that arrives escaped inside another one. */
  private fun unescape(text: String): String = text
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&apos;", "'")
    .replace("&amp;", "&")
}
