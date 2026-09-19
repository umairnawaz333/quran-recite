package expo.modules.carmedia

import android.content.Context
import android.content.pm.PackageManager
import androidx.media3.session.MediaSession

/** Spec §5.3: who pressed decides what "next" means. Pure function + one Android adapter. */
object CarController {
  const val ANDROID_AUTO = "com.google.android.projection.gearhead"

  fun isCarPackage(packageName: String, hasMediaContentControl: Boolean): Boolean =
    packageName == ANDROID_AUTO ||
      (hasMediaContentControl && packageName != "android" && !packageName.startsWith("com.android.bluetooth"))

  fun isCar(context: Context, controller: MediaSession.ControllerInfo): Boolean {
    val pkg = controller.packageName
    if (pkg == context.packageName) return false
    val granted = context.packageManager
      .checkPermission("android.permission.MEDIA_CONTENT_CONTROL", pkg) == PackageManager.PERMISSION_GRANTED
    return isCarPackage(pkg, granted)
  }
}
