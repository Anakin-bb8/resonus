package expo.modules.upnpcast

import android.util.Log
import kotlinx.coroutines.Dispatchers
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
    val ok = soap(
      control,
      "SetAVTransportURI",
      """
      <InstanceID>0</InstanceID>
      <CurrentURI>${escape(track.url)}</CurrentURI>
      <CurrentURIMetaData>${escape(didl(track))}</CurrentURIMetaData>
      """.trimIndent()
    )
    if (!ok) {
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
            if (packet.address?.hostAddress != address) continue
            val answer = String(packet.data, 0, packet.length)
            val location = answer.lineSequence()
              .firstOrNull { it.startsWith("LOCATION:", ignoreCase = true) }
              ?.substringAfter(":")
              ?.trim()
            if (!location.isNullOrEmpty()) return@use location
          }
          null
        }
      }.getOrNull()
    }

  /**
   * The AVTransport control URL out of the device description.
   *
   * Read rather than assumed: the paths are the manufacturer's to choose, and
   * guessing one is how a device that answers everything else ends up unable to
   * play anything.
   */
  private fun avTransportControlUrl(description: String, location: String): String? {
    val service = Regex("<service>(.*?)</service>", RegexOption.DOT_MATCHES_ALL)
      .findAll(description)
      .map { it.groupValues[1] }
      .firstOrNull { it.contains("AVTransport", ignoreCase = true) }
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

  // ── Talking to it ──────────────────────────────────────────────────────────

  /** A SOAP action on AVTransport. True when the renderer accepted it. */
  private suspend fun soap(controlUrl: String, action: String, body: String): Boolean =
    withContext(Dispatchers.IO) {
      val service = "urn:schemas-upnp-org:service:AVTransport:1"
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
        }
        code == 200
      }.getOrDefault(false).also { connection?.disconnect() }
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
}
