package expo.modules.carmedia

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Build
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.session.MediaSession
import expo.modules.audio.service.CarLibraryProvider
import expo.modules.audio.service.CarLibraryRegistry

/** The CarLibraryProvider expo-audio calls; owns the library and the booter. */
class CarMediaProvider(private val context: Context) : CarLibraryProvider {
  private val library = CarLibrary.parse(
    context.assets.open("car-library.json").bufferedReader().use { it.readText() },
    Uri.parse("android.resource://${context.packageName}/drawable/car_artwork"),
  )
  private val handler = Handler(Looper.getMainLooper())

  /** Set by CarMediaModule while JS is up; null when the JS runtime is gone. */
  @Volatile var jsSink: ((String, Long?) -> Unit)? = null

  val booter = EngineBooter(
    boot = {
      val intent = Intent(context, CarEngineService::class.java)
      // minSdk is 24; startForegroundService only exists from 26. Below that a
      // plain startService is allowed from the background anyway.
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      scheduleTick()
    },
    deliver = { t, a -> jsSink?.invoke(t, a) },
    error = { msg -> CarLibraryRegistry.errorSink?.invoke(msg) },
  )

  /** Drives the boot timeout; stops as soon as JS arrives or the booter gives up. */
  private fun scheduleTick() {
    handler.postDelayed({ booter.tick(); if (jsSink == null && booter.isBooting) scheduleTick() }, 1000)
  }

  override fun isCarController(controller: MediaSession.ControllerInfo): Boolean =
    CarController.isCar(context, controller)

  override fun root(): MediaItem = library.root()

  override fun children(parentId: String): List<MediaItem>? = library.children(parentId)

  override fun item(mediaId: String): MediaItem? = library.item(mediaId)

  override fun search(query: String): List<MediaItem> = library.search(query)

  override fun onCommand(type: String, arg: Long?) = booter.command(type, arg)

  override fun artwork(): Bitmap? = BitmapFactory.decodeResource(context.resources, R.drawable.car_artwork)

  companion object {
    @Volatile var instance: CarMediaProvider? = null
  }
}
