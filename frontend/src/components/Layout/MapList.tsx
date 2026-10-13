import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { MapSummary } from "@/types";

const VISIBILITY_LABEL: Record<string, string> = {
  private: "Private",
  internal: "Internal",
  public: "Public",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function MapList() {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshMaps = () => {
    api.listMaps().then(setMaps).finally(() => setLoading(false));
  };

  useEffect(() => {
    refreshMaps();
    api.getUser().then((u) => setUserEmail(u.email)).catch(() => {});
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const createMap = async () => {
    const name = prompt("Map name:");
    if (!name?.trim()) return;
    const result = await api.createMap({ name: name.trim() });
    setMaps((prev) => [{ id: result.id, name: name.trim(), description: "", updated_at: new Date().toISOString() }, ...prev]);
  };

  const duplicateMap = useCallback(async (mapId: string) => {
    setMenuOpen(null);
    if (!confirm("Duplicate this map?")) return;
    try {
      await api.duplicateMap(mapId);
      refreshMaps();
    } catch {
      alert("Failed to duplicate map");
    }
  }, []);

  const deleteMap = useCallback(async (mapId: string, mapName: string) => {
    setMenuOpen(null);
    if (!confirm(`Delete "${mapName}"? This cannot be undone.`)) return;
    try {
      await api.deleteMap(mapId);
      setMaps((prev) => prev.filter((m) => m.id !== mapId));
    } catch {
      alert("Failed to delete map (you may not be the owner)");
    }
  }, []);

  const toggleMenu = (e: React.MouseEvent, mapId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(menuOpen === mapId ? null : mapId);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">Network maps</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Your maps and the maps shared with you, most recently updated first."
              : `${maps.length} map${maps.length !== 1 ? "s" : ""}: yours and the ones shared with you, most recently updated first.`}
          </p>
        </div>
        <button
          type="button"
          onClick={createMap}
          className="h-8 px-3 rounded bg-foreground text-background text-base font-medium hover:opacity-90 transition-opacity"
        >
          New map
        </button>
      </div>

      {loading ? (
        <div className="h-40 rounded bg-muted" role="status" aria-label="Loading maps" />
      ) : maps.length === 0 ? (
        <p className="border-t border-border pt-4 text-base text-foreground-secondary">
          There are no maps you can see yet. Create one with New map, then add devices from Observium in the editor.
        </p>
      ) : (
        <table className="w-full table-fixed border-collapse text-base">
          <thead>
            <tr className="border-b border-border text-left text-sm text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-normal">Name</th>
              <th scope="col" className="py-2 pr-3 font-normal hidden md:table-cell">Description</th>
              <th scope="col" className="py-2 pr-3 font-normal w-20 sm:w-24">Visibility</th>
              <th scope="col" className="py-2 pr-3 font-normal text-right w-24 sm:w-28">Updated</th>
              <th scope="col" className="py-2 w-9"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {maps.map((m) => (
              <tr key={m.id} className="border-b border-border-soft align-top hover:bg-muted transition-colors">
                <td className="py-2.5 pr-3 min-w-0">
                  <Link to={`/map/${m.id}`} className="block truncate font-medium text-foreground hover:underline">
                    {m.name}
                  </Link>
                  {m.description && (
                    <p className="md:hidden mt-0.5 text-sm text-foreground-secondary line-clamp-2">{m.description}</p>
                  )}
                </td>
                <td className="py-2.5 pr-3 hidden md:table-cell text-sm text-foreground-secondary">
                  <span className="line-clamp-2">{m.description || <span className="text-muted-foreground">—</span>}</span>
                </td>
                <td className="py-2.5 pr-3">
                  <span className="inline-block rounded border border-border px-1.5 text-sm text-foreground-secondary">
                    {VISIBILITY_LABEL[m.visibility ?? "private"] ?? m.visibility}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right text-sm text-foreground-secondary whitespace-nowrap">
                  <time dateTime={m.updated_at}>{formatDate(m.updated_at)}</time>
                </td>
                <td className="py-1.5 text-right">
                  <div className="relative inline-block" ref={menuOpen === m.id ? menuRef : undefined}>
                    <button
                      type="button"
                      onClick={(e) => toggleMenu(e, m.id)}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="Actions"
                      aria-label={`Actions for ${m.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen === m.id}
                    >
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
                        <circle cx="12" cy="5" r="1.5" />
                        <circle cx="12" cy="12" r="1.5" />
                        <circle cx="12" cy="19" r="1.5" />
                      </svg>
                    </button>

                    {menuOpen === m.id && (
                      <div
                        role="menu"
                        className="absolute right-0 top-8 z-50 min-w-[140px] rounded border border-border bg-card py-1 text-left"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); duplicateMap(m.id); }}
                          className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
                        >
                          Duplicate
                        </button>
                        {userEmail && m.owner === userEmail && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteMap(m.id, m.name); }}
                            className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-muted transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
