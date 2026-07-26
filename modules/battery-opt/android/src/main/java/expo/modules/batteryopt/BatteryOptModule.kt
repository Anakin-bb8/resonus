package expo.modules.batteryopt

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Estado de la optimización de batería de Android para esta app.
 *
 * Con la optimización activa (que es lo normal, y lo que el sistema restaura
 * solo tras un tiempo sin usar la app) Android puede matar el servicio de
 * reproducción en segundo plano, cortar la descarga o retrasar el temporizador.
 * Desde JS no hay forma de consultarlo, de ahí este módulo.
 *
 * Solo consulta y abre ajustes: NO pide la exención directamente
 * (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`), porque eso exige el permiso
 * `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, que Google Play restringe. Llevar al
 * usuario a la pantalla del sistema no necesita permiso alguno.
 */
class BatteryOptModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("BatteryOpt")

    /**
     * ¿Está la app exenta de la optimización de batería? `true` = exenta (sin
     * restricciones). En caso de duda devuelve `true`: es preferible no avisar
     * a avisar en falso.
     */
    Function("isIgnoringOptimizations") {
      runCatching {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        pm.isIgnoringBatteryOptimizations(context.packageName)
      }.getOrDefault(true)
    }

    /**
     * Abre la lista del sistema de optimización de batería. Si el dispositivo
     * no la trae (fabricantes que la quitan), cae en la pantalla de detalles de
     * la app, desde donde también se llega. Devuelve si algo se pudo abrir.
     */
    Function("openSettings") {
      val screens = listOf(
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
        Intent(
          Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          Uri.fromParts("package", context.packageName, null),
        ),
      )
      screens.any { intent ->
        runCatching {
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(intent)
        }.isSuccess
      }
    }
  }
}
