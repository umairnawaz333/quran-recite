package expo.modules.carmedia

/**
 * Commands arrive from the session on whatever thread; the JS engine may not
 * exist yet (cold start from the car). Boot it once, queue until `engineReady`,
 * keep only the newest play request, and give up with the spec §7 message.
 *
 * A command is never dropped: if a delivery finds no JS engine on the other end
 * (the runtime died without an OnDestroy) the booter treats the engine as gone
 * and re-queues the command behind a fresh boot.
 */
class EngineBooter(
  private val boot: () -> Unit,
  /** Hands the command to JS. Returns false when there is no engine to hand it to. */
  private val deliver: (type: String, arg: Long?) -> Boolean,
  private val error: (String) -> Unit,
  private val clock: () -> Long = { System.currentTimeMillis() },
  private val timeoutMs: Long = 10_000,
) {
  private var ready = false
  private var booting = false
  private var bootStartedAt = 0L
  private val queue = ArrayDeque<Pair<String, Long?>>()

  /**
   * True between `boot()` and the engine arriving (or timing out). The service's
   * tick loop runs exactly as long as this does — it must not stop earlier, or
   * the timeout never fires and a failed boot wedges silently.
   */
  val isBooting: Boolean
    @Synchronized get() = booting

  @Synchronized fun command(type: String, arg: Long?) {
    if (ready) {
      if (deliver(type, arg)) return
      reset()   // JS vanished without telling us; the command still has to land.
    }
    enqueue(type, arg)
  }

  @Synchronized fun engineReady() {
    ready = true
    booting = false
    val pending = queue.toList()
    queue.clear()
    for (i in pending.indices) {
      if (deliver(pending[i].first, pending[i].second)) continue
      // The engine went away mid-flush: everything still undelivered goes back
      // in the queue behind a new boot.
      reset()
      for (j in i until pending.size) enqueue(pending[j].first, pending[j].second)
      return
    }
  }

  @Synchronized fun engineGone() {
    reset()
  }

  /** Called periodically (the service posts it every second while booting). */
  @Synchronized fun tick() {
    if (booting && clock() - bootStartedAt > timeoutMs) {
      booting = false
      queue.clear()
      error("Open Quran on your phone")
    }
  }

  private fun reset() {
    ready = false
    booting = false
    queue.clear()
  }

  private fun enqueue(type: String, arg: Long?) {
    if (type == "playSurah") queue.removeAll { it.first == "playSurah" }
    queue.addLast(type to arg)
    if (!booting) {
      booting = true
      bootStartedAt = clock()
      boot()
    }
  }
}
