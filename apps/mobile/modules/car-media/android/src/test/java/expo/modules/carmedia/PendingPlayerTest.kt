package expo.modules.carmedia

import android.os.Handler
import android.os.Looper
import android.os.Message
import androidx.media3.common.Player
import expo.modules.audio.service.PendingPlayer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.Mockito.mock
import org.mockito.Mockito.mockConstruction
import org.mockito.Mockito.mockStatic
import org.mockito.Mockito.`when`

/**
 * The stand-in player a car is looking at during a cold bind. It lives in the
 * patched expo-audio, which has no test source set of its own, so its one piece
 * of real behaviour — what a boot timeout looks like to the head unit — is
 * pinned from here (car-media already depends on `:expo-audio`).
 *
 * `SimpleBasePlayer` checks every call against its application thread, so the
 * Looper it is given has to be the one `Looper.myLooper()` answers with.
 */
class PendingPlayerTest {
  /**
   * Everything `SimpleBasePlayer` needs from the platform, faked just enough:
   * a Looper that is also the current thread's (media3 checks every call
   * against it) and a Handler whose messages are not android.jar's `null`
   * (media3's `ListenerSet` posts one whenever the state changes).
   */
  private fun <T> onTheApplicationThread(body: (PendingPlayer) -> T): T {
    val looper = mock(Looper::class.java)
    `when`(looper.thread).thenReturn(Thread.currentThread())
    mockStatic(Looper::class.java).use { statics ->
      statics.`when`<Looper> { Looper.myLooper() }.thenReturn(looper)
      mockConstruction(Handler::class.java) { handler, _ ->
        `when`(handler.looper).thenReturn(looper)
        `when`(handler.obtainMessage(anyInt())).thenReturn(mock(Message::class.java))
      }.use {
        return body(PendingPlayer(looper))
      }
    }
  }

  @Test fun aColdBindSpinsUntilSomethingHappens() = onTheApplicationThread { player ->
    player.playWhenReady = true
    assertEquals(Player.STATE_BUFFERING, player.playbackState)
    assertNull(player.playerError)
  }

  @Test fun aBootTimeoutIsAVisibleErrorAndNotASpinner() = onTheApplicationThread { player ->
    player.playWhenReady = true

    player.reportError("Open Quran on your phone")

    assertEquals(Player.STATE_IDLE, player.playbackState)
    assertFalse(player.playWhenReady)
    assertNotNull(player.playerError)
    assertEquals("Open Quran on your phone", player.playerError?.message)
  }

  @Test fun pressingPlayAgainClearsTheLastFailure() = onTheApplicationThread { player ->
    player.reportError("Open Quran on your phone")

    player.playWhenReady = true

    assertEquals(Player.STATE_BUFFERING, player.playbackState)
    assertNull(player.playerError)
  }
}
