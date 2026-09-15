/**
 * Parse Quran.com's tajweed markup into flat text runs, each carrying the
 * stack of rules that applies to it.
 *
 * The markup is narrow and its exact shape was measured across all 114
 * surahs rather than assumed: `rule` is the only tag, the class attribute is
 * never quoted, and rules nest to a maximum depth of two (1,405 words do,
 * e.g. `madda_normal` wrapping `custom-alef-maksora`). A flat tokeniser that
 * ignored nesting would mis-render every one of those words, which is why
 * each run carries a stack rather than a single rule.
 *
 * Runs are returned outermost-rule-first so a renderer can decide precedence
 * itself — the outer rule is the tajweed colour, while the inner ones seen in
 * this corpus (`custom-alef-maksora`, `slnt`) are presentational.
 */

export interface TajweedRun {
  text: string;
  /** Outermost first. Empty when the run carries no rule. */
  rules: string[];
}

const TOKEN = /<rule class=([A-Za-z_-]+)>|<\/rule>/g;

export function parseTajweed(markup: string): TajweedRun[] {
  const runs: TajweedRun[] = [];
  const stack: string[] = [];
  let cursor = 0;

  const push = (text: string) => {
    // Empty runs carry no information and would force every consumer to
    // filter them.
    if (text.length > 0) runs.push({ text, rules: [...stack] });
  };

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(markup)) !== null) {
    push(markup.slice(cursor, match.index));
    if (match[1] !== undefined) stack.push(match[1]);
    else stack.pop();
    cursor = match.index + match[0].length;
  }

  // Trailing text after the last tag — and, for unclosed markup, text still
  // inside an open rule. Keeping it is deliberate: dropping it would silently
  // lose Quran text if the upstream markup were ever malformed.
  push(markup.slice(cursor));

  return runs;
}
