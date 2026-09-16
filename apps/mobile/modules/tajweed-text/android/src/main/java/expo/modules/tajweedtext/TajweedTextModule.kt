package expo.modules.tajweedtext

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TajweedTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TajweedText")

    View(TajweedTextView::class) {
      Name("TajweedTextView")

      Prop("text") { view: TajweedTextView, value: String -> view.text = value }
      Prop("ranges") { view: TajweedTextView, value: List<ColorRange> -> view.ranges = value }
      Prop("highlight") { view: TajweedTextView, value: HighlightRange? -> view.highlight = value }
      Prop("fontFamily") { view: TajweedTextView, value: String -> view.fontFamily = value }
      Prop("fontSize") { view: TajweedTextView, value: Float -> view.fontSize = value }
      Prop("lineHeight") { view: TajweedTextView, value: Float -> view.lineHeightDp = value }
      Prop("color") { view: TajweedTextView, value: String -> view.textColor = value }

      // Rebuild the SpannableString once per prop-update batch, not once per
      // individual prop — see `TajweedTextView.render()`.
      OnViewDidUpdateProps { view: TajweedTextView -> view.render() }
    }
  }
}
