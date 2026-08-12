package expo.modules.upnpcast

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

object Ssdp {
  private const val ADDRESS = "239.255.255.250"
  private const val PORT = 1900
  private const val MEDIA_RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1"

  suspend fun discover(timeoutMs: Long): Map<String, String> = withContext(Dispatchers.IO) {
    val found = LinkedHashMap<String, String>()
    runCatching {
      DatagramSocket().use { socket ->
        socket.soTimeout = RECEIVE_SLICE_MS
        socket.broadcast = true
        val group = InetAddress.getByName(ADDRESS)
        for (target in listOf(MEDIA_RENDERER, "ssdp:all")) {
          val request = buildString {
            append("M-SEARCH * HTTP/1.1\r\n")
            append("HOST: $ADDRESS:$PORT\r\n")
            append("MAN: \"ssdp:discover\"\r\n")
            append("MX: 2\r\n")
            append("ST: $target\r\n\r\n")
          }.toByteArray()
          runCatching {
            socket.send(DatagramPacket(request, request.size, group, PORT))
          }
        }

        val deadline = System.currentTimeMillis() + timeoutMs
        val buffer = ByteArray(BUFFER_BYTES)
        while (System.currentTimeMillis() < deadline) {
          val packet = DatagramPacket(buffer, buffer.size)
          try {
            socket.receive(packet)
          } catch (_: SocketTimeoutException) {
            continue
          }
          val address = packet.address?.hostAddress ?: continue
          val location = headerValue(String(packet.data, 0, packet.length), "LOCATION")
          if (!location.isNullOrEmpty()) found.putIfAbsent(location, address)
        }
      }
    }
    found
  }

  private fun headerValue(response: String, name: String): String? =
    response.lineSequence()
      .firstOrNull { it.startsWith("$name:", ignoreCase = true) }
      ?.substringAfter(':')
      ?.trim()

  private const val RECEIVE_SLICE_MS = 400
  private const val BUFFER_BYTES = 8192
}