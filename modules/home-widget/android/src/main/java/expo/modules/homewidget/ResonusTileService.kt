package expo.modules.homewidget

import android.annotation.SuppressLint
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.view.KeyEvent

/**
 * Quick Settings tile: play and pause, with the song as its subtitle. Declared
 * as an active tile, so the system only asks it to redraw when
 * `NowPlaying.refresh` says something changed.
 */
class ResonusTileService : TileService() {
  override fun onStartListening() {
    render()
  }

  override fun onClick() {
    val state = NowPlaying.read(this)
    if (state.active && NowPlaying.live) {
      WidgetActionReceiver.sendMediaKey(this, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
      return
    }
    openApp()
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  private fun openApp() {
    val pending = ResonusWidgetProvider.openApp(this)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(
        requireNotNull(packageManager.getLaunchIntentForPackage(packageName))
          .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }

  private fun render() {
    val tile = qsTile ?: return
    val state = NowPlaying.read(this)
    tile.state = if (state.playing) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    if (Build.VERSION.SDK_INT >= 29) {
      tile.subtitle = if (state.active && state.title.isNotEmpty()) state.title else null
    }
    tile.updateTile()
  }
}
