/**
 * Optional DOM-only preview: extra "margin" insets (in) **inside the trim** on
 * calendar page cards. Binds to `--dom-preview-margin-*` (in).
 * The blue dashed guide = trim inner edge + those margins.
 *
 * Preview cards are sized to the full page **including bleed**. For layout that
 * always matches the blue guide, wrap main content in a `.calendar-content-frame`
 * with `buildDomPreviewContentFrameStyle` (inset = bleed + margin as % of the card).
 */

/** Default margin (in) for all four sides in calendar DOM previews. */
export const DEFAULT_DOM_PREVIEW_MARGIN_IN = 0.25;

export function buildDomPreviewMarginVars(
  marginTop,
  marginRight,
  marginBottom,
  marginLeft,
) {
  const t = Math.max(0, Number(marginTop) || 0);
  const r = Math.max(0, Number(marginRight) || 0);
  const b = Math.max(0, Number(marginBottom) || 0);
  const l = Math.max(0, Number(marginLeft) || 0);
  return {
    "--dom-preview-margin-top": `${t}in`,
    "--dom-preview-margin-right": `${r}in`,
    "--dom-preview-margin-bottom": `${b}in`,
    "--dom-preview-margin-left": `${l}in`,
  };
}

/**
 * Inches of bleed (trim → outer page edge) on the preview card, one var per side.
 * Card padding to match the blue margin guide = calendar-bleed + dom-preview-margin.
 */
export function buildCalendarBleedInsetVars(
  bleedTop,
  bleedRight,
  bleedBottom,
  bleedLeft,
) {
  const t = Math.max(0, Number(bleedTop) || 0);
  const r = Math.max(0, Number(bleedRight) || 0);
  const b = Math.max(0, Number(bleedBottom) || 0);
  const l = Math.max(0, Number(bleedLeft) || 0);
  return {
    "--calendar-bleed-top": `${t}in`,
    "--calendar-bleed-right": `${r}in`,
    "--calendar-bleed-bottom": `${b}in`,
    "--calendar-bleed-left": `${l}in`,
  };
}

/**
 * Insets (top/right/bottom/left) in % of the full preview card for the rectangle
 * from the outer (bleed) edge to the inner content edge: bleed + DOM margin.
 * Used for the live content frame so flow layout always matches the blue box.
 */
export function buildDomPreviewContentFrameStyle({
  pageWidth,
  pageHeight,
  bleedTop,
  bleedRight,
  bleedBottom,
  bleedLeft,
  marginTop,
  marginRight,
  marginBottom,
  marginLeft,
}) {
  const trimW = Math.max(0.01, Number(pageWidth) || 0.01);
  const trimH = Math.max(0.01, Number(pageHeight) || 0.01);
  const bT = Math.max(0, Number(bleedTop) || 0);
  const bR = Math.max(0, Number(bleedRight) || 0);
  const bB = Math.max(0, Number(bleedBottom) || 0);
  const bL = Math.max(0, Number(bleedLeft) || 0);
  const mT = Math.max(0, Number(marginTop) || 0);
  const mR = Math.max(0, Number(marginRight) || 0);
  const mB = Math.max(0, Number(marginBottom) || 0);
  const mL = Math.max(0, Number(marginLeft) || 0);
  const totalW = trimW + bL + bR;
  const totalH = trimH + bT + bB;
  return {
    top: `${((bT + mT) / totalH) * 100}%`,
    right: `${((bR + mR) / totalW) * 100}%`,
    bottom: `${((bB + mB) / totalH) * 100}%`,
    left: `${((bL + mL) / totalW) * 100}%`,
  };
}

/**
 * Insets for a standalone blue dashed box (no children). Returns `null` when all
 * DOM margin inputs are zero (no blue line). Prefer wrapping content in
 * `.calendar-content-frame` with {@link buildDomPreviewContentFrameStyle} instead.
 */
export function buildDomPreviewMarginGuideStyle({
  pageWidth,
  pageHeight,
  bleedTop,
  bleedRight,
  bleedBottom,
  bleedLeft,
  marginTop,
  marginRight,
  marginBottom,
  marginLeft,
}) {
  const mT = Math.max(0, Number(marginTop) || 0);
  const mR = Math.max(0, Number(marginRight) || 0);
  const mB = Math.max(0, Number(marginBottom) || 0);
  const mL = Math.max(0, Number(marginLeft) || 0);
  if (mT + mR + mB + mL === 0) {
    return null;
  }
  return buildDomPreviewContentFrameStyle({
    pageWidth,
    pageHeight,
    bleedTop,
    bleedRight,
    bleedBottom,
    bleedLeft,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
  });
}
