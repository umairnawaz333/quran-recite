package expo.modules.tajweedtext

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * One tajweed colour span, as a character range of the ayah's single
 * concatenated string (see `TajweedLine.tsx`, the only place these are
 * built — offsets are character indices, never word indices).
 */
class ColorRange : Record {
  @Field
  val start: Int = 0

  @Field
  val end: Int = 0

  @Field
  val color: String = "#000000"
}
