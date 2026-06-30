import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useMapStore } from "@/hooks/useMapStore";
import type { MapNode, NodeType } from "@/types";

const TYPE_LABELS: Partial<Record<NodeType, string>> = {
  router: "Router",
  switch_l3: "L3",
  switch_l2: "L2",
  server: "Server",
  firewall: "FW",
  cloud: "Cloud",
  internet: "External",
  ix: "IX",
  transit: "Transit",
  pni: "PNI",
  provider: "Provider",
  customer: "Customer",
  group: "Group",
  label: "Label",
  custom: "Custom",
};

function isTypingTarget(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (el as HTMLElement).isContentEditable
  );
}

/**
 * Canvas search & filter overlay (top-left). Toggled by "/" or Ctrl/Cmd+F.
 * Searches nodes by name/label/type with a live result list; selecting a
 * result selects the node and recenters the viewport. Type-filter chips dim
 * non-matching nodes on the canvas (handled in the store + MapView).
 */
export function CanvasSearch() {
  const flow = useReactFlow();
  const {
    map,
    searchQuery,
    setSearchQuery,
    activeTypeFilters,
    toggleTypeFilter,
    matchedNodeIds,
    clearSearch,
    selectNodes,
  } = useMapStore();

  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global hotkeys: "/" or Ctrl/Cmd+F to open, Esc to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isOpenKey =
        (e.key === "/" && !isTypingTarget()) ||
        (e.key.toLowerCase() === "f" && (e.metaKey || e.ctrlKey));
      if (isOpenKey) {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Distinct node types present in the map, for the filter chips.
  const availableTypes = useMemo<NodeType[]>(() => {
    if (!map) return [];
    const seen = new Set<NodeType>();
    for (const n of map.nodes) {
      if (n.node_type !== "group" && n.node_type !== "label") seen.add(n.node_type);
    }
    return [...seen];
  }, [map]);

  // Result list: matched non-group nodes (capped for performance).
  const results = useMemo<MapNode[]>(() => {
    if (!map) return [];
    const matched = new Set(matchedNodeIds);
    const active = searchQuery.trim().length > 0 || activeTypeFilters.length > 0;
    if (!active) return [];
    return map.nodes
      .filter((n) => n.node_type !== "group" && matched.has(n.id))
      .slice(0, 40);
  }, [map, matchedNodeIds, searchQuery, activeTypeFilters]);

  const focusNode = useCallback(
    (node: MapNode) => {
      selectNodes([node.id]);
      flow.fitView({ nodes: [{ id: node.id }], duration: 400, padding: 0.6, maxZoom: 1.6 });
    },
    [flow, selectNodes],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    clearSearch();
  }, [clearSearch]);

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="absolute top-3 left-3 z-20 noc-glass rounded p-1.5 text-noc-text-muted hover:text-noc-text transition-colors"
        title="Search nodes (/)"
        aria-label="Search nodes"
      >
        <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx={7} cy={7} r={4.5} />
          <line x1={10.5} y1={10.5} x2={14} y2={14} strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  return (
    <div className="absolute top-3 left-3 z-30 w-64 noc-glass rounded flex flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-noc-border/50">
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-noc-text-dim shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx={7} cy={7} r={4.5} />
          <line x1={10.5} y1={10.5} x2={14} y2={14} strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search nodes…"
          className="flex-1 bg-transparent text-xs text-noc-text placeholder:text-noc-text-dim focus:outline-none"
          aria-label="Search nodes by name, label or type"
        />
        <button
          onClick={handleClose}
          className="text-noc-text-dim hover:text-noc-text transition-colors shrink-0"
          aria-label="Close search"
        >
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M12 4L4 12M4 4l8 8" />
          </svg>
        </button>
      </div>

      {/* Type filter chips */}
      {availableTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-noc-border/50">
          {availableTypes.map((t) => {
            const active = activeTypeFilters.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTypeFilter(t)}
                aria-pressed={active}
                className={`px-1.5 py-0.5 rounded text-[10px] tracking-wide border transition-colors ${
                  active
                    ? "bg-accent/15 text-accent border-accent/30"
                    : "text-noc-text-muted border-noc-border hover:text-noc-text"
                }`}
              >
                {TYPE_LABELS[t] || t}
              </button>
            );
          })}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <ul className="max-h-64 overflow-y-auto py-1">
          {results.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => focusNode(n)}
                className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-noc-surface/60 transition-colors"
              >
                <span className="text-[9px] uppercase tracking-wider text-noc-text-dim w-12 shrink-0 truncate">
                  {TYPE_LABELS[n.node_type] || n.node_type}
                </span>
                <span className="text-xs text-noc-text truncate">{n.label || n.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.length === 0 &&
        (searchQuery.trim().length > 0 || activeTypeFilters.length > 0) && (
          <div className="px-2 py-2 text-2xs text-noc-text-dim">No matching nodes</div>
        )}
    </div>
  );
}
