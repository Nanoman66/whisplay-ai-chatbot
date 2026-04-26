export interface FooterLegendSpec {
  single?: string;
  double?: string;
  long?: string;
}

export const FOOTER_LEGEND_COLOR = "#ff5555";

const SINGLE_GLYPH = "+";
const DOUBLE_GLYPH = "++";
const LONG_GLYPH = "_ =";
const SEGMENT_GAP = "  ";

function normalizeLabel(label?: string): string | null {
  const value = (label || "").trim();
  return value ? value : null;
}

export function buildFooterLegend(spec: FooterLegendSpec): string {
  const parts: string[] = [];

  const single = normalizeLabel(spec.single);
  const double = normalizeLabel(spec.double);
  const long = normalizeLabel(spec.long);

  if (single) {
    parts.push(`${SINGLE_GLYPH} ${single}`);
  }

  if (double) {
    parts.push(`${DOUBLE_GLYPH} ${double}`);
  }

  if (long) {
    parts.push(`${LONG_GLYPH} ${long}`);
  }

  return parts.join(SEGMENT_GAP);
}