import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system" | "scada";

/** The concrete theme actually painted (never "system"). */
export type ResolvedTheme = "light" | "dark" | "scada";

const THEME_BG: Record<ResolvedTheme, string> = {
  light: "#f5f6f7",
  dark: "#191c20",
  scada: "#0b0d0c",
};

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function readStoredTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark" || t === "system" || t === "scada") return t;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === "system") return darkQuery().matches ? "dark" : "light";
  return theme;
}

/*
  One theme state for the whole app. Every useTheme() caller subscribes to the
  same store, so switching the theme from the header re-renders the map,
  legend and charts, whose colors are resolved from CSS variables.
  public/theme-init.js applies the class before the first paint; this keeps it
  in sync afterwards.
*/
let state: { theme: Theme; resolved: ResolvedTheme } = (() => {
  const theme = readStoredTheme();
  return { theme, resolved: resolve(theme) };
})();
const listeners = new Set<() => void>();

function apply(resolved: ResolvedTheme) {
  const el = document.documentElement;
  el.classList.remove("dark", "light", "scada");
  el.classList.add(resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_BG[resolved]);
}

function update(theme: Theme) {
  const resolved = resolve(theme);
  if (theme === state.theme && resolved === state.resolved) return;
  state = { theme, resolved };
  apply(resolved);
  listeners.forEach((l) => l());
}

let mediaBound = false;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!mediaBound) {
    mediaBound = true;
    apply(state.resolved);
    darkQuery().addEventListener("change", () => update(state.theme));
  }
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;

const ORDER: Theme[] = ["system", "dark", "light", "scada"];

export function useTheme() {
  const { theme, resolved } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* storage unavailable: still switch for this session */
    }
    update(t);
  }, []);

  const cycle = useCallback(() => {
    setTheme(ORDER[(ORDER.indexOf(state.theme) + 1) % ORDER.length]);
  }, [setTheme]);

  return { theme, setTheme, cycle, resolvedTheme: resolved };
}
