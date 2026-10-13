import type { ScaleBand } from "@/types";

/** Color used when the scale is empty/malformed and nothing can be resolved. */
const NO_DATA_COLOR = "#8c949e";

/**
 * Theme tokens a scale band (or any map color) may use instead of a hex value.
 * They resolve against the active theme, so one stored scale reads correctly
 * in light, dark and SCADA.
 */
export const COLOR_TOKENS: Record<string, { cssVar: string; label: string }> = {
  "@quiet": { cssVar: "--color-scale-quiet", label: "Quiet" },
  "@load": { cssVar: "--color-scale-load", label: "Load" },
  "@watch": { cssVar: "--color-warning-mark", label: "Watch" },
  "@incident": { cssVar: "--color-destructive", label: "Incident" },
  "@muted": { cssVar: "--color-muted-foreground", label: "Muted" },
  "@ink": { cssVar: "--color-foreground", label: "Ink" },
  "@accent": { cssVar: "--color-link", label: "Accent" },
};

export const isColorToken = (color: string): boolean => color.startsWith("@");

let cachedThemeKey = "";
const tokenCache = new Map<string, string>();

/**
 * Resolve a scale color: hex values pass through, "@tokens" are read from the
 * CSS variables of the current theme (cached until the <html> class changes).
 * Callers that render colors must re-render when the theme changes.
 */
export function resolveColor(color: string): string {
  if (!isColorToken(color)) return color;
  if (typeof document === "undefined") return NO_DATA_COLOR;
  const themeKey = document.documentElement.className;
  if (themeKey !== cachedThemeKey) {
    tokenCache.clear();
    cachedThemeKey = themeKey;
  }
  let value = tokenCache.get(color);
  if (value === undefined) {
    const token = COLOR_TOKENS[color];
    value = token
      ? getComputedStyle(document.documentElement).getPropertyValue(token.cssVar).trim() || NO_DATA_COLOR
      : NO_DATA_COLOR;
    tokenCache.set(color, value);
  }
  return value;
}

/** Parse a CSS hex color (#rgb / #rrggbb) to [r, g, b]; non-hex falls back to grey. */
function parseColor(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return [128, 128, 128];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")
  );
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = parseColor(c1);
  const [r2, g2, b2] = parseColor(c2);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export type Severity = "normal" | "watch" | "incident";

/**
 * How abnormal a utilization is. Uses the band's status token when the scale
 * has them (@watch / @incident); scales with only custom colors fall back to
 * the Ledger thresholds (70% watch, 90% incident).
 */
export function utilizationSeverity(pct: number, scales: ScaleBand[]): Severity {
  const bands = scales.filter((b) => b.max > b.min).sort((a, b) => a.min - b.min);
  if (bands.some((b) => isColorToken(b.color))) {
    const band = bands.find((b, i) => pct >= b.min && (pct < b.max || (i === bands.length - 1 && pct <= b.max)))
      ?? (pct >= (bands[bands.length - 1]?.max ?? 100) ? bands[bands.length - 1] : undefined);
    if (band?.color === "@incident") return "incident";
    if (band?.color === "@watch") return "watch";
    return "normal";
  }
  if (pct >= 90) return "incident";
  if (pct >= 70) return "watch";
  return "normal";
}

/**
 * Map a utilization percentage (0-100) to a scale color.
 *
 * Zero-width bands (min === max, e.g. the default "0%" #c0c0c0 marker) are
 * excluded from color selection: they are legend markers, not colorable ranges.
 * Excluding them means a low-but-active link whose utilization rounds down to
 * 0.0% is colored by the first real band (blue) instead of washing out to the
 * grey "0%" marker — the "everything is grey on low-bandwidth links" regression.
 *
 * Shared by MapView (private) and PublicMapView so both views color identically.
 */
export function getScaleColor(pct: number, scales: ScaleBand[], gradient = false): string {
  const bands = scales
    .filter((b) => b.max > b.min)
    .sort((a, b) => a.min - b.min)
    .map((b) => ({ ...b, color: resolveColor(b.color) }));
  if (bands.length === 0) return NO_DATA_COLOR;

  if (!gradient) {
    // Steps mode: half-open [min, max); final band inclusive so 100% still matches.
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      const isLast = i === bands.length - 1;
      if (pct >= band.min && (pct < band.max || (isLast && pct <= band.max))) {
        return band.color;
      }
    }
    // Out of range: clamp to the nearest end rather than returning the grey fallback.
    return pct < bands[0].min ? bands[0].color : bands[bands.length - 1].color;
  }

  // Gradient mode: interpolate between adjacent band colors.
  if (pct <= bands[0].min) return bands[0].color;
  if (pct >= bands[bands.length - 1].max) return bands[bands.length - 1].color;
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    if (pct >= band.min && pct <= band.max) {
      const next = bands[i + 1];
      if (next && band.max === next.min) {
        const t = band.max > band.min ? (pct - band.min) / (band.max - band.min) : 0;
        return lerpColor(band.color, next.color, t);
      }
      if (i > 0) {
        const prev = bands[i - 1];
        const fullRange = band.max - prev.min;
        const t = fullRange > 0 ? (pct - prev.min) / fullRange : 0;
        return lerpColor(prev.color, band.color, t);
      }
      return band.color;
    }
  }
  return NO_DATA_COLOR;
}
