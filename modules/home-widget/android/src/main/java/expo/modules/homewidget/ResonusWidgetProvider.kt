package expo.modules.homewidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** The "Now playing" home screen widget. JS pushes, this only draws. */
class ResonusWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    render(context, manager, ids)
  }

  companion object {
    fun renderAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, ResonusWidgetProvider::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val state = NowPlaying.read(context)
      val views = RemoteViews(context.packageName, R.layout.hw_widget)
      val open = openApp(context)
      if (state.active && state.title.isNotEmpty()) {
        views.setTextViewText(R.id.hw_title, state.title)
        views.setTextViewText(R.id.hw_artist, state.artist)
      } else {
        views.setTextViewText(R.id.hw_title, context.applicationInfo.loadLabel(context.packageManager))
        views.setTextViewText(R.id.hw_artist, context.getString(R.string.widget_idle))
      }
      val cover = if (state.active) NowPlaying.cover(context) else null
      if (cover != null) {
        views.setImageViewBitmap(R.id.hw_cover, cover)
      } else {
        views.setImageViewResource(R.id.hw_cover, R.drawable.hw_ic_note)
      }
      views.setImageViewResource(
        R.id.hw_play_pause,
        if (state.playing) R.drawable.hw_ic_pause else R.drawable.hw_ic_play,
      )
      views.setOnClickPendingIntent(R.id.hw_root, open)
      views.setOnClickPendingIntent(R.id.hw_cover, open)
      // Buttons only do something with a queue loaded in this process; before
      // that they open the app, which is where a queue gets loaded.
      val controls = state.active && NowPlaying.live
      views.setOnClickPendingIntent(
        R.id.hw_previous,
        if (controls) action(context, WidgetActionReceiver.PREVIOUS) else open,
      )
      views.setOnClickPendingIntent(
        R.id.hw_play_pause,
        if (controls) action(context, WidgetActionReceiver.PLAY_PAUSE) else open,
      )
      views.setOnClickPendingIntent(
        R.id.hw_next,
        if (controls) action(context, WidgetActionReceiver.NEXT) else open,
      )
      manager.updateAppWidget(ids, views)
    }

    fun openApp(context: Context): PendingIntent {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent()
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
      return PendingIntent.getActivity(
        context,
        0,
        launch,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun action(context: Context, name: String): PendingIntent {
      val intent = Intent(context, WidgetActionReceiver::class.java).setAction(name)
      return PendingIntent.getBroadcast(
        context,
        name.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
