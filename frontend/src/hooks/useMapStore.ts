import { create } from "zustand";
import type { NetmapData, TrafficData, MapNode, MapLink, NodeType, AlignDirection } from "@/types";
import { api, ApiError } from "@/api/client";

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
  loadMap: (id: string) => Promise<void>;
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

  // Layout
  alignNodes: (direction: AlignDirection) => Promise<void>;
  distributeNodes: (axis: "horizontal" | "vertical") => Promise<void>;
  flipNodes: (axis: "horizontal" | "vertical") => Promise<void>;
  toggleSnapToGrid: () => void;
  toggleSelectMode: () => void;

  // Bound groups (move together)
  getBoundGroup: (nodeId: string) => string[] | undefined;
  bindSelectedNodes: () => Promise<void>;
  unbindSelectedNodes: () => Promise<void>;

  // Positions
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  nudgeSelectedNodes: (dx: number, dy: number) => Promise<void>;
  saveNodePositions: () => Promise<void>;
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

  loadMap: async (id: string) => {
    set({ loading: true, error: null, errorStatus: null });
    try {
      const data = await api.getMap(id);
      const { searchQuery, activeTypeFilters } = get();
      set({
        map: data,
        loading: false,
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

    // Capture full state for undo before mutating
    get().pushUndo();

    // Save current node state for rollback
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
      set({ saving: false, lastSaved: Date.now() });
    } catch {
      // Revert to saved state
      set({
        map: { ...get().map!, nodes: previousNodes },
        saving: false,
      });
    }
  },

  // Optimistic link field update
  updateLinkField: async (linkId, fields) => {
    const { map } = get();
    if (!map) return;

    // Capture full state for undo before mutating
    get().pushUndo();

    // Save current link state for rollback
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
      set({ saving: false, lastSaved: Date.now() });
    } catch {
      // Revert to saved state
      set({
        map: { ...get().map!, links: previousLinks },
        saving: false,
      });
    }
  },

  // Bulk update multiple nodes at once (single undo snapshot, optimistic).
  bulkUpdateNodes: async (ids, fields) => {
    const { map } = get();
    if (!map || ids.length === 0) return;

    get().pushUndo();
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
      set({ saving: false, lastSaved: Date.now() });
    } catch {
      set({ map: { ...get().map!, nodes: previousNodes }, saving: false });
    }
  },

  // Bulk update multiple links at once (single undo snapshot, optimistic).
  bulkUpdateLinks: async (ids, fields) => {
    const { map } = get();
    if (!map || ids.length === 0) return;

    get().pushUndo();
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
      set({ saving: false, lastSaved: Date.now() });
    } catch {
      set({ map: { ...get().map!, links: previousLinks }, saving: false });
    }
  },

  // Delete node and reload map
  deleteNode: async (nodeId) => {
    const { map } = get();
    if (!map) return;
    await api.deleteNode(map.id, nodeId);
    await get().loadMap(map.id);
  },

  // Delete link and reload map
  deleteLink: async (linkId) => {
    const { map } = get();
    if (!map) return;
    await api.deleteLink(map.id, linkId);
    await get().loadMap(map.id);
  },

  // Create link and reload map
  createLink: async (data) => {
    const { map } = get();
    if (!map) return;
    await api.createLink(map.id, data);
    await get().loadMap(map.id);
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
    const prevSnap = _undoStack[_undoStack.length - 1];
    const newUndoStack = _undoStack.slice(0, -1);
    const newRedoStack = [..._redoStack, currentSnap];

    set({
      map: { ...map, nodes: cloneMap(prevSnap.nodes), links: cloneMap(prevSnap.links) },
      _undoStack: newUndoStack,
      _redoStack: newRedoStack,
      canUndo: newUndoStack.length > 0,
      canRedo: true,
      matchedNodeIds: computeMatches(prevSnap.nodes, get().searchQuery, get().activeTypeFilters),
    });

    // Persist the revert so it sticks on the backend (positions + field diffs).
    await persistSnapshot(map.id, prevSnap, currentSnap);
  },

  redo: async () => {
    const { map, _undoStack, _redoStack } = get();
    if (!map || _redoStack.length === 0) return;

    const currentSnap = takeSnapshot(map);
    const nextSnap = _redoStack[_redoStack.length - 1];
    const newRedoStack = _redoStack.slice(0, -1);
    const newUndoStack = [..._undoStack, currentSnap];

    set({
      map: { ...map, nodes: cloneMap(nextSnap.nodes), links: cloneMap(nextSnap.links) },
      _undoStack: newUndoStack,
      _redoStack: newRedoStack,
      canUndo: true,
      canRedo: newRedoStack.length > 0,
      matchedNodeIds: computeMatches(nextSnap.nodes, get().searchQuery, get().activeTypeFilters),
    });

    // Persist the revert so it sticks on the backend (positions + field diffs).
    await persistSnapshot(map.id, nextSnap, currentSnap);
  },

  // Align selected nodes
  alignNodes: async (direction) => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length < 2) return;

    // Push undo before aligning
    get().pushUndo();

    const selectedNodes = map.nodes.filter((n: MapNode) =>
      selectedNodeIds.includes(n.id)
    );
    if (selectedNodes.length < 2) return;

    let updatedNodes: MapNode[];

    const nw = (n: MapNode) => n.width || 100;
    const nh = (n: MapNode) => n.height || 28;
    const refByY = selectedNodes.reduce((min, n) => (n.y < min.y ? n : min));
    const refByX = selectedNodes.reduce((min, n) => (n.x < min.x ? n : min));

    switch (direction) {
      case "left": {
        const refX = refByX.x;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, x: refX } : n
        );
        break;
      }
      case "center": {
        const refCenterX = refByX.x + nw(refByX) / 2;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, x: refCenterX - nw(n) / 2 } : n
        );
        break;
      }
      case "right": {
        const refRight = selectedNodes.reduce((max, n) =>
          n.x + nw(n) > max.x + nw(max) ? n : max,
        );
        const rightEdge = refRight.x + nw(refRight);
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, x: rightEdge - nw(n) } : n
        );
        break;
      }
      case "top": {
        const refY = refByY.y;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, y: refY } : n
        );
        break;
      }
      case "middle": {
        const refMiddleY = refByY.y + nh(refByY) / 2;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, y: refMiddleY - nh(n) / 2 } : n
        );
        break;
      }
      case "bottom": {
        const refBot = selectedNodes.reduce((max, n) =>
          n.y + nh(n) > max.y + nh(max) ? n : max,
        );
        const bottomEdge = refBot.y + nh(refBot);
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, y: bottomEdge - nh(n) } : n
        );
        break;
      }
    }

    set({ map: { ...map, nodes: updatedNodes } });

    const moves = updatedNodes
      .filter((n: MapNode) => selectedNodeIds.includes(n.id))
      .map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    await api.batchMoveNodes(map.id, moves);
  },

  // Distribute selected nodes with equal spacing
  distributeNodes: async (axis) => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length < 3) return;

    // Push undo before distributing
    get().pushUndo();

    const selectedNodes = map.nodes.filter((n: MapNode) =>
      selectedNodeIds.includes(n.id)
    );
    if (selectedNodes.length < 3) return;

    let updatedNodes: MapNode[];

    if (axis === "horizontal") {
      const nw = (n: MapNode) => n.width || 100;
      const sorted = selectedNodes.toSorted((a, b) => (a.x + nw(a)/2) - (b.x + nw(b)/2));
      const firstCenter = sorted[0].x + nw(sorted[0]) / 2;
      const lastCenter = sorted[sorted.length - 1].x + nw(sorted[sorted.length - 1]) / 2;
      const step = (lastCenter - firstCenter) / (sorted.length - 1);

      const positionMap = new Map<string, number>();
      sorted.forEach((n, i) => {
        const newCenter = firstCenter + i * step;
        positionMap.set(n.id, newCenter - nw(n) / 2);
      });

      updatedNodes = map.nodes.map((n: MapNode) =>
        positionMap.has(n.id) ? { ...n, x: positionMap.get(n.id)! } : n
      );
    } else {
      const nh = (n: MapNode) => n.height || 28;
      const sorted = selectedNodes.toSorted((a, b) => (a.y + nh(a)/2) - (b.y + nh(b)/2));
      const firstCenter = sorted[0].y + nh(sorted[0]) / 2;
      const lastCenter = sorted[sorted.length - 1].y + nh(sorted[sorted.length - 1]) / 2;
      const step = (lastCenter - firstCenter) / (sorted.length - 1);

      const positionMap = new Map<string, number>();
      sorted.forEach((n, i) => {
        const newCenter = firstCenter + i * step;
        positionMap.set(n.id, newCenter - nh(n) / 2);
      });

      updatedNodes = map.nodes.map((n: MapNode) =>
        positionMap.has(n.id) ? { ...n, y: positionMap.get(n.id)! } : n
      );
    }

    set({ map: { ...map, nodes: updatedNodes } });

    const moves = updatedNodes
      .filter((n: MapNode) => selectedNodeIds.includes(n.id))
      .map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    await api.batchMoveNodes(map.id, moves);
  },

  // Flip selected nodes (mirror positions)
  flipNodes: async (axis) => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length < 2) return;

    get().pushUndo();

    const selected = map.nodes.filter((n: MapNode) => selectedNodeIds.includes(n.id));
    const nw = (n: MapNode) => n.width || 100;
    const nh = (n: MapNode) => n.height || 28;

    let updatedNodes: MapNode[];
    if (axis === "horizontal") {
      const centers = selected.map((n) => n.x + nw(n) / 2);
      const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
      updatedNodes = map.nodes.map((n: MapNode) =>
        selectedNodeIds.includes(n.id) ? { ...n, x: 2 * mid - n.x - nw(n) } : n
      );
    } else {
      const centers = selected.map((n) => n.y + nh(n) / 2);
      const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
      updatedNodes = map.nodes.map((n: MapNode) =>
        selectedNodeIds.includes(n.id) ? { ...n, y: 2 * mid - n.y - nh(n) } : n
      );
    }

    set({ map: { ...map, nodes: updatedNodes } });
    const moves = updatedNodes
      .filter((n: MapNode) => selectedNodeIds.includes(n.id))
      .map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    await api.batchMoveNodes(map.id, moves);
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
    set({ map: { ...map, settings } });
    await api.updateMap(map.id, { settings });
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
    set({ map: { ...map, settings } });
    await api.updateMap(map.id, { settings });
  },

  updateNodePosition: (nodeId, x, y) => {
    const { map } = get();
    if (!map) return;
    set({
      map: {
        ...map,
        nodes: map.nodes.map((n: MapNode) => (n.id === nodeId ? { ...n, x, y } : n)),
      },
    });
  },

  nudgeSelectedNodes: async (dx, dy) => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length === 0) return;

    get().pushUndo();

    const updatedNodes = map.nodes.map((n: MapNode) =>
      selectedNodeIds.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n
    );

    set({ map: { ...map, nodes: updatedNodes } });

    const moves = updatedNodes
      .filter((n: MapNode) => selectedNodeIds.includes(n.id))
      .map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    await api.batchMoveNodes(map.id, moves);
  },

  saveNodePositions: async () => {
    const { map } = get();
    if (!map) return;
    const moves = map.nodes.map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    await api.batchMoveNodes(map.id, moves);
  },

  // Apply a batch of new positions (auto-layout) as a single undo snapshot.
  applyNodePositions: async (positions) => {
    const { map } = get();
    if (!map || positions.length === 0) return;
    get().pushUndo();
    const posMap = new Map(positions.map((p) => [p.id, p]));
    const updatedNodes = map.nodes.map((n: MapNode) => {
      const p = posMap.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    });
    set({ map: { ...map, nodes: updatedNodes } });
    const moves = positions.map((p) => ({ id: p.id, x: p.x, y: p.y }));
    await api.batchMoveNodes(map.id, moves);
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

      try {
        const data = await api.getLiveTraffic(pollMapId, controller.signal);
        // Ignore a late response for a map that is no longer active.
        if (get()._pollMapId !== pollMapId) return;
        set({ traffic: data, trafficError: false });
      } catch (e) {
        // An abort is expected on map change/unmount — not a real error.
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (get()._pollMapId !== pollMapId) return;
        set({ trafficError: true });
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
