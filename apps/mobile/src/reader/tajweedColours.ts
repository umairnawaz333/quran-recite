/**
 * Colours for the 19 tajweed rule classes present in the data, copied from
 * the web app's stylesheet so both platforms render the same rule the same
 * colour. The web's palette is the source of truth; if it changes, change it
 * there first and mirror it here.
 *
 * `custom-alef-maksora` is deliberately absent: it is a glyph substitution,
 * not a colour, and it only ever appears as the INNER rule of a nested pair,
 * so the outer rule supplies the colour. That is why a run's rule stack is
 * ordered outermost-first.
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
 * The colour for a run, given its rule stack. The outermost rule that has a
 * colour wins; a run whose only rule is presentational inherits none.
 */
export function colourFor(rules: string[]): string | undefined {
  for (const rule of rules) {
    const colour = RULE_COLOURS[rule];
    if (colour) return colour;
  }
  return undefined;
}
