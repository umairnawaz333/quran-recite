package expo.modules.tajweedtext

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.util.Log
import android.util.TypedValue
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.View.MeasureSpec
import androidx.appcompat.widget.AppCompatTextView
import androidx.core.widget.TextViewCompat
import com.facebook.react.common.assets.ReactFontManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

private const val TAG = "TajweedTextView"

// The bundled asset fallback for Risk 1 (font resolution) — see
// `resolveTypeface` below. Shipped inside this module's own
// android/src/main/assets/fonts/, so it is always present in the APK
// regardless of what expo-font has or hasn't registered yet.
private const val FALLBACK_FONT_ASSET = "fonts/amiri-quran.ttf"

/**
 * The Android equivalent of iOS's single `NSAttributedString` pass.
 *
 * RN's own `<Text>` renders tajweed colour by nesting one `<Text>` per
 * coloured run. On Android that fragments cursive Arabic at every colour
 * boundary, because RN sets a `MetricAffectingSpan` (`ReactAbsoluteSizeSpan`
 * for size, `CustomStyleSpan` for `fontFamily`) on every fragment, and a
 * `MetricAffectingSpan` boundary is a shaping-run boundary — regardless of
 * nesting depth. `ReactForegroundColorSpan` (colour) is a non-metric
 * `CharacterStyle` and was never the problem.
 *
 * This view sidesteps RN's per-fragment spans entirely: one
 * `AppCompatTextView`, one typeface, one text size, set ONCE below — never
 * per range — with tajweed colour and the playback highlight applied as
 * `ForegroundColorSpan`/`BackgroundColorSpan` over character ranges of ONE
 * `SpannableString`. Both are non-metric `CharacterStyle`s, so Android shapes
 * the whole string as a single run, exactly like `NSAttributedString` does.
 *
 * LOAD-BEARING CONSTRAINT, do not undo this later: only `ForegroundColorSpan`
 * and `BackgroundColorSpan` may ever be applied per-range here. Any per-range
 * `AbsoluteSizeSpan`/`CustomStyleSpan`-style span (size, font, weight, letter
 * spacing) is a `MetricAffectingSpan` and reintroduces the exact shaping-run
 * boundary this class exists to remove.
 */
class TajweedTextView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  private val textView = AppCompatTextView(context).apply {
    // Arabic-only content — force RTL rather than leaving bidi ordering and
    // cursive joining to a per-device Unicode heuristic. `gravity = START`
    // combined with an RTL `layoutDirection` puts text at the right edge,
    // matching `ReaderScreen`'s `textAlign: 'right'` for the RN `<Text>`
    // path on iOS.
    textDirection = View.TEXT_DIRECTION_RTL
    layoutDirection = View.LAYOUT_DIRECTION_RTL
    gravity = Gravity.START or Gravity.TOP
    // Room for ink that overhangs the line box. Android breaks lines by
    // glyph ADVANCE, but the Quran faces draw well outside it — a final
    // alif's tail, a madd, a stacked mark — and the parent clips to its
    // bounds, so the last word of a line lost its outer edge ("وَمِمَّا"
    // in 2:3 showed as "وَمِمَّ"). The inset keeps the overhang inside the
    // view; the text is laid out `2 × pad` narrower and wraps a touch
    // earlier, which is the correct trade. 20 dp: Amiri's final letters
    // (the meem of "ثُمَّ", a final alif's tail) draw up to a glyph's width
    // behind the pen position, and 8 dp still lost most of "ثُمَّ" in 2:29.
    val pad = (20 * context.resources.displayMetrics.density).toInt()
    setPadding(pad, 0, pad, 0)
    includeFontPadding = true
  }

  var text: String = ""
  var ranges: List<ColorRange> = emptyList()
  var highlight: HighlightRange? = null
  var fontFamily: String = ""
  var fontSize: Float = 17f
  /** In dp, same unit as `fontSize` — converted to px below. */
  var lineHeightDp: Float = 0f
  var textColor: String = "#000000"

  private val onCharacterPress by EventDispatcher()
  private val onHighlightLayout by EventDispatcher()

  // A single tap reports the character under the finger. The web lets the
  // user start recitation from any word by clicking it; here the words are
  // one string inside one native view, so the view reports the character
  // offset and JS — which built the string and knows where each word
  // starts and ends — resolves it to a word. `getOffsetForPosition` works
  // off the laid-out `Layout`, so it is correct for wrapped and RTL lines.
  private val tapDetector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(e: MotionEvent): Boolean = true
    override fun onSingleTapUp(e: MotionEvent): Boolean {
      if (textView.layout == null) return false
      val offset = textView.getOffsetForPosition(e.x, e.y)
      onCharacterPress(mapOf("offset" to offset))
      return true
    }
  })

  override fun onTouchEvent(event: MotionEvent): Boolean {
    return tapDetector.onTouchEvent(event) || super.onTouchEvent(event)
  }

  init {
    addView(textView)
    // Draw, do not clip, ink that spills past this view's edge. Android
    // breaks lines by glyph advance, and Amiri's final letters draw behind
    // the pen position; the inset above covers the usual overhang, and
    // whatever exceeds it now renders into the row's own margin instead of
    // being cut off — the tail of a final ى at a line end, say. Layout and
    // wrapping are untouched; this is purely about what gets painted.
    clipChildren = false
    clipToPadding = false
    textView.clipToOutline = false
  }

  /**
   * Rebuilds the `SpannableString` from the current props and re-measures.
   * Called once per prop-update batch (see `OnViewDidUpdateProps` in
   * `TajweedTextModule.kt`), not once per individual prop, so a single JS
   * update never rebuilds/re-measures more than once.
   */
  fun render() {
    textView.typeface = resolveTypeface(fontFamily)
    // COMPLEX_UNIT_SP, not DP: this is what lets the view honour the
    // system/accessibility font-size setting, unlike a canvas-drawn
    // approach (see the task brief's reason for rejecting Skia).
    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize)
    textView.setTextColor(parseColorOr(textColor, Color.BLACK))
    if (lineHeightDp > 0f) {
      // Same unit as the text size above — SP, not DIP — so the line height
      // scales with the system/accessibility font-size setting exactly as
      // the glyphs do. RN's own `<Text>` scales both together under
      // `allowFontScaling`; converting only the size (as this once did) made
      // large font scales crowd and clip lines on this path alone.
      // TextViewCompat wants raw px, so convert explicitly.
      val lineHeightPx = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_SP,
        lineHeightDp,
        resources.displayMetrics,
      )
      TextViewCompat.setLineHeight(textView, lineHeightPx.roundToInt())
    }

    val spannable = SpannableString(text)
    val length = spannable.length
    for (range in ranges) {
      val start = range.start.coerceIn(0, length)
      val end = range.end.coerceIn(start, length)
      if (start == end) continue
      spannable.setSpan(
        ForegroundColorSpan(parseColorOr(range.color, Color.BLACK)),
        start,
        end,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
      )
    }
    highlight?.let { h ->
      val start = h.start.coerceIn(0, length)
      val end = h.end.coerceIn(start, length)
      if (start != end) {
        spannable.setSpan(
          BackgroundColorSpan(HIGHLIGHT_COLOR),
          start,
          end,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
      }
    }
    textView.text = spannable

    // Tell JS which laid-out line the highlight starts on, so the reader can
    // keep the recited line — not merely the ayah — in the middle of the
    // screen through a fifteen-line ayah. Posted, because the Layout does
    // not exist until this text has been measured and laid out.
    highlight?.let { h ->
      val start = h.start.coerceIn(0, length)
      textView.post {
        val layout = textView.layout ?: return@post
        val line = layout.getLineForOffset(start)
        val density = resources.displayMetrics.density
        onHighlightLayout(mapOf(
          "top" to layout.getLineTop(line) / density,
          "bottom" to layout.getLineBottom(line) / density,
        ))
      }
    }

    // Text just changed, but Yoga's box for this node did not (it has no
    // idea "text" is even a layout-affecting prop) — so Fabric will not call
    // measure()/layout() on its own here. Re-measure against our own current
    // width right away rather than waiting for a call that may not come; see
    // `onMeasure` for the case where a width isn't known yet.
    reportMeasuredSizeForWidth(width)
  }

  /**
   * Risk 2 (measurement). A custom Fabric host view reports no intrinsic
   * size on its own — Yoga has no measure function for it, so with no
   * explicit height it lays the row out at height 0 (collapsed). This is
   * Expo's shadow-node/measure path for self-sizing views (the same one
   * used by Expo's own auto-sizing Compose/SwiftUI hosts): measure the real
   * `AppCompatTextView` content for the width Yoga gave us, ignoring the
   * height it guessed, then push the real height back into the Fabric
   * shadow tree via `shadowNodeProxy.setViewSize`, which schedules a
   * synchronous ("Immediate") state update Yoga picks up for the next
   * layout pass.
   */
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val widthPx = MeasureSpec.getSize(widthMeasureSpec)
    val heightPx = measureContentHeight(widthPx)
    setMeasuredDimension(widthPx, heightPx)
    reportSize(widthPx, heightPx)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    textView.layout(0, 0, r - l, b - t)
  }

  private fun reportMeasuredSizeForWidth(widthPx: Int) {
    if (widthPx <= 0) {
      // Not laid out yet — nothing to measure against. `onMeasure` will run
      // this same computation once Fabric gives this node a real width.
      return
    }
    reportSize(widthPx, measureContentHeight(widthPx))
  }

  private fun measureContentHeight(widthPx: Int): Int {
    textView.measure(
      MeasureSpec.makeMeasureSpec(widthPx, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED),
    )
    return textView.measuredHeight
  }

  private fun reportSize(widthPx: Int, heightPx: Int) {
    val density = resources.displayMetrics.density
    shadowNodeProxy.setViewSize(widthPx / density.toDouble(), heightPx / density.toDouble())
  }

  /**
   * Risk 1 (font resolution). `expo-font`'s `useFonts` registers each loaded
   * font with RN's own `ReactFontManager` under the exact family name it was
   * given — the same manager RN's `<Text>` already resolves fonts through
   * elsewhere in this app — so that is tried first. Only if that comes back
   * as a plain, unregistered system font (i.e. the family was never
   * registered, or registration hadn't finished) do we load the bundled
   * asset directly. See the task report for how the two were told apart at
   * runtime — `Typeface.equals` alone is not enough, since Android's default
   * system font is also what an unresolved family name silently returns.
   */
  private fun resolveTypeface(fontFamily: String): Typeface {
    val registered = try {
      ReactFontManager.getInstance().getTypeface(fontFamily, Typeface.NORMAL, context.assets)
    } catch (e: Exception) {
      null
    }
    val isFallback = registered == null || isSystemDefault(registered)
    if (!isFallback) {
      Log.i(TAG, "resolveTypeface($fontFamily): ReactFontManager match, typeface=$registered")
      return registered!!
    }
    Log.w(
      TAG,
      "resolveTypeface($fontFamily): ReactFontManager returned no real match " +
        "(got $registered) — loading $FALLBACK_FONT_ASSET from this module's assets instead",
    )
    return Typeface.createFromAsset(context.assets, FALLBACK_FONT_ASSET)
  }

  /**
   * `Typeface.create(unknownFamilyName, style)` — the path `ReactFontManager`
   * falls through to for a family it never registered — returns the
   * system default typeface rather than null or throwing. A reference check
   * against `Typeface.DEFAULT`/`Typeface.DEFAULT_BOLD` is how that silent
   * fallback is told apart from a genuinely resolved custom font.
   */
  private fun isSystemDefault(typeface: Typeface): Boolean =
    typeface == Typeface.DEFAULT || typeface == Typeface.DEFAULT_BOLD

  private fun parseColorOr(value: String, fallback: Int): Int =
    try {
      Color.parseColor(value)
    } catch (e: IllegalArgumentException) {
      fallback
    }

  companion object {
    // Matches the web's `.word--active` tint and `ReaderScreen.tsx`'s
    // `styles.highlight` — a background tint only, never a text-colour
    // change, so tajweed colours stay visible underneath it.
    private val HIGHLIGHT_COLOR = Color.parseColor("#fde68a")
  }
}
