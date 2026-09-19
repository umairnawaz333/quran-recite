package expo.modules.carmedia

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import expo.modules.audio.service.CarLibraryRegistry

/** Runs at process start, before any controller can bind — no JS needed. */
class CarMediaInitProvider : ContentProvider() {
  override fun onCreate(): Boolean {
    val ctx = context ?: return false
    val provider = CarMediaProvider(ctx.applicationContext)
    CarMediaProvider.instance = provider
    CarLibraryRegistry.provider = provider
    return true
  }

  override fun query(u: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? = null
  override fun getType(u: Uri): String? = null
  override fun insert(u: Uri, v: ContentValues?): Uri? = null
  override fun delete(u: Uri, s: String?, a: Array<String>?) = 0
  override fun update(u: Uri, v: ContentValues?, s: String?, a: Array<String>?) = 0
}
