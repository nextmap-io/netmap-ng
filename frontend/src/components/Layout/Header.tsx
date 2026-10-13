import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMapStore } from "@/hooks/useMapStore";
import { useTheme, type Theme } from "@/hooks/useTheme";

const THEME_LABEL: Record<Theme, string> = {
  system: "System",
  dark: "Dark",
  light: "Light",
  scada: "SCADA",
};
const THEME_ORDER: Theme[] = ["system", "dark", "light", "scada"];

/** App mark: two nodes joined by a line (same drawing as the favicon). */
export function AppMark({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="6" cy="17" r="3" />
      <circle cx="18" cy="7" r="3" />
      <path d="M8.4 15.2l7.2-6.4" />
    </svg>
  );
}

/** Theme cycle button (system → dark → light → scada), labelled with the current theme. */
export function ThemeToggle() {
  const { theme, cycle } = useTheme();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  const label = `Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`;

  return (
    <button
      type="button"
      onClick={cycle}
      className="flex items-center gap-1.5 h-7 px-2 rounded border border-border text-sm text-foreground-secondary hover:text-foreground hover:bg-muted transition-colors"
      title={label}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        {theme === "dark" && <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />}
        {theme === "light" && (
          <>
            <circle cx="12" cy="12" r="5" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </>
        )}
        {theme === "scada" && <path d="M18 20V10M12 20V4M6 20v-6" />}
        {theme === "system" && (
          <>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </>
        )}
      </svg>
      <span className="hidden sm:inline">{THEME_LABEL[theme]}</span>
    </button>
  );
}

type Health = { tone: "ok" | "watch" | "incident"; word: string; detail: string };

/**
 * Live-data health. With no map open the app is simply live; with a map open
 * it follows the traffic poll: a failed poll is an incident, a last successful
 * poll older than two refresh intervals is a watch.
 */
function useHealth(): Health {
  const map = useMapStore((s) => s.map);
  const trafficError = useMapStore((s) => s.trafficError);
  const lastTrafficAt = useMapStore((s) => s.lastTrafficAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  if (!map) {
    return { tone: "ok", word: "Live", detail: "Connected. Traffic health is shown when a map is open." };
  }
  if (trafficError) {
    return {
      tone: "incident",
      word: "Offline",
      detail: "The last live traffic poll failed; the map shows the last known values.",
    };
  }
  const interval = Math.max((map.settings?.refresh_interval ?? 300) * 1000, 30000);
  if (lastTrafficAt !== null && now - lastTrafficAt > interval * 2) {
    const minutes = Math.round((now - lastTrafficAt) / 60000);
    return {
      tone: "watch",
      word: "Stale",
      detail: `No successful traffic poll for ${minutes} min (refresh every ${Math.round(interval / 1000)} s).`,
    };
  }
  return {
    tone: "ok",
    word: "Live",
    detail:
      lastTrafficAt !== null
        ? `Live traffic polled at ${new Date(lastTrafficAt).toLocaleTimeString()}.`
        : "Waiting for the first live traffic poll.",
  };
}

const DOT: Record<Health["tone"], string> = {
  ok: "bg-success",
  watch: "bg-warning-mark",
  incident: "bg-destructive",
};
const WORD: Record<Health["tone"], string> = {
  ok: "text-foreground-secondary",
  watch: "text-warning",
  incident: "text-destructive",
};

export function Header() {
  const { map, editMode, setEditMode } = useMapStore();
  const { pathname } = useLocation();
  const health = useHealth();
  const onMaps = pathname === "/";

  return (
    <header className="sticky top-0 z-50 h-12 shrink-0 border-b border-border bg-background flex items-center justify-between gap-3 px-4">
      <div className="flex items-center gap-5 min-w-0">
        <Link to="/" className="flex items-center gap-2 text-foreground shrink-0" aria-label="Netmap home">
          <AppMark />
          <span className="text-base font-semibold hidden sm:block" style={{ fontStretch: "112%" }}>
            Netmap
          </span>
        </Link>

        <nav className="flex items-center gap-4 min-w-0 text-sm" aria-label="Main">
          <Link
            to="/"
            aria-current={onMaps ? "page" : undefined}
            className={`py-1 transition-colors ${
              onMaps
                ? "text-foreground underline decoration-foreground decoration-1 underline-offset-[6px]"
                : "text-foreground-secondary hover:text-foreground"
            }`}
          >
            Maps
          </Link>
          {map && (
            <span
              className="py-1 text-foreground underline decoration-foreground decoration-1 underline-offset-[6px] truncate hidden sm:block"
              aria-current="page"
            >
              {map.name}
            </span>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <span className="flex items-center gap-1.5 text-sm" title={health.detail}>
          <span className={`w-2 h-2 rounded-full ${DOT[health.tone]}`} aria-hidden="true" />
          <span className={`${WORD[health.tone]} ${health.tone === "ok" ? "hidden md:inline" : ""}`}>{health.word}</span>
          <span className="sr-only">{health.detail}</span>
        </span>

        {map && (
          <button
            type="button"
            onClick={() => setEditMode(!editMode)}
            aria-pressed={editMode}
            className={`h-7 px-2.5 rounded border text-sm transition-colors ${
              editMode
                ? "bg-foreground text-background border-foreground font-semibold"
                : "border-border text-foreground hover:bg-muted"
            }`}
            title={editMode ? "Leave edit mode" : "Edit this map"}
          >
            {editMode ? "Editing" : "Edit"}
          </button>
        )}

        <ThemeToggle />

        <a
          href="/auth/logout"
          className="hidden md:inline text-sm text-foreground-secondary hover:text-foreground transition-colors"
        >
          Log out
        </a>
      </div>
    </header>
  );
}
