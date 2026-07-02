import { useState, useEffect, useCallback } from "react";

export type Theme = "light" | "dark" | "system" | "scada";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const el = document.documentElement;
  el.classList.remove("dark", "light", "scada");
  if (theme === "scada") {
    el.classList.add("scada");
  } else {
    const resolved = theme === "system" ? getSystemTheme() : theme;
    el.classList.add(resolved);
  }
}

/** The concrete theme actually painted (never "system"). */
export type ResolvedTheme = "light" | "dark" | "scada";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) || "system";
  });
  // Track the OS scheme in state so consumers re-render when it flips while
  // theme === "system" (canvas/minimap colors depend on it).
  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemTheme() === "dark");

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem("theme", t);
    setThemeState(t);
    applyTheme(t);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      setSystemDark(mq.matches);
      if (theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const cycle = useCallback(() => {
    const order: Theme[] = ["system", "dark", "light", "scada"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  }, [theme, setTheme]);

  const resolvedTheme: ResolvedTheme =
    theme === "scada" ? "scada" : theme === "system" ? (systemDark ? "dark" : "light") : theme;

  return { theme, setTheme, cycle, resolvedTheme };
}
