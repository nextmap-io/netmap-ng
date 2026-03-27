import { Link } from "react-router-dom";
import { useMapStore } from "@/hooks/useMapStore";

export function Header() {
  const { map, editMode, setEditMode } = useMapStore();

  return (
    <header className="sticky top-0 z-50 h-12 border-b border-noc-border bg-noc-bg/80 backdrop-blur-md flex items-center justify-between px-4 shrink-0">
      <Link to="/" className="flex items-center gap-2.5 group">
        {/* Network topology icon */}
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-accent transition-colors" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="12" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" />
          <circle cx="19" cy="19" r="2" />
          <path d="M12 7v4M10.5 12.5l-4 5M13.5 12.5l4 5" />
          <rect x="9" y="11" width="6" height="3" rx="1" />
        </svg>
        <span className="text-xs font-semibold tracking-wider text-accent hidden sm:block">
          NETMAP
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

        {/* Status indicator */}
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-subtle" />
          <span className="text-2xs text-noc-text-dim hidden md:block">LIVE</span>
        </div>
      </div>
    </header>
  );
}
