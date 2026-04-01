import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { MapSummary } from "@/types";

export function MapList() {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshMaps = () => {
    api.listMaps().then(setMaps).finally(() => setLoading(false));
  };

  useEffect(() => {
    refreshMaps();
  }, []);

  const createMap = async () => {
    const name = prompt("Map name:");
    if (!name?.trim()) return;
    const result = await api.createMap({ name: name.trim() });
    setMaps((prev) => [{ id: result.id, name: name.trim(), description: "", updated_at: new Date().toISOString() }, ...prev]);
  };

  const duplicateMap = async (e: React.MouseEvent, mapId: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await api.duplicateMap(mapId);
      refreshMaps();
    } catch {
      alert("Failed to duplicate map");
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="h-3 w-32 bg-noc-surface rounded animate-shimmer" style={{ backgroundImage: "linear-gradient(90deg, transparent 0%, hsl(220 15% 20%) 50%, transparent 100%)", backgroundSize: "200% 100%" }} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="noc-card p-4 h-28 animate-shimmer" style={{ backgroundImage: "linear-gradient(90deg, transparent 0%, hsl(220 15% 14%) 50%, transparent 100%)", backgroundSize: "200% 100%", animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-end justify-between mb-8 animate-fade-in">
        <div>
          <h1 className="noc-label mb-1">Network Maps</h1>
          <p className="text-xs text-noc-text-dim">
            {maps.length} map{maps.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={createMap}
          className="px-3 py-1.5 bg-accent/10 text-accent border border-accent/20 rounded text-2xs font-medium tracking-wider uppercase hover:bg-accent/20 transition-colors focus-visible:ring-1 focus-visible:ring-accent"
        >
          + New Map
        </button>
      </div>

      {maps.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <svg viewBox="0 0 24 24" className="w-10 h-10 mx-auto mb-4 text-noc-text-dim opacity-40" fill="none" stroke="currentColor" strokeWidth={1}>
            <circle cx="12" cy="5" r="2" />
            <circle cx="5" cy="19" r="2" />
            <circle cx="19" cy="19" r="2" />
            <path d="M12 7v4M10.5 12.5l-4 5M13.5 12.5l4 5" />
            <rect x="9" y="11" width="6" height="3" rx="1" />
          </svg>
          <p className="text-xs text-noc-text-muted mb-1">No maps yet</p>
          <p className="text-2xs text-noc-text-dim">Create your first network weathermap</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((m, i) => (
            <Link
              key={m.id}
              to={`/map/${m.id}`}
              className={`group noc-card p-4 hover:border-accent/30 transition-all duration-200 animate-fade-in opacity-0 stagger-${Math.min(i + 1, 6)}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-7 h-7 rounded bg-accent/10 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                </div>
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-noc-text-dim group-hover:text-accent transition-colors" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>

              <h2 className="text-xs font-medium text-noc-text mb-1 truncate">{m.name}</h2>
              {m.description && (
                <p className="text-2xs text-noc-text-muted mb-2 line-clamp-2">{m.description}</p>
              )}
              <div className="flex items-center justify-between mt-1">
                <p className="text-2xs text-noc-text-dim">
                  {new Date(m.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </p>
                <button
                  onClick={(e) => duplicateMap(e, m.id)}
                  className="px-2 py-0.5 text-2xs text-noc-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                  title="Duplicate map"
                >
                  Duplicate
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
