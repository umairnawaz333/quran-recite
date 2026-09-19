package expo.modules.carmedia

import androidx.media3.common.C
import expo.modules.audio.service.CarLibraryRegistry
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JS face of the car session: commands out, position/errors in. */
class CarMediaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CarMedia")
    Events("onCommand")

    OnCreate {
      CarMediaProvider.instance?.jsSink = { type, arg ->
        sendEvent("onCommand", mapOf("type" to type, "arg" to arg))
      }
    }

    OnDestroy {
      // engineGone() first: while `ready` is still true a command would take the
      // deliver path, and a null sink would swallow it.
      CarMediaProvider.instance?.let { it.booter.engineGone(); it.jsSink = null }
      CarLibraryRegistry.positionOffsetMs = 0
      CarLibraryRegistry.durationOverrideMs = C.TIME_UNSET
    }

    Function("engineReady") { CarMediaProvider.instance?.engineReady() }

    Function("setPosition") { offsetMs: Double, durationMs: Double ->
      CarLibraryRegistry.positionOffsetMs = offsetMs.toLong()
      CarLibraryRegistry.durationOverrideMs = durationMs.toLong()
    }

    Function("clearPosition") {
      CarLibraryRegistry.positionOffsetMs = 0
      CarLibraryRegistry.durationOverrideMs = C.TIME_UNSET
    }

    Function("setError") { message: String -> CarLibraryRegistry.errorSink?.invoke(message) }
  }
}
