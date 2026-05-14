import { create } from "zustand";
import type { NetmapData, TrafficData, MapNode, MapLink, AlignDirection } from "@/types";
import { api, ApiError } from "@/api/client";

/** Snapshot of node positions for undo/redo */
type PosSnapshot = Array<{ id: string; x: number; y: number }>;

const MAX_UNDO = 50;

interface MapStore {
  // Data
  map: NetmapData | null;
  traffic: TrafficData;
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

  // Undo/redo
  _undoStack: PosSnapshot[];
  _redoStack: PosSnapshot[];
  canUndo: boolean;
  canRedo: boolean;

  // Backward-compat computed getters
  selectedNodeId: string | null;
  selectedLinkId: string | null;

  // Polling
  _pollTimer: ReturnType<typeof setInterval> | null;

  // Actions
  loadMap: (id: string) => Promise<void>;
  setEditMode: (on: boolean) => void;

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

  // Undo/redo
  pushUndo: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;

  // Traffic
  setTraffic: (data: TrafficData) => void;
  startTrafficPolling: () => void;
  stopTrafficPolling: () => void;
}

function getPositions(nodes: MapNode[]): PosSnapshot {
  return nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
}

function applyPositions(nodes: MapNode[], snap: PosSnapshot): MapNode[] {
  const posMap = new Map(snap.map((s) => [s.id, s]));
  return nodes.map((n) => {
    const p = posMap.get(n.id);
    return p ? { ...n, x: p.x, y: p.y } : n;
  });
}

export const useMapStore = create<MapStore>((set, get) => ({
  map: null,
  traffic: {},
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
  _pollTimer: null,
  _undoStack: [],
  _redoStack: [],
  canUndo: false,
  canRedo: false,

  loadMap: async (id: string) => {
    set({ loading: true, error: null, errorStatus: null });
    try {
      const data = await api.getMap(id);
      set({ map: data, loading: false, _undoStack: [], _redoStack: [], canUndo: false, canRedo: false });
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

    // Save current node state for rollback
    const previousNodes = map.nodes;

    // Optimistically update local state
    set({
      map: {
        ...map,
        nodes: map.nodes.map((n: MapNode) =>
          n.id === nodeId ? { ...n, ...fields } : n
        ),
      },
      saving: true,
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
    const snap = getPositions(map.nodes);
    const newStack = [..._undoStack, snap].slice(-MAX_UNDO);
    set({ _undoStack: newStack, _redoStack: [], canUndo: true, canRedo: false });
  },

  undo: async () => {
    const { map, _undoStack, _redoStack } = get();
    if (!map || _undoStack.length === 0) return;

    const currentSnap = getPositions(map.nodes);
    const prevSnap = _undoStack[_undoStack.length - 1];
    const newUndoStack = _undoStack.slice(0, -1);
    const newRedoStack = [..._redoStack, currentSnap];

    const updatedNodes = applyPositions(map.nodes, prevSnap);
    set({
      map: { ...map, nodes: updatedNodes },
      _undoStack: newUndoStack,
      _redoStack: newRedoStack,
      canUndo: newUndoStack.length > 0,
      canRedo: true,
    });

    // Sync to backend
    const moves = prevSnap;
    await api.batchMoveNodes(map.id, moves);
  },

  redo: async () => {
    const { map, _undoStack, _redoStack } = get();
    if (!map || _redoStack.length === 0) return;

    const currentSnap = getPositions(map.nodes);
    const nextSnap = _redoStack[_redoStack.length - 1];
    const newRedoStack = _redoStack.slice(0, -1);
    const newUndoStack = [..._undoStack, currentSnap];

    const updatedNodes = applyPositions(map.nodes, nextSnap);
    set({
      map: { ...map, nodes: updatedNodes },
      _undoStack: newUndoStack,
      _redoStack: newRedoStack,
      canUndo: true,
      canRedo: newRedoStack.length > 0,
    });

    // Sync to backend
    const moves = nextSnap;
    await api.batchMoveNodes(map.id, moves);
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

  setTraffic: (data) => set({ traffic: data }),

  startTrafficPolling: () => {
    const { map, _pollTimer } = get();
    if (_pollTimer) clearInterval(_pollTimer);
    if (!map) return;

    const interval = (map.settings?.refresh_interval ?? 300) * 1000;

    const fetchTraffic = async () => {
      const { map: currentMap } = get();
      if (!currentMap) return;
      try {
        const data = await api.getLiveTraffic(currentMap.id);
        set({ traffic: data });
      } catch {
        // Silently fail on traffic fetch errors — map stays usable
      }
    };

    fetchTraffic();
    const timer = setInterval(fetchTraffic, Math.max(interval, 30000));
    set({ _pollTimer: timer });
  },

  stopTrafficPolling: () => {
    const { _pollTimer } = get();
    if (_pollTimer) {
      clearInterval(_pollTimer);
      set({ _pollTimer: null });
    }
  },
}));
