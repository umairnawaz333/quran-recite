package expo.modules.carmedia

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.util.Log
import expo.modules.audio.service.CarLibraryRegistry

/** Runs at process start, before any controller can bind — no JS needed. */
class CarMediaInitProvider : ContentProvider() {
  override fun onCreate(): Boolean {
    val ctx = context ?: return false
    // Building the provider reads and parses the bundled library asset. A
    // ContentProvider's onCreate runs on EVERY app start, before anything
    // else, so an unreadable or malformed asset thrown from here would kill
    // the app outright — phone and all — over a feature only a car uses.
    // Registering nothing instead leaves `CarLibraryRegistry.provider` null,
    // which is exactly the pre-car behaviour: the session works as before and
    // browsing degrades to ERROR_BAD_VALUE.
    try {
      val provider = CarMediaProvider(ctx.applicationContext)
      CarMediaProvider.instance = provider
      CarLibraryRegistry.provider = provider
      // The boot card belongs to the service that put it up; it comes down
      // when the session is holding the app's real player, never earlier.
      CarLibraryRegistry.onRealPlayerAttached = { provider.dismissBootNotification?.invoke() }
    } catch (e: Throwable) {
      Log.e("CarMedia", "Car library unavailable; car browsing is disabled", e)
    }
    return true
  }

  override fun query(u: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? = null
  override fun getType(u: Uri): String? = null
  override fun insert(u: Uri, v: ContentValues?): Uri? = null
  override fun delete(u: Uri, s: String?, a: Array<String>?) = 0
  override fun update(u: Uri, v: ContentValues?, s: String?, a: Array<String>?) = 0
}
