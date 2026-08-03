package expo.modules.audioeq

import android.content.Context
import android.media.AudioManager
import android.media.audiofx.Equalizer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The system equaliser (android.media.audiofx.Equalizer) over the app's audio.
 * Android's framework does the processing; all that happens here is creating
 * the effect and handing it the gains.
 *
 * One effect per audio SESSION: the player alternates between two ExoPlayers
 * for the crossfade, so two sessions are alive at once and both have to be
 * equalised the same. The state, meaning whether it is on and what the gains
 * are, lives here and is applied to every session that attaches, including the
 * ones that turn up later when a player is recreated.
 */
class AudioEqModule : Module() {
  /** Effect by session id. They only exist while the equaliser is on. */
  private val effects = mutableMapOf<Int, Equalizer>()
  /**
   * The player's live sessions, with an effect on them or not.
   *
   * Kept apart because an attached effect is not free even when it is bypassed:
   * while one is there, Android takes that session off the path that offloads
   * to the DSP and mixes it on the CPU instead. Everyone was paying for that,
   * and the equaliser ships off, so almost nobody was getting anything back.
   */
  private val sessions = linkedSetOf<Int>()
  private var enabled = false

  /** Gain per band in millibels; null means not set up yet, so flat. */
  private var levels: ShortArray? = null

  /** Pours the current state onto one effect. */
  private fun applyTo(eq: Equalizer) {
    runCatching {
      levels?.forEachIndexed { i, mb ->
        if (i < eq.numberOfBands) eq.setBandLevel(i.toShort(), mb)
      }
      eq.enabled = enabled
    }
  }

  private fun applyAll() = effects.values.forEach(::applyTo)

  /** Creates a session's effect, unless it already had one. */
  private fun openEffect(sessionId: Int) {
    if (sessionId == 0 || effects.containsKey(sessionId)) return
    runCatching {
      val eq = Equalizer(0, sessionId)
      effects[sessionId] = eq
      applyTo(eq)
    }
  }

  /** Releases every effect; the sessions stay on the books. */
  private fun closeEffects() {
    effects.values.forEach { runCatching { it.release() } }
    effects.clear()
  }

  /**
   * A loose effect on a made-up session, for asking the device about things that
   * are the device's own (its bands, ranges and presets) and not any one piece
   * of playback. It works with the equaliser off too, which is exactly when
   * there is no live effect to ask.
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

  /** The real gains off the first effect, for after a preset is applied. */
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
     * What the device's equaliser can do: its bands, their frequencies, the gain
     * range and the presets. Asked through a temporary effect on a spare
     * session, since the answers belong to the device and not to anything
     * playing.
     */
    Function("getInfo") {
      withScratchEffect { eq ->
        val range = eq.bandLevelRange // [min, max] in millibels
        mapOf(
          "supported" to true,
          "bands" to (0 until eq.numberOfBands.toInt()).map { i ->
            mapOf(
              "index" to i,
              // getCenterFreq answers in millihertz.
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
     * Takes note of a player session, called as each player is created. The
     * effect is only created if the equaliser is on; turning it on later
     * attaches it to whatever is playing then.
     */
    Function("attach") { sessionId: Int ->
      if (sessionId == 0) return@Function
      sessions.add(sessionId)
      if (enabled) openEffect(sessionId)
    }

    /** Lets a session go, as its player is destroyed. */
    Function("detach") { sessionId: Int ->
      sessions.remove(sessionId)
      effects.remove(sessionId)?.let { runCatching { it.release() } }
    }

    Function("setEnabled") { on: Boolean ->
      enabled = on
      if (on) sessions.forEach(::openEffect) else closeEffects()
      applyAll()
    }

    /** Sets every gain (in millibels), as when restoring what was saved. */
    Function("setBandLevels") { millibels: List<Int> ->
      levels = ShortArray(millibels.size) { millibels[it].toShort() }
      applyAll()
    }

    /** Sets one band, which is a slider being moved. */
    Function("setBandLevel") { band: Int, millibels: Int ->
      val cur = levels
      if (cur != null && band < cur.size) {
        cur[band] = millibels.toShort()
      }
      effects.values.forEach { eq ->
        runCatching { eq.setBandLevel(band.toShort(), millibels.toShort()) }
      }
    }

    /** Applies one of the device's presets and answers with the gains it left. */
    Function("usePreset") { preset: Int ->
      effects.values.forEach { eq -> runCatching { eq.usePreset(preset.toShort()) } }
      // With it off there is no effect to ask how it turned out, but a preset's
      // gains belong to the device, so a loose effect's answer is as good.
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

    /** The gains as they are now, in millibels. */
    Function("getBandLevels") { readLevels() }
  }
}
