package expo.modules.applocale

import android.app.LocaleManager
import android.content.Context
import android.os.Build
import android.os.LocaleList
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The language Android keeps for this app (Settings > Apps > Resonus >
 * Language), from Android 13. Older versions have no such setting, and these
 * answer as if nothing was chosen.
 */
class AppLocaleModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  private val manager: LocaleManager?
    get() = if (Build.VERSION.SDK_INT >= 33) context.getSystemService(LocaleManager::class.java) else null

  override fun definition() = ModuleDefinition {
    Name("AppLocale")

    /** The chosen language as a BCP 47 tag, or null for "system default". */
    Function("get") {
      val locales = runCatching { manager?.applicationLocales }.getOrNull()
      if (locales == null || locales.isEmpty) null else locales[0].toLanguageTag()
    }

    Function("set") { tag: String ->
      runCatching { manager?.applicationLocales = LocaleList.forLanguageTags(tag) }.isSuccess
    }
  }
}
