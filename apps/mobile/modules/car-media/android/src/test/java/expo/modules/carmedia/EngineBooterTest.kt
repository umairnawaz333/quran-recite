package expo.modules.carmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineBooterTest {
  private val delivered = mutableListOf<Pair<String, Long?>>()
  private var boots = 0
  private var errors = mutableListOf<String>()
  private var now = 0L
  /** Stands in for CarMediaProvider's jsSink: false = the JS runtime is gone. */
  private var sinkPresent = true
  private val booter = EngineBooter(
    boot = { boots++ },
    deliver = { t, a -> if (sinkPresent) { delivered += t to a; true } else false },
    error = { errors += it },
    clock = { now })

  @Test fun deliversDirectlyWhenTheEngineIsUp() {
    booter.engineReady()
    booter.command("playSurah", 5)
    assertEquals(listOf("playSurah" to 5L), delivered); assertEquals(0, boots)
  }

  @Test fun bootsOnceAndQueuesUntilReady() {
    booter.command("playSurah", 5); booter.command("nextSurah", null)
    assertEquals(1, boots); assertTrue(delivered.isEmpty())
    booter.engineReady()
    assertEquals(listOf("playSurah" to 5L, "nextSurah" to null), delivered)
  }

  @Test fun onlyTheLatestPlayRequestSurvivesTheQueue() {
    booter.command("playSurah", 5); booter.command("playSurah", 7)
    booter.engineReady()
    assertEquals(listOf("playSurah" to 7L), delivered)
  }

  @Test fun timesOutWithTheOpenQuranMessage() {
    booter.command("playSurah", 5)
    now = 10_001; booter.tick()
    assertEquals(listOf("Open Quran on your phone"), errors); assertTrue(delivered.isEmpty())
    booter.engineReady()                                  // late ready: nothing stale is delivered
    assertTrue(delivered.isEmpty())
  }

  @Test fun engineGoingAwayRequiresANewBoot() {
    booter.engineReady(); booter.engineGone()
    booter.command("resume", null)
    assertEquals(1, boots)
  }

  /**
   * The service's tick loop runs while `isBooting`; a boot that never reports in
   * must still stay booting across intermediate ticks so the timeout can land.
   */
  @Test fun keepsBootingAcrossTicksUntilTheTimeoutLands() {
    booter.command("playSurah", 5)
    now = 1_000; booter.tick()
    now = 4_000; booter.tick()
    now = 9_999; booter.tick()
    assertTrue(booter.isBooting); assertTrue(errors.isEmpty())
    now = 10_001; booter.tick()
    assertEquals(listOf("Open Quran on your phone"), errors)
    assertFalse(booter.isBooting)                          // and now the loop may stop
  }

  @Test fun aVanishedEngineIsTreatedAsGoneAndTheCommandSurvivesTheReboot() {
    booter.engineReady()
    sinkPresent = false                                    // JS died without an OnDestroy
    booter.command("playSurah", 9)
    assertTrue(delivered.isEmpty())
    assertEquals(1, boots); assertTrue(booter.isBooting)
    sinkPresent = true
    booter.engineReady()
    assertEquals(listOf("playSurah" to 9L), delivered)
  }
}
