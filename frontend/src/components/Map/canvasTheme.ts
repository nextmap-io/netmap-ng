import { useSyncExternalStore } from "react";

/**
 * Theme key for anything on the canvas that draws *resolved* colors (edges,
 * legend swatches, minimap, background dots). It is the <html> class list, so
 * it changes whenever any component switches the theme (header toggle, OS
 * scheme flip) — not only the instance of useTheme() in this component.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const getSnapshot = () => document.documentElement.className;
const getServerSnapshot = () => "";

export function useThemeKey(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export interface CanvasColors {
  /** Background grid dots (normal / snap-to-grid). */
  dots: string;
  dotsStrong: string;
  /** Minimap fills: network nodes, groups. */
  node: string;
  group: string;
  /** Minimap mask over the area outside the viewport. */
  mask: string;
}

let cachedKey: string | null = null;
let cachedColors: CanvasColors | null = null;

function cssVar(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

/**
 * Canvas chrome colors read from the theme tokens. `themeKey` (from
 * useThemeKey) keys the cache, so callers memoize on it and re-render on a
 * theme change.
 */
export function canvasColors(themeKey: string): CanvasColors {
  if (cachedColors && cachedKey === themeKey) return cachedColors;
  const style = getComputedStyle(document.documentElement);
  const background = cssVar(style, "--color-background");
  const colors: CanvasColors = {
    dots: cssVar(style, "--color-border-soft"),
    dotsStrong: cssVar(style, "--color-border"),
    node: cssVar(style, "--color-muted-foreground"),
    group: cssVar(style, "--color-border"),
    // Tokens are #rrggbb: append an alpha byte (~75%).
    mask: /^#[0-9a-f]{6}$/i.test(background) ? `${background}bf` : background,
  };
  cachedKey = themeKey;
  cachedColors = colors;
  return colors;
}
