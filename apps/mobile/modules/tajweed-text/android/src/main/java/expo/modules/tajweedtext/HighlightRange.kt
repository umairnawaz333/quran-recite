package expo.modules.tajweedtext

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * The recited word's character range. Drawn as a `BackgroundColorSpan` and
 * ONLY that — never a text-colour change — so the tajweed colours
 * underneath stay visible while a word is playing.
 */
class HighlightRange : Record {
  @Field
  val start: Int = 0

  @Field
  val end: Int = 0
}
