package expo.modules.radioart

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.net.URL
import org.json.JSONObject

/**
 * The radio icon, drawn once and written to disk: the seed's colour as the
 * background, up to three covers as overlapping circles (seed on top) and
 * the artist's name at the bottom — the shape Spotify gives its radios.
 *
 * One JSON payload in, the file's uri back, so the JS side stays in charge
 * of what goes in it (see `src/lib/radioArt.ts`). The body runs on the
 * module's async queue: three cover downloads and a 512 px render off the
 * JS thread.
 */
class RadioArtModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RadioArt")

    AsyncFunction("generate") { payload: String, promise: Promise ->
      try {
        promise.resolve(generate(payload))
      } catch (e: Exception) {
        promise.reject("E_RADIO_ART", e.message ?: "radio art failed", e)
      }
    }
  }

  private fun generate(payload: String): String {
    val opts = JSONObject(payload)
    val outPath = opts.optString("outPath")
    if (outPath.isEmpty()) throw IllegalArgumentException("no outPath")
    val background = parseHex(opts.optString("backgroundColor")) ?: Color.DKGRAY
    val ink = parseHex(opts.optString("textColor")) ?: Color.WHITE
    val title = opts.optString("title")
    val images = opts.optJSONArray("images")

    // The covers, none of them fatal: one that fails or never arrives leaves
    // its circle as the shaded background colour.
    val urls = mutableListOf<String>()
    if (images != null) {
      for (i in 0 until minOf(3, images.length())) urls.add(images.getString(i))
    }
    val covers = urls.map { url -> runCatching { download(url) }.getOrNull() }

    val side = 512
    val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(background)

    // Sides first, the seed's own cover above them: the order the card's
    // live collage paints in, so the file and the views are one picture.
    val sideR = side * 0.20f
    val centerR = side * 0.30f
    drawCircle(canvas, side * 0.10f, side * 0.54f, sideR, covers.getOrNull(1), background)
    drawCircle(canvas, side * 0.90f, side * 0.54f, sideR, covers.getOrNull(2), background)
    drawCircle(canvas, side * 0.50f, side * 0.46f, centerR, covers.getOrNull(0), background)

    // 0.1 em ≈ the 2.5 pt kern the iOS renderer draws with at this size.
    drawLabel(canvas, "RADIO", side - 28f, 30f, 26f, 0.1f, ink, side - 56f)
    drawTitle(canvas, title, side.toFloat(), ink)

    val path = outPath.removePrefix("file://")
    val file = File(path)
    file.parentFile?.mkdirs()
    FileOutputStream(file).use { out ->
      if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) {
        throw IllegalStateException("png encode failed")
      }
    }
    return outPath
  }

  private fun download(url: String): Bitmap {
    val conn = URL(url).openConnection()
    conn.connectTimeout = 8000
    conn.readTimeout = 8000
    conn.getInputStream().use { stream ->
      return BitmapFactory.decodeStream(stream) ?: throw IllegalStateException("no bitmap")
    }
  }

  /** One circle: the picture aspect-filled inside the clip, or the shaded
   *  background where there is no picture to put there. */
  private fun drawCircle(
    canvas: Canvas,
    cx: Float,
    cy: Float,
    r: Float,
    cover: Bitmap?,
    background: Int,
  ) {
    canvas.save()
    val path = Path().apply { addOval(RectF(cx - r, cy - r, cx + r, cy + r), Path.Direction.CW) }
    canvas.clipPath(path)
    if (cover != null && cover.width > 0 && cover.height > 0) {
      val scale = maxOf((r * 2) / cover.width, (r * 2) / cover.height)
      val dw = cover.width * scale
      val dh = cover.height * scale
      canvas.drawBitmap(
        cover,
        null,
        RectF(cx - dw / 2, cy - dh / 2, cx + dw / 2, cy + dh / 2),
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
      )
    } else {
      canvas.drawRect(cx - r, cy - r, cx + r, cy + r, Paint().apply { color = shade(background) })
    }
    canvas.restore()
  }

  private fun drawLabel(
    canvas: Canvas,
    text: String,
    rightOrX: Float,
    top: Float,
    textSize: Float,
    kernEm: Float,
    ink: Int,
    maxWidth: Float,
  ) {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = ink
      textSize = textSize
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      letterSpacing = kernEm
      setShadowLayer(3f, 0f, 1f, shadowOf(ink))
    }
    val w = paint.measureText(text)
    canvas.drawText(text, rightOrX - w, top - paint.ascent(), paint)
  }

  /** The artist's name, up to two lines, shrinking until it fits: a name is
   *  whatever length it is, and the icon has fixed edges to stay inside. */
  private fun drawTitle(canvas: Canvas, title: String, side: Float, ink: Int) {
    if (title.isEmpty()) return
    val maxWidth = (side - 56).toInt()
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = ink
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      letterSpacing = -0.02f
      setShadowLayer(3f, 0f, 1f, shadowOf(ink))
    }
    var size = 64f
    var layout = layoutFor(title, paint, maxWidth, size)
    while ((layout.lineCount > 2 || layout.height > size * 2.3f) && size > 34f) {
      size -= 4f
      layout = layoutFor(title, paint, maxWidth, size)
    }
    canvas.save()
    canvas.translate(28f, side - 28f - layout.height)
    layout.draw(canvas)
    canvas.restore()
  }

  private fun layoutFor(title: String, paint: TextPaint, maxWidth: Int, size: Float): StaticLayout {
    paint.textSize = size
    return StaticLayout.Builder.obtain(title, 0, title.length, paint, maxWidth)
      .setAlignment(Layout.Alignment.ALIGN_NORMAL)
      .setLineSpacing(0f, 1f)
      .setMaxLines(2)
      .setEllipsize(null)
      .build()
  }

  /** The name sits over covers nobody chose: a shadow opposite to the ink, so
   *  it reads on whichever of them is bright. */
  private fun shadowOf(ink: Int): Int {
    val light = (Color.red(ink) + Color.green(ink) + Color.blue(ink)) / 3
    return if (light > 127) Color.BLACK else Color.WHITE
  }

  private fun shade(color: Int): Int {
    return Color.rgb(
      (Color.red(color) * 0.8f).toInt(),
      (Color.green(color) * 0.8f).toInt(),
      (Color.blue(color) * 0.8f).toInt(),
    )
  }

  private fun parseHex(value: String): Int? {
    var hex = value.trim()
    if (hex.startsWith("#")) hex = hex.substring(1)
    if (hex.length != 6) return null
    return try {
      (0xFF shl 24) or hex.toLong(16).toInt()
    } catch (e: NumberFormatException) {
      null
    }
  }
}
