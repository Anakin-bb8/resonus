package expo.modules.homewidget

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.service.quicksettings.TileService
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * What the widget and the tile show, as JS last said it.
 *
 * Written to preferences so a widget redrawn after the process died still
 * shows the last song, with its cover saved next to them. `live` is not: it
 * says JS has spoken in THIS process, which is what makes the buttons worth
 * pressing. A fresh process has a queue nobody has loaded, and a media key
 * sent then would reach whichever app played last.
 */
internal object NowPlaying {
  private const val PREFS = "resonus_home_widget"
  private const val COVER_FILE = "home_widget_cover.png"
  /** Cover size in pixels: enough for the widget, cheap to send across processes. */
  private const val COVER_PX = 192

  @Volatile var live = false
    private set

  private val loader = Executors.newSingleThreadExecutor()
  @Volatile private var coverFor: String? = null
  @Volatile private var cover: Bitmap? = null

  data class State(
    val title: String,
    val artist: String,
    val artworkUrl: String?,
    val playing: Boolean,
    val active: Boolean,
  )

  fun read(context: Context): State {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return State(
      title = p.getString("title", "") ?: "",
      artist = p.getString("artist", "") ?: "",
      artworkUrl = p.getString("artworkUrl", null),
      // Nothing plays in a process JS has not spoken in.
      playing = live && p.getBoolean("playing", false),
      active = p.getBoolean("active", false),
    )
  }

  fun update(context: Context, state: State) {
    live = true
    val app = context.applicationContext
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("title", state.title)
      .putString("artist", state.artist)
      .putString("artworkUrl", state.artworkUrl)
      .putBoolean("playing", state.playing)
      .putBoolean("active", state.active)
      .apply()
    refresh(app)
    if (state.artworkUrl == null) {
      coverFor = null
      cover = null
      File(app.filesDir, COVER_FILE).delete()
    } else if (state.artworkUrl != coverFor) {
      coverFor = state.artworkUrl
      loadCover(app, state.artworkUrl)
    }
  }

  /** Redraws every widget and asks the tile to look again. */
  fun refresh(context: Context) {
    ResonusWidgetProvider.renderAll(context)
    runCatching {
      TileService.requestListeningState(
        context,
        ComponentName(context, ResonusTileService::class.java),
      )
    }
  }

  /** The cover in memory, or the one saved by the last process. */
  fun cover(context: Context): Bitmap? {
    cover?.let { return it }
    val file = File(context.filesDir, COVER_FILE)
    if (!file.exists()) return null
    return runCatching { BitmapFactory.decodeFile(file.path) }.getOrNull()?.also { cover = it }
  }

  private fun loadCover(context: Context, url: String?) {
    loader.execute {
      val bitmap = url?.let { runCatching { rounded(fetch(context, it)) }.getOrNull() }
      // A newer song asked for another one while this was loading.
      if (coverFor != url) return@execute
      cover = bitmap
      val file = File(context.filesDir, COVER_FILE)
      if (bitmap == null) {
        file.delete()
      } else {
        runCatching { file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
      }
      refresh(context)
    }
  }

  private fun fetch(context: Context, url: String): Bitmap? {
    val uri = Uri.parse(url)
    val bytes = when (uri.scheme) {
      "http", "https" -> {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        try {
          if (conn.responseCode != 200) return null
          conn.inputStream.use(InputStream::readBytes)
        } finally {
          conn.disconnect()
        }
      }
      "file" -> File(requireNotNull(uri.path)).readBytes()
      "content" -> context.contentResolver.openInputStream(uri)?.use(InputStream::readBytes)
      else -> null
    } ?: return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= COVER_PX && bounds.outHeight / (sample * 2) >= COVER_PX) {
      sample *= 2
    }
    val decoded = BitmapFactory.decodeByteArray(
      bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample },
    ) ?: return null
    return Bitmap.createScaledBitmap(decoded, COVER_PX, COVER_PX, true)
  }

  /** RemoteViews cannot clip, so the corners are cut into the picture. */
  private fun rounded(source: Bitmap?): Bitmap? {
    source ?: return null
    val out = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }
    val radius = source.width * 0.12f
    Canvas(out).drawRoundRect(
      RectF(0f, 0f, source.width.toFloat(), source.height.toFloat()), radius, radius, paint,
    )
    return out
  }
}
