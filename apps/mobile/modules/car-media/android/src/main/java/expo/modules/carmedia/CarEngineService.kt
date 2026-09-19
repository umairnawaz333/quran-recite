package expo.modules.carmedia

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Foreground first, then the headless task — the car can start us with no Activity. */
class CarEngineService : HeadlessJsTaskService() {
  private val main = Handler(Looper.getMainLooper())

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Reusing expo-audio's channel id keeps this out of Settings as a second
    // channel. The card itself is a separate notification (expo-audio owns its
    // own id), so it is removed again as soon as the engine is ready — see
    // dismissBootNotification below.
    val channelId = "expo_audio_channel"
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(channelId) == null) {
      nm.createNotificationChannel(NotificationChannel(channelId, channelId, NotificationManager.IMPORTANCE_LOW))
    }
    val builder = if (Build.VERSION.SDK_INT >= 26) {
      Notification.Builder(this, channelId)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 } ?: android.R.drawable.ic_media_play
    val n = builder.setSmallIcon(icon).setContentTitle("Quran").setContentText("Starting…").build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, n)
    }
    // Once JS reports in, expo-audio's media notification is what the car should
    // see. Drop ours and stay in the background; the headless task keeps running.
    CarMediaProvider.instance?.dismissBootNotification = {
      main.post { stopForeground(STOP_FOREGROUND_REMOVE) }
    }
    return super.onStartCommand(intent, flags, startId)
  }

  override fun onDestroy() {
    CarMediaProvider.instance?.dismissBootNotification = null
    super.onDestroy()
  }

  // timeout 0 = no timeout in RN 0.86 (HeadlessJsTaskConfig kdoc: "A value of 0
  // means no timeout (should only be used for long-running tasks such as music
  // playback)"), so the JS engine lives as long as playback does.
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig("QuranCarEngine", Arguments.createMap(), 0, true)

  private companion object {
    const val NOTIFICATION_ID = 4243
  }
}
