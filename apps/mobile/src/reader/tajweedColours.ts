/**
 * Colours for the 19 tajweed rule classes present in the data, copied from
 * the web app's stylesheet so both platforms render the same rule the same
 * colour. The web's palette is the source of truth; if it changes, change it
 * there first and mirror it here.
 *
 * `custom-alef-maksora` is deliberately absent: it is a glyph substitution,
 * not a colour. The web renders this markup verbatim via
 * `dangerouslySetInnerHTML`, so for a nested pair ordinary CSS cascade
 * applies: an element's own `color` beats inheritance from an ancestor, which
 * means the INNERMOST coloured rule is what actually renders. That happens to
 * look like "outer wins" for three of the four real nested combinations only
 * because their inner rule (`custom-alef-maksora`) has no colour of its own —
 * it is not a rule about outer rules taking precedence. See `colourFor`.
 */
export const RULE_COLOURS: Record<string, string> = {
  madda_necessary: '#9b1c1c',
  madda_obligatory_mottasel: '#b45309',
  madda_obligatory_monfasel: '#b45309',
  madda_permissible: '#b45309',
  madda_normal: '#1d4ed8',
  qalaqah: '#a30006',
  ikhafa: '#6b21a8',
  ikhafa_shafawi: '#6b21a8',
  idgham_ghunnah: '#0f6b00',
  ghunnah: '#0f6b00',
  iqlab: '#0369a1',
  ham_wasl: '#6b7280',
  slnt: '#6b7280',
  laam_shamsiyah: '#6b7280',
  idgham_wo_ghunnah: '#6b7280',
  idgham_shafawi: '#6b7280',
  idgham_mutajanisayn: '#6b7280',
  idgham_mutaqaribayn: '#6b7280',
};

/**
 * The colour for a run, given its rule stack (outermost-first, as
 * `parseTajweed` returns it).
 *
 * Innermost-first, because that is what CSS does: an element's own `color`
 * beats inheritance from an ancestor, so for a nested pair where both rules
 * are coloured the inner one is what the web actually renders. Outermost
 * still wins whenever the inner rule is presentational and uncoloured, which
 * is the common case (`custom-alef-maksora`).
 */
export function colourFor(rules: string[]): string | undefined {
  for (let i = rules.length - 1; i >= 0; i--) {
    const colour = RULE_COLOURS[rules[i]];
    if (colour) return colour;
  }
  return undefined;
}
