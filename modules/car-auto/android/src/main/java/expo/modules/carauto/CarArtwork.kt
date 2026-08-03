// Adapted from wavio (github.com/Joel-Mercier/wavio, MIT) for Resonus.
package expo.modules.carauto

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import androidx.media3.common.MediaMetadata
import java.io.ByteArrayOutputStream

/**
 * Cover art for Android Auto. The AA host draws the covers in its *own*
 * process: it can fetch an http(s) artworkUri by itself, but it cannot read our
 * file:// covers, which are private to the app. For those the bitmap is decoded
 * and scaled down in our process and the JPEG bytes are sent with
 * setArtworkData, which travels over the binder so the host can draw it without
 * touching the filesystem. Remote URLs still go as setArtworkUri: they are
 * small, and fetching them is the host's business.
 *
 * The bytes are kept small (320px at most, JPEG q80, so ~20-40KB) and cached by
 * path, so the album and queue items that share a cover are only decoded once.
 * `apply` returns how many bytes it embedded (0 for a uri, or for nothing at
 * all) so the caller can keep a binder transaction within bounds. See the guard
 * in JsProxyPlayer.
 */
internal object CarArtwork {
  private const val MAX_DIM = 320
  private const val QUALITY = 80
  private val cache = object : LruCache<String, ByteArray>(8 * 1024 * 1024) {
    override fun sizeOf(key: String, value: ByteArray): Int = value.size
  }

  /**
   * Puts the cover on [builder]. With [embed] false a local file is never
   * decoded and its uri is used as it is, which is how the caller limits how
   * much artwork it embeds in one transaction. Returns the bytes embedded.
   */
  fun apply(builder: MediaMetadata.Builder, artworkUrl: String?, embed: Boolean = true): Int {
    if (artworkUrl == null) return 0
    val bytes = if (embed) localArtworkData(artworkUrl) else null
    if (bytes != null) {
      builder.setArtworkData(bytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
      return bytes.size
    }
    builder.setArtworkUri(Uri.parse(artworkUrl))
    return 0
  }

  private fun localArtworkData(uri: String): ByteArray? {
    if (!uri.startsWith("file://")) return null
    val path = Uri.parse(uri).path ?: return null
    cache.get(path)?.let { return it }
    return runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      val opts = BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight)
      }
      val bmp = BitmapFactory.decodeFile(path, opts) ?: return null
      val out = ByteArrayOutputStream()
      bmp.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
      bmp.recycle()
      out.toByteArray().also { cache.put(path, it) }
    }.getOrNull()
  }

  // The largest power-of-two subsampling that keeps both sides >= MAX_DIM.
  private fun sampleSize(width: Int, height: Int): Int {
    var sample = 1
    var w = width
    var h = height
    while (w / 2 >= MAX_DIM && h / 2 >= MAX_DIM) {
      w /= 2
      h /= 2
      sample *= 2
    }
    return sample
  }
}
