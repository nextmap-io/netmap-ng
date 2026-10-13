import { useMemo, useSyncExternalStore } from "react";
import { useTheme } from "@/hooks/useTheme";

export interface ChartColors {
  seriesA: string;
  seriesB: string;
  ink: string;
  grid: string;
  axis: string;
  zero: string;
  cursor: string;
  surface: string;
}

const TOKENS: Record<keyof ChartColors, string> = {
  seriesA: "--color-series-a",
  seriesB: "--color-series-b",
  ink: "--color-foreground",
  grid: "--color-border-soft",
  axis: "--color-muted-foreground",
  zero: "--color-foreground-secondary",
  cursor: "--color-border",
  surface: "--color-card",
};

// The theme lives as a class on <html> and can be changed by any component
// (e.g. the header toggle, whose useTheme state is separate from ours), so
// observe the class itself as well as our own resolvedTheme.
function subscribe(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
const themeClass = () => document.documentElement.className;
const serverClass = () => "";

/** `themeKey` only identifies the theme being read; it busts the memo. */
function readColors(themeKey: string): ChartColors {
  void themeKey;
  const style = getComputedStyle(document.documentElement);
  const out = {} as ChartColors;
  for (const [k, cssVar] of Object.entries(TOKENS) as Array<[keyof ChartColors, string]>) {
    out[k] = style.getPropertyValue(cssVar).trim() || "currentColor";
  }
  return out;
}

/** Chart colors read from the Ledger CSS tokens, re-read on theme change. */
export function useChartColors(): ChartColors {
  const { resolvedTheme } = useTheme();
  const cls = useSyncExternalStore(subscribe, themeClass, serverClass);
  const key = `${resolvedTheme}|${cls}`;
  return useMemo(() => readColors(key), [key]);
}
