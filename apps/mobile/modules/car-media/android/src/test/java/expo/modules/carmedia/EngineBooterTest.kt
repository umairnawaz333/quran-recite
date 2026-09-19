package expo.modules.carmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineBooterTest {
  private val delivered = mutableListOf<Pair<String, Long?>>()
  private var boots = 0
  private var errors = mutableListOf<String>()
  private var now = 0L
  private val booter = EngineBooter(
    boot = { boots++ }, deliver = { t, a -> delivered += t to a }, error = { errors += it }, clock = { now })

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
}
