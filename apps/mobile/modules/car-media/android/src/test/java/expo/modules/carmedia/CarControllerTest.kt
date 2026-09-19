package expo.modules.carmedia

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CarControllerTest {
  private val own = "com.umairnawaz.quran"

  @Test fun androidAutoIsACar() {
    assertTrue(CarController.isCarPackage("com.google.android.projection.gearhead", own))
  }

  @Test fun theBuiltInCarMediaUiIsACar() {
    assertTrue(CarController.isCarPackage("com.android.car.media", own))
  }

  @Test fun anAutomotiveTemplateHostIsACar() {
    assertTrue(CarController.isCarPackage("com.google.android.apps.automotive.templates.host", own))
  }

  // The phone's own system UI holds MEDIA_CONTENT_CONTROL, so the permission
  // heuristic this replaced made the lock screen's "next" skip a whole surah.
  @Test fun theSystemUiIsNotACar() {
    assertFalse(CarController.isCarPackage("com.android.systemui", own))
  }

  @Test fun theAssistantIsNotACar() {
    assertFalse(CarController.isCarPackage("com.google.android.googlequicksearchbox", own))
  }

  @Test fun ourOwnNotificationIsNot() {
    assertFalse(CarController.isCarPackage(own, own))
    // The self-exclusion for real: a package that WOULD be a car host is still
    // not one when it is us (a car build of this app controlling itself).
    assertFalse(CarController.isCarPackage(CarController.ANDROID_AUTO, CarController.ANDROID_AUTO))
  }

  @Test fun aHeadsetOrOtherAppIsNot() {
    assertFalse(CarController.isCarPackage("com.android.bluetooth", own))
  }
}
