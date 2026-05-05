import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { logError } from "@/lib/log";
import { DeleteConfirmDialog } from "@/components/Editor/DeleteConfirmDialog";
import type { MapSummary } from "@/types";

interface CreateDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

function CreateMapDialog({ open, onCancel, onConfirm }: CreateDialogProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      // focus first focusable on mount
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, name, onCancel, onConfirm]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-map-title"
    >
      <div className="noc-card rounded-lg shadow-lg w-80 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 pt-4 pb-2">
          <h3 id="create-map-title" className="text-xs font-semibold text-noc-text">New Map</h3>
        </div>
        <div className="px-4 pb-3">
          <label className="noc-label mb-1 block">Name</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-noc-bg text-xs text-noc-text rounded border border-noc-border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-2xs font-medium text-noc-text-muted bg-noc-bg border border-noc-border rounded hover:bg-noc-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onConfirm(name.trim())}
            disabled={!name.trim()}
            className="px-3 py-1.5 text-2xs font-medium text-accent bg-accent/10 border border-accent/20 rounded hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

interface AlertProps {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

function AlertDialog({ open, title, message, onClose }: AlertProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="alert-title"
    >
      <div className="noc-card rounded-lg shadow-lg w-80 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 pt-4 pb-2">
          <h3 id="alert-title" className="text-xs font-semibold text-noc-text">{title}</h3>
        </div>
        <div className="px-4 pb-4">
          <p className="text-2xs text-noc-text-muted leading-relaxed">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <button
            onClick={onClose}
            autoFocus
            className="px-3 py-1.5 text-2xs font-medium text-accent bg-accent/10 border border-accent/20 rounded hover:bg-accent/20 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", onConfirm, onCancel }: ConfirmProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="noc-card rounded-lg shadow-lg w-80 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 pt-4 pb-2">
          <h3 id="confirm-title" className="text-xs font-semibold text-noc-text">{title}</h3>
        </div>
        <div className="px-4 pb-4">
          <p className="text-2xs text-noc-text-muted leading-relaxed">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-2xs font-medium text-noc-text-muted bg-noc-bg border border-noc-border rounded hover:bg-noc-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className="px-3 py-1.5 text-2xs font-medium text-accent bg-accent/10 border border-accent/20 rounded hover:bg-accent/20 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MapList() {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dialog states (replacing prompt/confirm/alert)
  const [showCreate, setShowCreate] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [alertState, setAlertState] = useState<{ title: string; message: string } | null>(null);

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

  const handleCreateConfirm = async (name: string) => {
    setShowCreate(false);
    try {
      const result = await api.createMap({ name });
      setMaps((prev) => [
        { id: result.id, name, description: "", updated_at: new Date().toISOString() },
        ...prev,
      ]);
    } catch (e) {
      logError(e, { where: "createMap" });
      setAlertState({ title: "Create failed", message: "Could not create map. Please try again." });
    }
  };

  const handleDuplicateConfirm = useCallback(async () => {
    const id = duplicateTarget;
    setDuplicateTarget(null);
    if (!id) return;
    try {
      await api.duplicateMap(id);
      refreshMaps();
    } catch (e) {
      logError(e, { where: "duplicateMap", mapId: id });
      setAlertState({ title: "Duplicate failed", message: "Failed to duplicate map." });
    }
  }, [duplicateTarget]);

  const handleDeleteConfirm = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      await api.deleteMap(target.id);
      setMaps((prev) => prev.filter((m) => m.id !== target.id));
    } catch (e) {
      logError(e, { where: "deleteMap", mapId: target.id });
      setAlertState({
        title: "Delete failed",
        message: "Failed to delete map (you may not be the owner).",
      });
    }
  }, [deleteTarget]);

  const requestDuplicate = (mapId: string) => {
    setMenuOpen(null);
    setDuplicateTarget(mapId);
  };

  const requestDelete = (mapId: string, mapName: string) => {
    setMenuOpen(null);
    setDeleteTarget({ id: mapId, name: mapName });
  };

  const toggleMenu = (e: React.MouseEvent, mapId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(menuOpen === mapId ? null : mapId);
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
          onClick={() => setShowCreate(true)}
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
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded bg-accent/10 flex items-center justify-center shrink-0">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  {m.visibility && m.visibility !== "private" && (
                    <span className="text-2xs text-noc-text-dim opacity-60 uppercase tracking-wider">
                      {m.visibility === "public" ? "pub" : "int"}
                    </span>
                  )}
                </div>

                {/* Actions menu */}
                <div className="relative" ref={menuOpen === m.id ? menuRef : undefined}>
                  <button
                    onClick={(e) => toggleMenu(e, m.id)}
                    className="p-1 rounded text-noc-text-dim hover:text-noc-text hover:bg-noc-surface transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Actions"
                    aria-label="Map actions"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                      <circle cx="12" cy="5" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="12" cy="19" r="1.5" />
                    </svg>
                  </button>

                  {menuOpen === m.id && (
                    <div className="absolute right-0 top-7 z-50 noc-card border border-noc-border rounded py-1 min-w-[140px] shadow-lg">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDuplicate(m.id); }}
                        className="w-full text-left px-3 py-1.5 text-2xs text-noc-text hover:bg-noc-surface transition-colors flex items-center gap-2"
                      >
                        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Duplicate
                      </button>
                      {userEmail && m.owner === userEmail && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); requestDelete(m.id, m.name); }}
                          className="w-full text-left px-3 py-1.5 text-2xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                        >
                          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <h2 className="text-xs font-medium text-noc-text mb-1 truncate">{m.name}</h2>
              {m.description && (
                <p className="text-2xs text-noc-text-muted mb-2 line-clamp-2">{m.description}</p>
              )}
              <p className="text-2xs text-noc-text-dim mt-1">
                {new Date(m.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </Link>
          ))}
        </div>
      )}

      <CreateMapDialog
        open={showCreate}
        onCancel={() => setShowCreate(false)}
        onConfirm={handleCreateConfirm}
      />
      <ConfirmDialog
        open={duplicateTarget !== null}
        title="Duplicate map"
        message="Create a copy of this map?"
        confirmLabel="Duplicate"
        onConfirm={handleDuplicateConfirm}
        onCancel={() => setDuplicateTarget(null)}
      />
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        title="Delete map"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ""}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
      <AlertDialog
        open={alertState !== null}
        title={alertState?.title ?? ""}
        message={alertState?.message ?? ""}
        onClose={() => setAlertState(null)}
      />
    </div>
  );
}
