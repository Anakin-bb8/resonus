package expo.modules.audioeq

import android.content.Context
import android.media.AudioManager
import android.media.audiofx.Equalizer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Ecualizador del sistema (android.media.audiofx.Equalizer) aplicado al audio
 * de la app. El procesado lo hace el framework de Android; aquí solo creamos el
 * efecto y le pasamos las ganancias.
 *
 * Un efecto por SESIÓN de audio: el reproductor usa dos ExoPlayer alternos (para
 * el crossfade), así que hay dos sesiones vivas y ambas deben ecualizarse igual.
 * El estado (activado + ganancias) vive aquí y se aplica a toda sesión que se
 * enganche, incluidas las que aparezcan después (al recrearse un player).
 */
class AudioEqModule : Module() {
  /** Efecto por id de sesión. Solo existen mientras el ecualizador está puesto. */
  private val effects = mutableMapOf<Int, Equalizer>()
  /**
   * Sesiones vivas del reproductor, tengan efecto o no.
   *
   * Se guardan aparte porque un efecto enganchado no es gratis aunque esté en
   * bypass: mientras hay uno, Android saca a esa sesión del camino de descarga
   * al DSP y la mezcla por CPU. Eso lo pagaba todo el mundo, y el ecualizador
   * viene apagado de fábrica, así que casi nadie lo estaba usando para nada.
   */
  private val sessions = linkedSetOf<Int>()
  private var enabled = false

  /** Ganancia por banda en milibelios; null = aún sin configurar (plano). */
  private var levels: ShortArray? = null

  /** Vuelca el estado actual sobre un efecto concreto. */
  private fun applyTo(eq: Equalizer) {
    runCatching {
      levels?.forEachIndexed { i, mb ->
        if (i < eq.numberOfBands) eq.setBandLevel(i.toShort(), mb)
      }
      eq.enabled = enabled
    }
  }

  private fun applyAll() = effects.values.forEach(::applyTo)

  /** Crea el efecto de una sesión, si no lo tenía ya. */
  private fun openEffect(sessionId: Int) {
    if (sessionId == 0 || effects.containsKey(sessionId)) return
    runCatching {
      val eq = Equalizer(0, sessionId)
      effects[sessionId] = eq
      applyTo(eq)
    }
  }

  /** Suelta todos los efectos; las sesiones siguen anotadas. */
  private fun closeEffects() {
    effects.values.forEach { runCatching { it.release() } }
    effects.clear()
  }

  /**
   * Un efecto suelto sobre una sesión inventada, para preguntarle al dispositivo
   * cosas que son suyas (bandas, rangos, presets) y no de una reproducción. Sirve
   * también con el ecualizador apagado, que es cuando no hay ningún efecto vivo.
   */
  private fun <T> withScratchEffect(block: (Equalizer) -> T): T? = runCatching {
    val am = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      ?: return@runCatching null
    val eq = Equalizer(0, am.generateAudioSessionId())
    try {
      block(eq)
    } finally {
      runCatching { eq.release() }
    }
  }.getOrNull()

  /** Lee las ganancias reales del primer efecto (tras aplicar un preset). */
  private fun readLevels(): List<Int> {
    val eq = effects.values.firstOrNull() ?: return levels?.map { it.toInt() } ?: emptyList()
    return runCatching {
      (0 until eq.numberOfBands.toInt()).map { eq.getBandLevel(it.toShort()).toInt() }
    }.getOrElse { levels?.map { it.toInt() } ?: emptyList() }
  }

  override fun definition() = ModuleDefinition {
    Name("AudioEq")

    OnDestroy {
      closeEffects()
      sessions.clear()
    }

    /**
     * Capacidades del ecualizador del dispositivo: bandas, frecuencias, rango de
     * ganancia y presets. Se consultan con un efecto temporal sobre una sesión
     * libre, porque son del dispositivo y no de una reproducción concreta.
     */
    Function("getInfo") {
      withScratchEffect { eq ->
        val range = eq.bandLevelRange // [min, max] en milibelios
        mapOf(
          "supported" to true,
          "bands" to (0 until eq.numberOfBands.toInt()).map { i ->
            mapOf(
              "index" to i,
              // getCenterFreq viene en miliherzios.
              "centerFreq" to eq.getCenterFreq(i.toShort()) / 1000,
            )
          },
          "minLevel" to range[0].toInt(),
          "maxLevel" to range[1].toInt(),
          "presets" to (0 until eq.numberOfPresets.toInt()).map { eq.getPresetName(it.toShort()) },
        )
      } ?: mapOf("supported" to false)
    }

    /**
     * Anota una sesión del reproductor (se llama al crear cada player). El
     * efecto solo se crea si el ecualizador está puesto; si se enciende después,
     * se engancha a lo que haya sonando en ese momento.
     */
    Function("attach") { sessionId: Int ->
      if (sessionId == 0) return@Function
      sessions.add(sessionId)
      if (enabled) openEffect(sessionId)
    }

    /** Suelta la sesión (al destruir un player). */
    Function("detach") { sessionId: Int ->
      sessions.remove(sessionId)
      effects.remove(sessionId)?.let { runCatching { it.release() } }
    }

    Function("setEnabled") { on: Boolean ->
      enabled = on
      if (on) sessions.forEach(::openEffect) else closeEffects()
      applyAll()
    }

    /** Fija todas las ganancias (milibelios), p. ej. al restaurar lo guardado. */
    Function("setBandLevels") { millibels: List<Int> ->
      levels = ShortArray(millibels.size) { millibels[it].toShort() }
      applyAll()
    }

    /** Fija una banda (al mover un slider). */
    Function("setBandLevel") { band: Int, millibels: Int ->
      val cur = levels
      if (cur != null && band < cur.size) {
        cur[band] = millibels.toShort()
      }
      effects.values.forEach { eq ->
        runCatching { eq.setBandLevel(band.toShort(), millibels.toShort()) }
      }
    }

    /** Aplica un preset del dispositivo y devuelve las ganancias resultantes. */
    Function("usePreset") { preset: Int ->
      effects.values.forEach { eq -> runCatching { eq.usePreset(preset.toShort()) } }
      // Apagado no hay ningún efecto al que preguntarle cómo quedó, pero las
      // ganancias de un preset son del dispositivo: valen las de uno suelto.
      val next = if (effects.isNotEmpty()) {
        readLevels()
      } else {
        withScratchEffect { eq ->
          eq.usePreset(preset.toShort())
          (0 until eq.numberOfBands.toInt()).map { eq.getBandLevel(it.toShort()).toInt() }
        } ?: readLevels()
      }
      levels = ShortArray(next.size) { next[it].toShort() }
      next
    }

    /** Ganancias actuales (milibelios). */
    Function("getBandLevels") { readLevels() }
  }
}
