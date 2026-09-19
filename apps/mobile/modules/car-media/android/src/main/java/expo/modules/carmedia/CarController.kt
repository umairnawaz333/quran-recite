package expo.modules.carmedia

import android.content.Context
import androidx.media3.session.MediaSession

/** Spec §5.3: who pressed decides what "next" means. Pure function + one Android adapter. */
object CarController {
  const val ANDROID_AUTO = "com.google.android.projection.gearhead"

  /**
   * An allowlist, not a capability test. Holding MEDIA_CONTENT_CONTROL does not
   * make a controller a car — `com.android.systemui` holds it, and so do the
   * Assistant and other system media surfaces, so treating the permission as
   * the rule turned the phone's own lock-screen/notification "next" into a
   * whole-surah skip. Every other controller means an ayah (spec §2/§5.3).
   */
  private val CAR_PACKAGES = setOf(
    ANDROID_AUTO,
    // AAOS's built-in media UI.
    "com.android.car.media",
  )

  /** Car App Library hosts on Automotive OS ship under this namespace. */
  private const val AUTOMOTIVE_HOST_PREFIX = "com.google.android.apps.automotive."

  fun isCarPackage(packageName: String, ownPackageName: String): Boolean {
    // Our own notification/lock-screen controller is never a car, whatever it
    // is called — an automotive build of this app controls itself too.
    if (packageName == ownPackageName) return false
    return packageName in CAR_PACKAGES || packageName.startsWith(AUTOMOTIVE_HOST_PREFIX)
  }

  fun isCar(context: Context, controller: MediaSession.ControllerInfo): Boolean =
    isCarPackage(controller.packageName, context.packageName)
}
