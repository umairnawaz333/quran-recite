import { describe, it, expect } from 'vitest';
import { colourFor } from '../src/reader/tajweedColours';

/**
 * `colourFor` must match what the web actually renders: the web injects the
 * tajweed markup verbatim via `dangerouslySetInnerHTML`, so for a nested pair
 * ordinary CSS cascade applies and an element's own `color` beats inheritance
 * from an ancestor — the INNERMOST coloured rule wins, not the outermost one.
 *
 * These are the four nested combinations that actually occur in the data
 * (measured across all 114 surahs). Three look like "outer wins" only
 * because their inner rule, `custom-alef-maksora`, has no colour of its own.
 * `madda_obligatory_monfasel > slnt` is the one case where both rules are
 * coloured, and it is the case this test exists to pin: it renders grey
 * (`slnt`, the inner rule), not orange (`madda_obligatory_monfasel`, the
 * outer rule).
 */
describe('colourFor', () => {
  it('returns the outer colour when the inner rule is uncoloured (madda_normal > custom-alef-maksora)', () => {
    expect(colourFor(['madda_normal', 'custom-alef-maksora'])).toBe('#1d4ed8');
  });

  it('returns the outer colour when the inner rule is uncoloured (madda_obligatory_mottasel > custom-alef-maksora)', () => {
    expect(colourFor(['madda_obligatory_mottasel', 'custom-alef-maksora'])).toBe('#b45309');
  });

  it('returns the outer colour when the inner rule is uncoloured (madda_permissible > custom-alef-maksora)', () => {
    expect(colourFor(['madda_permissible', 'custom-alef-maksora'])).toBe('#b45309');
  });

  it('returns the INNER colour when both rules are coloured (madda_obligatory_monfasel > slnt)', () => {
    expect(colourFor(['madda_obligatory_monfasel', 'slnt'])).toBe('#6b7280');
  });

  it('returns the single rule colour for an unnested run', () => {
    expect(colourFor(['qalaqah'])).toBe('#a30006');
  });

  it('returns undefined for an empty rule stack', () => {
    expect(colourFor([])).toBeUndefined();
  });
});
