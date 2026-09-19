package expo.modules.carmedia

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CarControllerTest {
  @Test fun androidAutoIsACar() {
    assertTrue(CarController.isCarPackage("com.google.android.projection.gearhead", hasMediaContentControl = false))
  }

  @Test fun aSystemMediaUiWithMediaContentControlIsACar() {
    assertTrue(CarController.isCarPackage("com.android.car.media", hasMediaContentControl = true))
  }

  @Test fun ourOwnNotificationIsNot() {
    assertFalse(CarController.isCarPackage("com.umairnawaz.quran", hasMediaContentControl = false))
  }

  @Test fun aHeadsetOrOtherAppIsNot() {
    assertFalse(CarController.isCarPackage("com.android.bluetooth", hasMediaContentControl = false))
  }
}
