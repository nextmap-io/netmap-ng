import { Link } from "react-router-dom";
import { useMapStore } from "@/hooks/useMapStore";
import { useTheme } from "@/hooks/useTheme";

export function Header() {
  const { map, editMode, setEditMode } = useMapStore();
  const { theme, cycle } = useTheme();

  return (
    <header className="sticky top-0 z-50 h-12 border-b border-noc-border bg-noc-bg/80 backdrop-blur-md flex items-center justify-between px-4 shrink-0">
      <Link to="/" className="flex items-center gap-2.5 group">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-accent transition-colors" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="12" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" />
          <circle cx="19" cy="19" r="2" />
          <path d="M12 7v4M10.5 12.5l-4 5M13.5 12.5l4 5" />
          <rect x="9" y="11" width="6" height="3" rx="1" />
        </svg>
        <span className="text-xs font-semibold tracking-wider text-accent hidden sm:block">
          {theme === "scada" ? "NETMAP // SCADA" : "NETMAP"}
        </span>
      </Link>

      <div className="flex items-center gap-3">
        {map && (
          <>
            <span className="text-2xs text-noc-text-muted tracking-wide hidden sm:block">
              {map.name}
            </span>
            <div className="h-4 w-px bg-noc-border hidden sm:block" />
            <button
              onClick={() => setEditMode(!editMode)}
              className={`px-2.5 py-1 rounded text-2xs font-medium tracking-wider uppercase transition-colors focus-visible:ring-1 focus-visible:ring-accent ${
                editMode
                  ? "bg-traffic-out/15 text-traffic-out border border-traffic-out/30"
                  : "text-noc-text-muted border border-noc-border hover:text-noc-text hover:border-noc-muted"
              }`}
            >
              {editMode ? "Editing" : "Edit"}
            </button>
          </>
        )}

        {/* Theme toggle: system → dark → light → scada */}
        <button
          onClick={cycle}
          className="p-1.5 rounded text-noc-text-muted hover:text-noc-text hover:bg-noc-surface transition-colors"
          title={`Theme: ${theme}`}
        >
          {theme === "dark" && (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
          {theme === "light" && (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          )}
          {theme === "scada" && (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 20V10M12 20V4M6 20v-6" />
            </svg>
          )}
          {theme === "system" && (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
          )}
        </button>

        {/* User info (when authenticated) */}
        <div className="hidden md:flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-noc-text-dim" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <a href="/auth/logout" className="text-2xs text-noc-text-dim hover:text-noc-text transition-colors">
            Logout
          </a>
        </div>

        {/* LIVE indicator */}
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse-subtle ${
            theme === "scada" ? "bg-yellow-400" : "bg-green-500"
          }`} />
          <span className="text-2xs text-noc-text-dim hidden md:block">LIVE</span>
        </div>
      </div>
    </header>
  );
}
