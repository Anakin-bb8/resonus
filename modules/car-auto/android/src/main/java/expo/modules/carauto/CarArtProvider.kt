package expo.modules.carauto

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Serves remote covers to the Android Auto host under an opaque
 * `content://<package>.carart/<id>`.
 *
 * The host draws covers in its own process, so a remote one used to go to it
 * as the server's URL, and that URL carries the account's credentials in its
 * query. Here the host only ever sees an id; the address behind it stays in our
 * process (see [CarArtwork.contentUri]), and the file is fetched on the host's
 * first ask and kept in the cache for the next one.
 */
class CarArtProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    val context = context ?: throw FileNotFoundException(uri.toString())
    val id = uri.lastPathSegment?.takeIf { ID.matches(it) }
      ?: throw FileNotFoundException(uri.toString())
    val dir = File(context.cacheDir, DIR).apply { mkdirs() }
    val file = File(dir, id)
    if (!file.exists()) {
      val url = CarArtwork.realUrl(id) ?: throw FileNotFoundException(id)
      download(url, file)
      prune(dir)
    }
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  /** Written next to the target and moved into place, so a half-written file
   *  is never served. */
  private fun download(url: String, file: File) {
    val tmp = File(file.parentFile, "${file.name}.part")
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = TIMEOUT_MS
      conn.readTimeout = TIMEOUT_MS
      if (conn.responseCode !in 200..299) throw FileNotFoundException("HTTP ${conn.responseCode}")
      conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
      if (!tmp.renameTo(file)) throw FileNotFoundException(file.name)
    } finally {
      conn.disconnect()
      tmp.delete()
    }
  }

  /** Keeps the newest few hundred: enough for the screens the car shows. */
  private fun prune(dir: File) {
    val files = dir.listFiles()?.filter { !it.name.endsWith(".part") } ?: return
    if (files.size <= MAX_FILES) return
    files.sortedBy { it.lastModified() }.take(files.size - MAX_FILES).forEach { it.delete() }
  }

  override fun getType(uri: Uri): String = "image/*"

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?,
  ): Int = 0

  private companion object {
    val ID = Regex("[0-9a-f]{32}")
    const val DIR = "car-art"
    const val MAX_FILES = 300
    const val TIMEOUT_MS = 8000
  }
}
