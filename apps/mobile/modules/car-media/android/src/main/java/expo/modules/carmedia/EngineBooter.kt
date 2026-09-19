package expo.modules.carmedia

/**
 * Commands arrive from the session on whatever thread; the JS engine may not
 * exist yet (cold start from the car). Boot it once, queue until `engineReady`,
 * keep only the newest play request, and give up with the spec §7 message.
 */
class EngineBooter(
  private val boot: () -> Unit,
  private val deliver: (type: String, arg: Long?) -> Unit,
  private val error: (String) -> Unit,
  private val clock: () -> Long = { System.currentTimeMillis() },
  private val timeoutMs: Long = 10_000,
) {
  private var ready = false
  private var booting = false
  private var bootStartedAt = 0L
  private val queue = ArrayDeque<Pair<String, Long?>>()

  /** True between `boot()` and the engine arriving (or timing out) — the tick loop's stop condition. */
  val isBooting: Boolean
    @Synchronized get() = booting

  @Synchronized fun command(type: String, arg: Long?) {
    if (ready) { deliver(type, arg); return }
    if (type == "playSurah") queue.removeAll { it.first == "playSurah" }
    queue.addLast(type to arg)
    if (!booting) { booting = true; bootStartedAt = clock(); boot() }
  }

  @Synchronized fun engineReady() {
    ready = true; booting = false
    val pending = queue.toList(); queue.clear()
    pending.forEach { deliver(it.first, it.second) }
  }

  @Synchronized fun engineGone() { ready = false; booting = false; queue.clear() }

  /** Called periodically (the service posts it every second while booting). */
  @Synchronized fun tick() {
    if (booting && clock() - bootStartedAt > timeoutMs) {
      booting = false; queue.clear(); error("Open Quran on your phone")
    }
  }
}
