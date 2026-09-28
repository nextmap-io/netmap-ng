import { create } from "zustand";
import type { NetmapData, MapSettings, TrafficData, NodeStatusData, MapNode, MapLink, NodeType, AlignDirection } from "@/types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "@/types";
import { api, ApiError } from "@/api/client";
import { toast } from "@/hooks/useToast";

/** Rendered footprint of a node, falling back to the shared default size. */
const nodeW = (n: MapNode) => n.width || DEFAULT_NODE_WIDTH;
const nodeH = (n: MapNode) => n.height || DEFAULT_NODE_HEIGHT;
/** A node is locked either via its own flag or a legacy style.locked flag. */
const isNodeLocked = (n: MapNode) => n.locked || !!n.style?.locked;

/**
 * Full editable snapshot of the map for undo/redo.
 * Captures positions AND editable fields of every node and link so that
 * property edits and bulk edits can be reverted (not just drag positions).
 */
interface EntitySnapshot {
  nodes: MapNode[];
  links: MapLink[];
}

const MAX_UNDO = 50;

/** Editable node fields that should be persisted on an undo/redo revert. */
function nodeEditable(n: MapNode): Record<string, unknown> {
  return {
    name: n.name,
    label: n.label,
    node_type: n.node_type,
    x: n.x,
    y: n.y,
    z_order: n.z_order,
    parent_id: n.parent_id,
    width: n.width,
    height: n.height,
    observium_device_id: n.observium_device_id,
    icon: n.icon,
    style: n.style,
    locked: n.locked,
    info_url: n.info_url,
    extra: n.extra,
  };
}

/** Editable link fields that should be persisted on an undo/redo revert. */
function linkEditable(l: MapLink): Record<string, unknown> {
  return {
    name: l.name,
    link_type: l.link_type,
    source_anchor: l.source_anchor,
    target_anchor: l.target_anchor,
    bandwidth: l.bandwidth,
    bandwidth_label: l.bandwidth_label,
    via_points: l.via_points,
    via_style: l.via_style,
    arrow_style: l.arrow_style,
    datasource: l.datasource,
    observium_port_id_a: l.observium_port_id_a,
    observium_port_id_b: l.observium_port_id_b,
    info_url_in: l.info_url_in,
    info_url_out: l.info_url_out,
    width: l.width,
    duplex: l.duplex,
    extra: l.extra,
    z_order: l.z_order,
  };
}

function cloneMap<T>(items: T[]): T[] {
  return items.map((i) => structuredClone(i));
}

function takeSnapshot(map: NetmapData): EntitySnapshot {
  return { nodes: cloneMap(map.nodes), links: cloneMap(map.links) };
}

/**
 * Push a pre-captured snapshot onto the undo stack. Called only AFTER a
 * mutation is confirmed persisted so a failed/rolled-back edit never leaves a
 * no-op undo entry (canUndo=true with nothing to revert).
 */
function commitUndoSnapshot(
  set: (partial: Partial<MapStore>) => void,
  get: () => MapStore,
  snap: EntitySnapshot,
): void {
  const { _undoStack } = get();
  set({
    _undoStack: [..._undoStack, snap].slice(-MAX_UNDO),
    _redoStack: [],
    canUndo: true,
    canRedo: false,
  });
}

/**
 * Apply an optimistic position change to a set of nodes and persist it via
 * batch-move. The pre-action snapshot is pushed onto the undo stack right away
 * (keeps the order of rapid actions such as repeated nudges); if the write
 * fails, that exact entry is dropped again, the moved nodes are restored to
 * their pre-action positions and the error is surfaced as a toast.
 */
async function commitMoves(
  set: (partial: Partial<MapStore>) => void,
  get: () => MapStore,
  snap: EntitySnapshot,
  updatedNodes: MapNode[],
  ids: Set<string>,
  what: string,
): Promise<void> {
  const map = get().map;
  if (!map || ids.size === 0) return;
  const mapId = map.id;

  set({ map: { ...map, nodes: updatedNodes } });
  commitUndoSnapshot(set, get, snap);

  const moves = updatedNodes
    .filter((n) => ids.has(n.id))
    .map((n) => ({ id: n.id, x: n.x, y: n.y }));
  try {
    await api.batchMoveNodes(mapId, moves);
    set({ lastSaved: Date.now() });
  } catch (e) {
    const cur = get().map;
    if (cur && cur.id === mapId) {
      const before = new Map(snap.nodes.map((n) => [n.id, n]));
      set({
        map: {
          ...cur,
          nodes: cur.nodes.map((n) => {
            const prev = ids.has(n.id) ? before.get(n.id) : undefined;
            return prev ? { ...n, x: prev.x, y: prev.y } : n;
          }),
        },
      });
      const undoStack = get()._undoStack.filter((s) => s !== snap);
      set({ _undoStack: undoStack, canUndo: undoStack.length > 0 });
    }
    toast.fromError(e, `Failed to ${what}`);
  }
}

/** Optimistically apply new map settings (bound groups); roll back + toast on failure. */
async function persistBoundGroups(
  set: (partial: Partial<MapStore>) => void,
  get: () => MapStore,
  settings: MapSettings,
  what: string,
): Promise<void> {
  const map = get().map;
  if (!map) return;
  const previous = map.settings;
  set({ map: { ...map, settings } });
  try {
    await api.updateMap(map.id, { settings });
    set({ lastSaved: Date.now() });
  } catch (e) {
    const cur = get().map;
    if (cur && cur.id === map.id) set({ map: { ...cur, settings: previous } });
    toast.fromError(e, `Failed to ${what}`);
  }
}

/**
 * Overlay an undo/redo snapshot onto the CURRENT map by id. Entities created
 * since the snapshot are kept and entities deleted since are not resurrected,
 * so undo stays valid across creates/deletes (the stack survives refreshMap).
 */
function reconcileSnapshot(current: NetmapData, snap: EntitySnapshot): EntitySnapshot {
  const snapNodes = new Map(snap.nodes.map((n) => [n.id, n]));
  const snapLinks = new Map(snap.links.map((l) => [l.id, l]));
  const currentIds = new Set(current.nodes.map((n) => n.id));
  return {
    nodes: current.nodes.map((n) => {
      const s = snapNodes.get(n.id);
      // Its parent group was deleted since the snapshot: the server detached it
      // (and rebased its position), so restoring the old parent would 422 forever.
      if (!s || (s.parent_id && !currentIds.has(s.parent_id))) return n;
      return structuredClone(s);
    }),
    links: current.links.map((l) => {
      const s = snapLinks.get(l.id);
      return s ? structuredClone(s) : l;
    }),
  };
}

/**
 * Persist the difference between a target snapshot and the state before it.
 * Node positions go through the batch-move endpoint (existing path, never
 * regressed); nodes/links whose editable fields changed are persisted via the
 * per-entity update endpoints so the revert sticks on the backend.
 */
async function persistSnapshot(
  mapId: string,
  target: EntitySnapshot,
  before: EntitySnapshot,
): Promise<void> {
  // Positions: one batch-move call covers all nodes (cheap, atomic).
  const moves = target.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  if (moves.length > 0) await api.batchMoveNodes(mapId, moves);

  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const beforeLinks = new Map(before.links.map((l) => [l.id, l]));

  // Node field changes (positions excluded — handled above).
  for (const n of target.nodes) {
    const prev = beforeNodes.get(n.id);
    if (!prev) continue;
    const a = nodeEditable(n);
    const b = nodeEditable(prev);
    delete a.x; delete a.y; delete b.x; delete b.y;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      await api.updateNode(mapId, n.id, a);
    }
  }

  // Link field changes.
  for (const l of target.links) {
    const prev = beforeLinks.get(l.id);
    if (!prev) continue;
    const a = linkEditable(l);
    const b = linkEditable(prev);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      await api.updateLink(mapId, l.id, a);
    }
  }
}

interface MapStore {
  // Data
  map: NetmapData | null;
  traffic: TrafficData;
  trafficError: boolean;
  /** Per-node reachability, polled alongside traffic (empty on older backends). */
  nodeStatus: NodeStatusData;
  /** Time (ms) of the last successful traffic poll. */
  lastTrafficAt: number | null;
  loading: boolean;
  error: string | null;
  errorStatus: number | null;

  // Editor state
  editMode: boolean;
  selectedNodeIds: string[];
  selectedLinkIds: string[];
  snapToGrid: boolean;
  selectMode: boolean;
  saving: boolean;
  lastSaved: number | null;

  // Canvas search & filter
  searchQuery: string;
  activeTypeFilters: NodeType[];
  matchedNodeIds: string[];

  // Undo/redo
  _undoStack: EntitySnapshot[];
  _redoStack: EntitySnapshot[];
  canUndo: boolean;
  canRedo: boolean;

  // Backward-compat computed getters
  selectedNodeId: string | null;
  selectedLinkId: string | null;

  // Polling
  _pollTimer: ReturnType<typeof setInterval> | null;
  _trafficAbort: AbortController | null;
  _pollMapId: string | null;

  // Actions
  /**
   * Load a map. With `reset` (initial mount / map switch) this shows the
   * loading state and clears undo history; otherwise, when the same map is
   * already loaded, it delegates to the silent `refreshMap`.
   */
  loadMap: (id: string, options?: { reset?: boolean }) => Promise<void>;
  /** Re-fetch the current map without loading state or clearing undo (viewport stays put). */
  refreshMap: () => Promise<void>;
  setEditMode: (on: boolean) => void;

  // Canvas search & filter
  setSearchQuery: (q: string) => void;
  toggleTypeFilter: (type: NodeType) => void;
  clearTypeFilters: () => void;
  clearSearch: () => void;

  // Legacy single-select (kept for backward compat)
  selectNode: (id: string | null) => void;
  selectLink: (id: string | null) => void;

  // Multi-select
  selectNodes: (ids: string[]) => void;
  selectLinks: (ids: string[]) => void;
  clearSelection: () => void;

  // Optimistic updates
  updateNodeField: (nodeId: string, fields: Record<string, unknown>) => Promise<void>;
  updateLinkField: (linkId: string, fields: Record<string, unknown>) => Promise<void>;

  // Bulk updates (multi-select)
  bulkUpdateNodes: (ids: string[], fields: Record<string, unknown>) => Promise<void>;
  bulkUpdateLinks: (ids: string[], fields: Record<string, unknown>) => Promise<void>;

  // CRUD
  deleteNode: (nodeId: string) => Promise<void>;
  deleteLink: (linkId: string) => Promise<void>;
  createLink: (data: Record<string, unknown>) => Promise<void>;
  /** Delete several nodes/links in one request, then silently refresh. */
  deleteEntities: (nodeIds: string[], linkIds: string[]) => Promise<void>;

  // Layout
  alignNodes: (direction: AlignDirection) => Promise<void>;
  alignToCanvas: (axis: "horizontal" | "vertical") => Promise<void>;
  matchNodeSize: (dim: "width" | "height") => Promise<void>;
  distributeNodes: (axis: "horizontal" | "vertical") => Promise<void>;
  flipNodes: (axis: "horizontal" | "vertical") => Promise<void>;
  toggleSnapToGrid: () => void;
  toggleSelectMode: () => void;

  // Bound groups (move together)
  getBoundGroup: (nodeId: string) => string[] | undefined;
  bindSelectedNodes: () => Promise<void>;
  unbindSelectedNodes: () => Promise<void>;

  // Positions
  nudgeSelectedNodes: (dx: number, dy: number) => Promise<void>;
  /**
   * Commit a batch of new positions (drag stop, auto-layout) as a single undo
   * snapshot; rolled back with a toast if the write fails.
   */
  applyNodePositions: (positions: Array<{ id: string; x: number; y: number }>) => Promise<void>;

  // Undo/redo
  pushUndo: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;

  // Traffic
  setTraffic: (data: TrafficData) => void;
  startTrafficPolling: () => void;
  stopTrafficPolling: () => void;
}

/** Compute which node ids match the active search query + type filters. */
function computeMatches(
  nodes: MapNode[],
  query: string,
  filters: NodeType[],
): string[] {
  const q = query.trim().toLowerCase();
  const filterSet = new Set(filters);
  return nodes
    .filter((n) => {
      const typeOk = filterSet.size === 0 || filterSet.has(n.node_type);
      const textOk =
        q.length === 0 ||
        n.name.toLowerCase().includes(q) ||
        n.label.toLowerCase().includes(q) ||
        n.node_type.toLowerCase().includes(q);
      return typeOk && textOk;
    })
    .map((n) => n.id);
}

export const useMapStore = create<MapStore>((set, get) => ({
  map: null,
  traffic: {},
  trafficError: false,
  nodeStatus: {},
  lastTrafficAt: null,
  loading: false,
  error: null,
  errorStatus: null,
  editMode: false,
  selectedNodeIds: [],
  selectedLinkIds: [],
  selectedNodeId: null,
  selectedLinkId: null,
  snapToGrid: false,
  selectMode: true,
  saving: false,
  lastSaved: null,
  searchQuery: "",
  activeTypeFilters: [],
  matchedNodeIds: [],
  _pollTimer: null,
  _trafficAbort: null,
  _pollMapId: null,
  _undoStack: [],
  _redoStack: [],
  canUndo: false,
  canRedo: false,

  loadMap: async (id, options) => {
    const current = get();
    // Post-mutation reloads of the map already on screen must not flash the
    // spinner (which unmounts ReactFlow → re-fitView) nor wipe undo history.
    if (!options?.reset && current.map?.id === id && !current.error && !current.loading) {
      await get().refreshMap();
      return;
    }

    const switching = current.map?.id !== id;
    set({
      loading: true,
      error: null,
      errorStatus: null,
      ...(switching ? { traffic: {}, nodeStatus: {}, lastTrafficAt: null, trafficError: false } : {}),
    });
    try {
      const data = await api.getMap(id);
      const { searchQuery, activeTypeFilters } = get();
      set({
        map: data,
        loading: false,
        selectedNodeIds: [],
        selectedLinkIds: [],
        selectedNodeId: null,
        selectedLinkId: null,
        _undoStack: [],
        _redoStack: [],
        canUndo: false,
        canRedo: false,
        matchedNodeIds: computeMatches(data.nodes, searchQuery, activeTypeFilters),
      });
      // Start traffic polling after map loads
      get().startTrafficPolling();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load map";
      const status = e instanceof ApiError ? e.status : null;
      set({ error: message, errorStatus: status, loading: false });
    }
  },

  refreshMap: async () => {
    const before = get().map;
    if (!before) return;
    const id = before.id;
    try {
      const data = await api.getMap(id);
      // Ignore a late response if the user switched maps meanwhile.
      if (get().map?.id !== id) return;
      const { searchQuery, activeTypeFilters, selectedNodeIds, selectedLinkIds } = get();
      // Drop selections pointing at entities that no longer exist.
      const nodeIds = new Set(data.nodes.map((n) => n.id));
      const linkIds = new Set(data.links.map((l) => l.id));
      const selNodes = selectedNodeIds.filter((n) => nodeIds.has(n));
      const selLinks = selectedLinkIds.filter((l) => linkIds.has(l));
      set({
        map: data,
        matchedNodeIds: computeMatches(data.nodes, searchQuery, activeTypeFilters),
        ...(selNodes.length !== selectedNodeIds.length || selLinks.length !== selectedLinkIds.length
          ? {
              selectedNodeIds: selNodes,
              selectedLinkIds: selLinks,
              selectedNodeId: selNodes.length === 1 && selLinks.length === 0 ? selNodes[0] : null,
              selectedLinkId: selLinks.length === 1 && selNodes.length === 0 ? selLinks[0] : null,
            }
          : {}),
      });
      // Settings may have changed the refresh interval: restart active polling.
      const oldInterval = before.settings?.refresh_interval ?? 300;
      const newInterval = data.settings?.refresh_interval ?? 300;
      if (oldInterval !== newInterval && get()._pollMapId === id) get().startTrafficPolling();
    } catch (e) {
      toast.fromError(e, "Failed to refresh map");
    }
  },

  setEditMode: (on) =>
    set({ editMode: on, selectedNodeIds: [], selectedLinkIds: [] }),

  // ── Canvas search & filter ──
  setSearchQuery: (q) => {
    const { map, activeTypeFilters } = get();
    const matched = map ? computeMatches(map.nodes, q, activeTypeFilters) : [];
    set({ searchQuery: q, matchedNodeIds: matched });
  },
  toggleTypeFilter: (type) => {
    const { map, searchQuery, activeTypeFilters } = get();
    const filters = activeTypeFilters.includes(type)
      ? activeTypeFilters.filter((t) => t !== type)
      : [...activeTypeFilters, type];
    const matched = map ? computeMatches(map.nodes, searchQuery, filters) : [];
    set({ activeTypeFilters: filters, matchedNodeIds: matched });
  },
  clearTypeFilters: () => {
    const { map, searchQuery } = get();
    const matched = map ? computeMatches(map.nodes, searchQuery, []) : [];
    set({ activeTypeFilters: [], matchedNodeIds: matched });
  },
  clearSearch: () =>
    set({ searchQuery: "", activeTypeFilters: [], matchedNodeIds: [] }),

  // Legacy single-select (also sets backward-compat singular fields)
  selectNode: (id) =>
    set({
      selectedNodeIds: id ? [id] : [],
      selectedLinkIds: [],
      selectedNodeId: id,
      selectedLinkId: null,
    }),
  selectLink: (id) =>
    set({
      selectedLinkIds: id ? [id] : [],
      selectedNodeIds: [],
      selectedLinkId: id,
      selectedNodeId: null,
    }),

  // Multi-select (also update backward-compat singular fields)
  selectNodes: (ids) => set({
    selectedNodeIds: ids, selectedLinkIds: [],
    selectedNodeId: ids.length === 1 ? ids[0] : null, selectedLinkId: null,
  }),
  selectLinks: (ids) => set({
    selectedLinkIds: ids, selectedNodeIds: [],
    selectedLinkId: ids.length === 1 ? ids[0] : null, selectedNodeId: null,
  }),
  clearSelection: () => set({
    selectedNodeIds: [], selectedLinkIds: [],
    selectedNodeId: null, selectedLinkId: null,
  }),

  // Optimistic node field update
  updateNodeField: async (nodeId, fields) => {
    const { map } = get();
    if (!map) return;

    // Snapshot BEFORE mutating, but only commit it to the undo stack once the
    // write succeeds — a failed/rolled-back edit must not leave a no-op entry.
    const snap = takeSnapshot(map);
    const previousNodes = map.nodes;

    // Optimistically update local state
    const newNodes = map.nodes.map((n: MapNode) =>
      n.id === nodeId ? { ...n, ...fields } : n
    );
    set({
      map: { ...map, nodes: newNodes },
      saving: true,
      matchedNodeIds: computeMatches(newNodes, get().searchQuery, get().activeTypeFilters),
    });

    try {
      await api.updateNode(map.id, nodeId, fields);
      commitUndoSnapshot(set, get, snap);
      set({ saving: false, lastSaved: Date.now() });
    } catch (e) {
      // Revert to saved state
      set({
        map: { ...get().map!, nodes: previousNodes },
        saving: false,
      });
      toast.fromError(e, "Failed to save node");
    }
  },

  // Optimistic link field update
  updateLinkField: async (linkId, fields) => {
    const { map } = get();
    if (!map) return;

    const snap = takeSnapshot(map);
    const previousLinks = map.links;

    // Optimistically update local state
    set({
      map: {
        ...map,
        links: map.links.map((l: MapLink) =>
          l.id === linkId ? { ...l, ...fields } : l
        ),
      },
      saving: true,
    });

    try {
      await api.updateLink(map.id, linkId, fields);
      commitUndoSnapshot(set, get, snap);
      set({ saving: false, lastSaved: Date.now() });
    } catch (e) {
      // Revert to saved state
      set({
        map: { ...get().map!, links: previousLinks },
        saving: false,
      });
      toast.fromError(e, "Failed to save link");
    }
  },

  // Bulk update multiple nodes at once (single undo snapshot, optimistic).
  bulkUpdateNodes: async (ids, fields) => {
    const { map } = get();
    if (!map || ids.length === 0) return;

    const snap = takeSnapshot(map);
    const previousNodes = map.nodes;
    const idSet = new Set(ids);
    const newNodes = map.nodes.map((n: MapNode) => {
      if (!idSet.has(n.id)) return n;
      const next = { ...n, ...fields } as MapNode;
      // Merge nested JSON columns so unrelated keys aren't clobbered locally.
      if (fields.style) next.style = { ...n.style, ...(fields.style as Record<string, unknown>) };
      if (fields.extra) next.extra = { ...n.extra, ...(fields.extra as Record<string, unknown>) };
      return next;
    });
    set({
      map: { ...map, nodes: newNodes },
      saving: true,
      matchedNodeIds: computeMatches(newNodes, get().searchQuery, get().activeTypeFilters),
    });

    try {
      await api.batchUpdateNodes(map.id, ids, fields);
      commitUndoSnapshot(set, get, snap);
      set({ saving: false, lastSaved: Date.now() });
    } catch (e) {
      set({ map: { ...get().map!, nodes: previousNodes }, saving: false });
      toast.fromError(e, `Failed to update ${ids.length} node${ids.length > 1 ? "s" : ""}`);
    }
  },

  // Bulk update multiple links at once (single undo snapshot, optimistic).
  bulkUpdateLinks: async (ids, fields) => {
    const { map } = get();
    if (!map || ids.length === 0) return;

    const snap = takeSnapshot(map);
    const previousLinks = map.links;
    const idSet = new Set(ids);
    const newLinks = map.links.map((l: MapLink) => {
      if (!idSet.has(l.id)) return l;
      const next = { ...l, ...fields } as MapLink;
      if (fields.extra) next.extra = { ...l.extra, ...(fields.extra as Record<string, unknown>) };
      return next;
    });
    set({ map: { ...map, links: newLinks }, saving: true });

    try {
      await api.batchUpdateLinks(map.id, ids, fields);
      commitUndoSnapshot(set, get, snap);
      set({ saving: false, lastSaved: Date.now() });
    } catch (e) {
      set({ map: { ...get().map!, links: previousLinks }, saving: false });
      toast.fromError(e, `Failed to update ${ids.length} link${ids.length > 1 ? "s" : ""}`);
    }
  },

  // Delete node, then silently refresh (viewport + undo history preserved)
  deleteNode: async (nodeId) => {
    const { map } = get();
    if (!map) return;
    try {
      await api.deleteNode(map.id, nodeId);
    } catch (e) {
      toast.fromError(e, "Failed to delete node");
      return;
    }
    await get().refreshMap();
  },

  // Delete link, then silently refresh
  deleteLink: async (linkId) => {
    const { map } = get();
    if (!map) return;
    try {
      await api.deleteLink(map.id, linkId);
    } catch (e) {
      toast.fromError(e, "Failed to delete link");
      return;
    }
    await get().refreshMap();
  },

  // Create link, then silently refresh
  createLink: async (data) => {
    const { map } = get();
    if (!map) return;
    try {
      await api.createLink(map.id, data);
    } catch (e) {
      toast.fromError(e, "Failed to create link");
      return;
    }
    await get().refreshMap();
  },

  deleteEntities: async (nodeIds, linkIds) => {
    const { map } = get();
    if (!map || (nodeIds.length === 0 && linkIds.length === 0)) return;
    try {
      try {
        await api.batchDelete(map.id, nodeIds, linkIds);
      } catch (e) {
        // Older backend without the batch-delete route (the path then hits the
        // /{node_id} route → 405): fall back to sequential per-entity deletes.
        // A 404 is the new endpoint rejecting unknown ids before deleting
        // anything — surface it rather than deleting piecemeal.
        if (!(e instanceof ApiError && e.status === 405)) throw e;
        const nodeSet = new Set(nodeIds);
        const orphanFree = linkIds.filter((id) => {
          const l = map.links.find((x) => x.id === id);
          return !l || (!nodeSet.has(l.source_id) && !nodeSet.has(l.target_id));
        });
        for (const id of orphanFree) await api.deleteLink(map.id, id);
        for (const id of nodeIds) await api.deleteNode(map.id, id);
      }
    } catch (e) {
      toast.fromError(e, "Failed to delete selection");
    }
    // Refresh either way: a partial failure may still have removed some items.
    await get().refreshMap();
  },

  // ── Undo / Redo ──

  pushUndo: () => {
    const { map, _undoStack } = get();
    if (!map) return;
    const snap = takeSnapshot(map);
    const newStack = [..._undoStack, snap].slice(-MAX_UNDO);
    set({ _undoStack: newStack, _redoStack: [], canUndo: true, canRedo: false });
  },

  undo: async () => {
    const { map, _undoStack, _redoStack } = get();
    if (!map || _undoStack.length === 0) return;

    const currentSnap = takeSnapshot(map);
    const prevSnap = reconcileSnapshot(map, _undoStack[_undoStack.length - 1]);
    const newUndoStack = _undoStack.slice(0, -1);
    const newRedoStack = [..._redoStack, currentSnap];

    set({
      map: { ...map, nodes: prevSnap.nodes, links: prevSnap.links },
      _undoStack: newUndoStack,
      _redoStack: newRedoStack,
      canUndo: newUndoStack.length > 0,
      canRedo: true,
      matchedNodeIds: computeMatches(prevSnap.nodes, get().searchQuery, get().activeTypeFilters),
    });

    // Persist the revert so it sticks on the backend (positions + field diffs).
    try {
      await persistSnapshot(map.id, prevSnap, currentSnap);
    } catch (e) {
      // Put the map back, but drop the failing entry: re-queuing it would make
      // every later undo retry (and fail on) the same step.
      if (get().map?.id === map.id) {
        set({
          map: { ...get().map!, nodes: currentSnap.nodes, links: currentSnap.links },
          _undoStack: newUndoStack,
          _redoStack,
          canUndo: newUndoStack.length > 0,
          canRedo: _redoStack.length > 0,
          matchedNodeIds: computeMatches(currentSnap.nodes, get().searchQuery, get().activeTypeFilters),
        });
      }
      toast.fromError(e, "Failed to undo");
      // A multi-request revert may have partially applied: resync with the server.
      await get().refreshMap();
    }
  },

  redo: async () => {
    const { map, _undoStack, _redoStack } = get();
    if (!map || _redoStack.length === 0) return;

    const currentSnap = takeSnapshot(map);
    const nextSnap = reconcileSnapshot(map, _redoStack[_redoStack.length - 1]);
    const newRedoStack = _redoStack.slice(0, -1);
    const newUndoStack = [..._undoStack, currentSnap];

    set({
      map: { ...map, nodes: nextSnap.nodes, links: nextSnap.links },
      _undoStack: newUndoStack,
      _redoStack: newRedoStack,
      canUndo: true,
      canRedo: newRedoStack.length > 0,
      matchedNodeIds: computeMatches(nextSnap.nodes, get().searchQuery, get().activeTypeFilters),
    });

    // Persist the revert so it sticks on the backend (positions + field diffs).
    try {
      await persistSnapshot(map.id, nextSnap, currentSnap);
    } catch (e) {
      // Same as undo: drop the failing entry so redo can't get stuck on it.
      if (get().map?.id === map.id) {
        set({
          map: { ...get().map!, nodes: currentSnap.nodes, links: currentSnap.links },
          _undoStack,
          _redoStack: newRedoStack,
          canUndo: _undoStack.length > 0,
          canRedo: newRedoStack.length > 0,
          matchedNodeIds: computeMatches(currentSnap.nodes, get().searchQuery, get().activeTypeFilters),
        });
      }
      toast.fromError(e, "Failed to redo");
      await get().refreshMap();
    }
  },

  // Align selected nodes to the selection bounding box (locked nodes skipped).
  alignNodes: async (direction) => {
    const { map, selectedNodeIds } = get();
    if (!map) return;

    const targets = map.nodes.filter(
      (n: MapNode) => selectedNodeIds.includes(n.id) && !isNodeLocked(n),
    );
    if (targets.length < 2) return;

    const snap = takeSnapshot(map);

    const ids = new Set(targets.map((n) => n.id));
    const minLeft = Math.min(...targets.map((n) => n.x));
    const maxRight = Math.max(...targets.map((n) => n.x + nodeW(n)));
    const minTop = Math.min(...targets.map((n) => n.y));
    const maxBot = Math.max(...targets.map((n) => n.y + nodeH(n)));
    const centerX = (minLeft + maxRight) / 2;
    const centerY = (minTop + maxBot) / 2;

    const place = (n: MapNode): Partial<MapNode> => {
      switch (direction) {
        case "left": return { x: minLeft };
        case "center": return { x: centerX - nodeW(n) / 2 };
        case "right": return { x: maxRight - nodeW(n) };
        case "top": return { y: minTop };
        case "middle": return { y: centerY - nodeH(n) / 2 };
        case "bottom": return { y: maxBot - nodeH(n) };
        default: return {};
      }
    };

    const updatedNodes = map.nodes.map((n: MapNode) =>
      ids.has(n.id) ? { ...n, ...place(n) } : n,
    );
    await commitMoves(set, get, snap, updatedNodes, ids, "align nodes");
  },

  // Center the selection bounding box on the canvas along one axis.
  alignToCanvas: async (axis) => {
    const { map, selectedNodeIds } = get();
    if (!map) return;
    const targets = map.nodes.filter(
      (n: MapNode) => selectedNodeIds.includes(n.id) && !isNodeLocked(n),
    );
    if (targets.length === 0) return;

    const snap = takeSnapshot(map);
    const ids = new Set(targets.map((n) => n.id));
    const horiz = axis === "horizontal";
    const size = horiz ? nodeW : nodeH;
    const coord = (n: MapNode) => (horiz ? n.x : n.y);
    const min = Math.min(...targets.map(coord));
    const max = Math.max(...targets.map((n) => coord(n) + size(n)));
    const canvasCenter = (horiz ? map.width : map.height) / 2;
    const delta = canvasCenter - (min + max) / 2;

    const updatedNodes = map.nodes.map((n: MapNode) =>
      ids.has(n.id)
        ? horiz
          ? { ...n, x: n.x + delta }
          : { ...n, y: n.y + delta }
        : n,
    );
    await commitMoves(set, get, snap, updatedNodes, ids, "center nodes on canvas");
  },

  // Match the width or height of selected nodes to the largest in the set.
  matchNodeSize: async (dim) => {
    const { map, selectedNodeIds } = get();
    if (!map) return;
    const targets = map.nodes.filter(
      (n: MapNode) =>
        selectedNodeIds.includes(n.id) && !isNodeLocked(n) && n.node_type !== "group",
    );
    if (targets.length < 2) return;
    const ref = Math.max(...targets.map((n) => (dim === "width" ? nodeW(n) : nodeH(n))));
    // bulkUpdateNodes handles the (post-success) undo snapshot + persistence.
    await get().bulkUpdateNodes(targets.map((n) => n.id), { [dim]: ref });
  },

  // Distribute selected nodes with equal EDGE gaps (locked nodes skipped).
  distributeNodes: async (axis) => {
    const { map, selectedNodeIds } = get();
    if (!map) return;

    const targets = map.nodes.filter(
      (n: MapNode) => selectedNodeIds.includes(n.id) && !isNodeLocked(n),
    );
    if (targets.length < 3) return;

    const snap = takeSnapshot(map);

    const horiz = axis === "horizontal";
    const size = horiz ? nodeW : nodeH;
    const coord = (n: MapNode) => (horiz ? n.x : n.y);
    const sorted = targets.toSorted((a, b) => coord(a) - coord(b));
    const spanStart = coord(sorted[0]);
    const last = sorted[sorted.length - 1];
    const spanEnd = coord(last) + size(last);
    const totalSize = sorted.reduce((s, n) => s + size(n), 0);
    // Equal gap between adjacent edges keeps first/last fixed; even with mixed
    // sizes the visible spacing between nodes is uniform.
    const gap = (spanEnd - spanStart - totalSize) / (sorted.length - 1);

    const positionMap = new Map<string, number>();
    let cursor = spanStart;
    for (const n of sorted) {
      positionMap.set(n.id, cursor);
      cursor += size(n) + gap;
    }

    const updatedNodes = map.nodes.map((n: MapNode) =>
      positionMap.has(n.id)
        ? horiz
          ? { ...n, x: positionMap.get(n.id)! }
          : { ...n, y: positionMap.get(n.id)! }
        : n,
    );
    await commitMoves(set, get, snap, updatedNodes, new Set(positionMap.keys()), "distribute nodes");
  },

  // Flip selected nodes (mirror positions; locked nodes skipped).
  flipNodes: async (axis) => {
    const { map, selectedNodeIds } = get();
    if (!map) return;

    const targets = map.nodes.filter(
      (n: MapNode) => selectedNodeIds.includes(n.id) && !isNodeLocked(n),
    );
    if (targets.length < 2) return;

    const snap = takeSnapshot(map);

    const ids = new Set(targets.map((n) => n.id));
    let updatedNodes: MapNode[];
    if (axis === "horizontal") {
      const centers = targets.map((n) => n.x + nodeW(n) / 2);
      const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
      updatedNodes = map.nodes.map((n: MapNode) =>
        ids.has(n.id) ? { ...n, x: 2 * mid - n.x - nodeW(n) } : n
      );
    } else {
      const centers = targets.map((n) => n.y + nodeH(n) / 2);
      const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
      updatedNodes = map.nodes.map((n: MapNode) =>
        ids.has(n.id) ? { ...n, y: 2 * mid - n.y - nodeH(n) } : n
      );
    }

    await commitMoves(set, get, snap, updatedNodes, ids, "flip nodes");
  },

  toggleSnapToGrid: () => set({ snapToGrid: !get().snapToGrid }),
  toggleSelectMode: () => set({ selectMode: !get().selectMode }),

  // Bound groups
  getBoundGroup: (nodeId) => {
    const { map } = get();
    const groups = map?.settings?.bound_groups || [];
    return groups.find((g) => g.includes(nodeId));
  },

  bindSelectedNodes: async () => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length < 2) return;

    const groups = [...(map.settings?.bound_groups || [])];

    // Merge selected nodes: if any are already in existing groups, merge those groups
    const touchedIndices = new Set<number>();
    for (const id of selectedNodeIds) {
      const idx = groups.findIndex((g) => g.includes(id));
      if (idx >= 0) touchedIndices.add(idx);
    }

    // Collect all node IDs from touched groups + selected
    const merged = new Set(selectedNodeIds);
    for (const idx of touchedIndices) {
      for (const id of groups[idx]) merged.add(id);
    }

    // Remove touched groups, add the merged one
    const remaining = groups.filter((_, i) => !touchedIndices.has(i));
    remaining.push([...merged]);

    const settings = { ...map.settings, bound_groups: remaining };
    await persistBoundGroups(set, get, settings, "bind nodes");
  },

  unbindSelectedNodes: async () => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length === 0) return;

    const groups = [...(map.settings?.bound_groups || [])];

    // Remove selected nodes from any groups they're in
    const updated = groups
      .map((g) => g.filter((id) => !selectedNodeIds.includes(id)))
      .filter((g) => g.length >= 2); // discard groups with <2 members

    const settings = { ...map.settings, bound_groups: updated };
    await persistBoundGroups(set, get, settings, "unbind nodes");
  },

  nudgeSelectedNodes: async (dx, dy) => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length === 0) return;

    const ids = new Set(
      map.nodes
        .filter((n: MapNode) => selectedNodeIds.includes(n.id) && !isNodeLocked(n))
        .map((n) => n.id),
    );
    if (ids.size === 0) return;

    const snap = takeSnapshot(map);
    const updatedNodes = map.nodes.map((n: MapNode) =>
      ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n
    );
    await commitMoves(set, get, snap, updatedNodes, ids, "move nodes");
  },

  // Apply a batch of new positions (drag stop, auto-layout) as a single undo snapshot.
  applyNodePositions: async (positions) => {
    const { map } = get();
    if (!map || positions.length === 0) return;
    const snap = takeSnapshot(map);
    const posMap = new Map(positions.map((p) => [p.id, p]));
    const updatedNodes = map.nodes.map((n: MapNode) => {
      const p = posMap.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    });
    const ids = new Set(map.nodes.filter((n) => posMap.has(n.id)).map((n) => n.id));
    await commitMoves(set, get, snap, updatedNodes, ids, "move nodes");
  },

  setTraffic: (data) => set({ traffic: data }),

  startTrafficPolling: () => {
    const { map, _pollTimer, _trafficAbort } = get();
    if (_pollTimer) clearInterval(_pollTimer);
    if (_trafficAbort) _trafficAbort.abort();
    if (!map) return;

    const pollMapId = map.id;
    const interval = (map.settings?.refresh_interval ?? 300) * 1000;

    const fetchTraffic = async () => {
      // Bail if the active map changed since this cycle was scheduled.
      if (get()._pollMapId !== pollMapId) return;

      // Abort any still-in-flight request from a previous cycle.
      const prev = get()._trafficAbort;
      if (prev) prev.abort();
      const controller = new AbortController();
      set({ _trafficAbort: controller });

      // Node status is polled alongside traffic but never flags the live-data
      // error: an older backend without the route (404) simply yields no status.
      const nodeStatusPoll = api
        .getNodeStatus(pollMapId, controller.signal)
        .then((ns) => {
          if (get()._pollMapId === pollMapId) set({ nodeStatus: ns });
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 404 && get()._pollMapId === pollMapId) {
            set({ nodeStatus: {} });
          }
          // Other failures (abort, transient): keep the last known status.
        });

      try {
        const data = await api.getLiveTraffic(pollMapId, controller.signal);
        // Ignore a late response for a map that is no longer active.
        if (get()._pollMapId !== pollMapId) return;
        set({ traffic: data, trafficError: false, lastTrafficAt: Date.now() });
      } catch (e) {
        // An abort is expected on map change/unmount — not a real error.
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (get()._pollMapId !== pollMapId) return;
        set({ trafficError: true });
      } finally {
        await nodeStatusPoll;
      }
    };

    set({ _pollMapId: pollMapId, trafficError: false });
    fetchTraffic();
    const timer = setInterval(fetchTraffic, Math.max(interval, 30000));
    set({ _pollTimer: timer });
  },

  stopTrafficPolling: () => {
    const { _pollTimer, _trafficAbort } = get();
    if (_pollTimer) clearInterval(_pollTimer);
    if (_trafficAbort) _trafficAbort.abort();
    set({ _pollTimer: null, _trafficAbort: null, _pollMapId: null });
  },
}));
