import { create } from "zustand";
import type { NetmapData, TrafficData, MapNode, MapLink, AlignDirection } from "@/types";
import { api, ApiError } from "@/api/client";
import { logError } from "@/lib/log";

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

  // Polling / abort
  _pollTimer: ReturnType<typeof setInterval> | null;
  _abortController: AbortController | null;

  // Per-id edit queues (chained promises so newer writes never get rolled back by older ones)
  _nodeEditQueue: Map<string, Promise<unknown>>;
  _linkEditQueue: Map<string, Promise<unknown>>;

  // Actions
  loadMap: (id: string) => Promise<void>;
  setEditMode: (on: boolean) => void;
  setError: (msg: string | null) => void;

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
  toggleSnapToGrid: () => void;
  toggleSelectMode: () => void;

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

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
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
  _abortController: null,
  _nodeEditQueue: new Map(),
  _linkEditQueue: new Map(),
  _undoStack: [],
  _redoStack: [],
  canUndo: false,
  canRedo: false,

  setError: (msg) => set({ error: msg }),

  loadMap: async (id: string) => {
    // Abort any in-flight traffic fetch from a previous map load.
    const prevAbort = get()._abortController;
    if (prevAbort) prevAbort.abort();
    const controller = new AbortController();

    set({ loading: true, error: null, errorStatus: null, _abortController: controller });
    try {
      const data = await api.getMap(id);
      set({
        map: data,
        loading: false,
        _undoStack: [],
        _redoStack: [],
        canUndo: false,
        canRedo: false,
      });
      // Start traffic polling after map loads
      get().startTrafficPolling();
    } catch (e: unknown) {
      const message = errorMessage(e, "Failed to load map");
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
    selectedNodeIds: ids,
    selectedLinkIds: [],
    selectedNodeId: ids.length === 1 ? ids[0] ?? null : null,
    selectedLinkId: null,
  }),
  selectLinks: (ids) => set({
    selectedLinkIds: ids,
    selectedNodeIds: [],
    selectedLinkId: ids.length === 1 ? ids[0] ?? null : null,
    selectedNodeId: null,
  }),
  clearSelection: () => set({
    selectedNodeIds: [], selectedLinkIds: [],
    selectedNodeId: null, selectedLinkId: null,
  }),

  // Optimistic node field update — chained per-node so concurrent edits don't roll back newer writes.
  updateNodeField: async (nodeId, fields) => {
    const { map, _nodeEditQueue } = get();
    if (!map) return;

    // Optimistically update local state. Capture the *current* node state BEFORE mutating
    // so a rollback restores only this node, leaving other concurrent changes intact.
    const previousNode = map.nodes.find((n) => n.id === nodeId);
    set({
      map: {
        ...map,
        nodes: map.nodes.map((n: MapNode) =>
          n.id === nodeId ? { ...n, ...fields } : n,
        ),
      },
      saving: true,
    });

    const prev = _nodeEditQueue.get(nodeId) ?? Promise.resolve();
    const next = prev.then(async () => {
      try {
        await api.updateNode(map.id, nodeId, fields);
        set({ saving: false, lastSaved: Date.now() });
      } catch (e) {
        // Roll back this single node only.
        const cur = get().map;
        if (cur && previousNode) {
          set({
            map: {
              ...cur,
              nodes: cur.nodes.map((n) => (n.id === nodeId ? previousNode : n)),
            },
            saving: false,
            error: errorMessage(e, "Failed to update node"),
          });
        } else {
          set({ saving: false, error: errorMessage(e, "Failed to update node") });
        }
        logError(e, { where: "updateNodeField", nodeId });
      }
    });
    _nodeEditQueue.set(nodeId, next);
    try {
      await next;
    } finally {
      // Drop the entry once it's fully resolved (only if it's still the latest).
      if (_nodeEditQueue.get(nodeId) === next) _nodeEditQueue.delete(nodeId);
    }
  },

  // Optimistic link field update — chained per-link.
  updateLinkField: async (linkId, fields) => {
    const { map, _linkEditQueue } = get();
    if (!map) return;

    const previousLink = map.links.find((l) => l.id === linkId);
    set({
      map: {
        ...map,
        links: map.links.map((l: MapLink) =>
          l.id === linkId ? { ...l, ...fields } : l,
        ),
      },
      saving: true,
    });

    const prev = _linkEditQueue.get(linkId) ?? Promise.resolve();
    const next = prev.then(async () => {
      try {
        await api.updateLink(map.id, linkId, fields);
        set({ saving: false, lastSaved: Date.now() });
      } catch (e) {
        const cur = get().map;
        if (cur && previousLink) {
          set({
            map: {
              ...cur,
              links: cur.links.map((l) => (l.id === linkId ? previousLink : l)),
            },
            saving: false,
            error: errorMessage(e, "Failed to update link"),
          });
        } else {
          set({ saving: false, error: errorMessage(e, "Failed to update link") });
        }
        logError(e, { where: "updateLinkField", linkId });
      }
    });
    _linkEditQueue.set(linkId, next);
    try {
      await next;
    } finally {
      if (_linkEditQueue.get(linkId) === next) _linkEditQueue.delete(linkId);
    }
  },

  // Optimistically delete the node + dependent links, roll back on API failure.
  deleteNode: async (nodeId) => {
    const { map } = get();
    if (!map) return;
    const previousNodes = map.nodes;
    const previousLinks = map.links;
    set({
      map: {
        ...map,
        nodes: map.nodes.filter((n) => n.id !== nodeId),
        links: map.links.filter((l) => l.source_id !== nodeId && l.target_id !== nodeId),
      },
    });
    try {
      await api.deleteNode(map.id, nodeId);
      await get().loadMap(map.id);
    } catch (e) {
      // Roll back
      const cur = get().map;
      if (cur) set({ map: { ...cur, nodes: previousNodes, links: previousLinks } });
      set({ error: errorMessage(e, "Failed to delete node") });
      logError(e, { where: "deleteNode", nodeId });
    }
  },

  // Optimistically delete the link, roll back on API failure.
  deleteLink: async (linkId) => {
    const { map } = get();
    if (!map) return;
    const previousLinks = map.links;
    set({
      map: { ...map, links: map.links.filter((l) => l.id !== linkId) },
    });
    try {
      await api.deleteLink(map.id, linkId);
      await get().loadMap(map.id);
    } catch (e) {
      const cur = get().map;
      if (cur) set({ map: { ...cur, links: previousLinks } });
      set({ error: errorMessage(e, "Failed to delete link") });
      logError(e, { where: "deleteLink", linkId });
    }
  },

  // Create link — server-authoritative; reload on success, surface error on failure.
  createLink: async (data) => {
    const { map } = get();
    if (!map) return;
    try {
      await api.createLink(map.id, data);
      await get().loadMap(map.id);
    } catch (e) {
      set({ error: errorMessage(e, "Failed to create link") });
      logError(e, { where: "createLink", mapId: map.id });
      throw e;
    }
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
    if (!prevSnap) return;
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

    try {
      await api.batchMoveNodes(map.id, prevSnap);
    } catch (e) {
      // Roll back the local state to before undo
      set({
        map: { ...map, nodes: applyPositions(map.nodes, currentSnap) },
        _undoStack: _undoStack,
        _redoStack: _redoStack,
        canUndo: _undoStack.length > 0,
        canRedo: _redoStack.length > 0,
        error: errorMessage(e, "Failed to undo"),
      });
      logError(e, { where: "undo", mapId: map.id });
    }
  },

  redo: async () => {
    const { map, _undoStack, _redoStack } = get();
    if (!map || _redoStack.length === 0) return;

    const currentSnap = getPositions(map.nodes);
    const nextSnap = _redoStack[_redoStack.length - 1];
    if (!nextSnap) return;
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

    try {
      await api.batchMoveNodes(map.id, nextSnap);
    } catch (e) {
      set({
        map: { ...map, nodes: applyPositions(map.nodes, currentSnap) },
        _undoStack: _undoStack,
        _redoStack: _redoStack,
        canUndo: _undoStack.length > 0,
        canRedo: _redoStack.length > 0,
        error: errorMessage(e, "Failed to redo"),
      });
      logError(e, { where: "redo", mapId: map.id });
    }
  },

  // Align selected nodes
  alignNodes: async (direction) => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length < 2) return;

    // Save the pre-align state for rollback
    const previousNodes = map.nodes;

    // Push undo before aligning
    get().pushUndo();

    const selectedNodes = map.nodes.filter((n: MapNode) =>
      selectedNodeIds.includes(n.id),
    );
    if (selectedNodes.length < 2) return;

    let updatedNodes: MapNode[];

    const nw = (n: MapNode) => n.width || 100;
    const nh = (n: MapNode) => n.height || 28;
    const sortedByY = [...selectedNodes].sort((a, b) => a.y - b.y);
    const sortedByX = [...selectedNodes].sort((a, b) => a.x - b.x);
    const refByY = sortedByY[0];
    const refByX = sortedByX[0];
    if (!refByY || !refByX) return;

    switch (direction) {
      case "left": {
        const refX = refByX.x;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, x: refX } : n,
        );
        break;
      }
      case "center": {
        const refCenterX = refByX.x + nw(refByX) / 2;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, x: refCenterX - nw(n) / 2 } : n,
        );
        break;
      }
      case "right": {
        const refRight = [...selectedNodes].sort((a, b) => (a.x + nw(a)) - (b.x + nw(b))).pop();
        if (!refRight) return;
        const rightEdge = refRight.x + nw(refRight);
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, x: rightEdge - nw(n) } : n,
        );
        break;
      }
      case "top": {
        const refY = refByY.y;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, y: refY } : n,
        );
        break;
      }
      case "middle": {
        const refMiddleY = refByY.y + nh(refByY) / 2;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, y: refMiddleY - nh(n) / 2 } : n,
        );
        break;
      }
      case "bottom": {
        const refBot = [...selectedNodes].sort((a, b) => (a.y + nh(a)) - (b.y + nh(b))).pop();
        if (!refBot) return;
        const bottomEdge = refBot.y + nh(refBot);
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, y: bottomEdge - nh(n) } : n,
        );
        break;
      }
    }

    set({ map: { ...map, nodes: updatedNodes } });

    const moves = updatedNodes
      .filter((n: MapNode) => selectedNodeIds.includes(n.id))
      .map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    try {
      await api.batchMoveNodes(map.id, moves);
    } catch (e) {
      // Roll back to pre-align state
      const cur = get().map;
      if (cur) set({ map: { ...cur, nodes: previousNodes } });
      set({ error: errorMessage(e, "Failed to align nodes") });
      logError(e, { where: "alignNodes", direction });
    }
  },

  // Distribute selected nodes with equal spacing
  distributeNodes: async (axis) => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length < 3) return;

    const previousNodes = map.nodes;

    // Push undo before distributing
    get().pushUndo();

    const selectedNodes = map.nodes.filter((n: MapNode) =>
      selectedNodeIds.includes(n.id),
    );
    if (selectedNodes.length < 3) return;

    let updatedNodes: MapNode[];

    if (axis === "horizontal") {
      const nw = (n: MapNode) => n.width || 100;
      const sorted = [...selectedNodes].sort((a, b) => (a.x + nw(a) / 2) - (b.x + nw(b) / 2));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (!first || !last) return;
      const firstCenter = first.x + nw(first) / 2;
      const lastCenter = last.x + nw(last) / 2;
      const step = (lastCenter - firstCenter) / (sorted.length - 1);

      const positionMap = new Map<string, number>();
      sorted.forEach((n, i) => {
        const newCenter = firstCenter + i * step;
        positionMap.set(n.id, newCenter - nw(n) / 2);
      });

      updatedNodes = map.nodes.map((n: MapNode) => {
        const x = positionMap.get(n.id);
        return x !== undefined ? { ...n, x } : n;
      });
    } else {
      const nh = (n: MapNode) => n.height || 28;
      const sorted = [...selectedNodes].sort((a, b) => (a.y + nh(a) / 2) - (b.y + nh(b) / 2));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (!first || !last) return;
      const firstCenter = first.y + nh(first) / 2;
      const lastCenter = last.y + nh(last) / 2;
      const step = (lastCenter - firstCenter) / (sorted.length - 1);

      const positionMap = new Map<string, number>();
      sorted.forEach((n, i) => {
        const newCenter = firstCenter + i * step;
        positionMap.set(n.id, newCenter - nh(n) / 2);
      });

      updatedNodes = map.nodes.map((n: MapNode) => {
        const y = positionMap.get(n.id);
        return y !== undefined ? { ...n, y } : n;
      });
    }

    set({ map: { ...map, nodes: updatedNodes } });

    const moves = updatedNodes
      .filter((n: MapNode) => selectedNodeIds.includes(n.id))
      .map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    try {
      await api.batchMoveNodes(map.id, moves);
    } catch (e) {
      const cur = get().map;
      if (cur) set({ map: { ...cur, nodes: previousNodes } });
      set({ error: errorMessage(e, "Failed to distribute nodes") });
      logError(e, { where: "distributeNodes", axis });
    }
  },

  toggleSnapToGrid: () => set({ snapToGrid: !get().snapToGrid }),
  toggleSelectMode: () => set({ selectMode: !get().selectMode }),

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

    const previousNodes = map.nodes;
    get().pushUndo();

    const updatedNodes = map.nodes.map((n: MapNode) =>
      selectedNodeIds.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n,
    );

    set({ map: { ...map, nodes: updatedNodes } });

    const moves = updatedNodes
      .filter((n: MapNode) => selectedNodeIds.includes(n.id))
      .map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    try {
      await api.batchMoveNodes(map.id, moves);
    } catch (e) {
      const cur = get().map;
      if (cur) set({ map: { ...cur, nodes: previousNodes } });
      set({ error: errorMessage(e, "Failed to move nodes") });
      logError(e, { where: "nudgeSelectedNodes" });
    }
  },

  saveNodePositions: async () => {
    const { map } = get();
    if (!map) return;
    const moves = map.nodes.map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    try {
      await api.batchMoveNodes(map.id, moves);
    } catch (e) {
      set({ error: errorMessage(e, "Failed to save positions") });
      logError(e, { where: "saveNodePositions" });
    }
  },

  setTraffic: (data) => set({ traffic: data }),

  startTrafficPolling: () => {
    const { map, _pollTimer, _abortController } = get();
    if (_pollTimer) clearInterval(_pollTimer);
    if (!map) return;

    // Abort any in-flight traffic fetch from a previous poll cycle.
    if (_abortController) _abortController.abort();
    const controller = new AbortController();
    set({ _abortController: controller });

    const interval = (map.settings?.refresh_interval ?? 300) * 1000;

    const fetchTraffic = async () => {
      const { map: currentMap, _abortController: ac } = get();
      if (!currentMap) return;
      // If a newer abort controller has replaced ours, bail.
      if (ac !== controller || controller.signal.aborted) return;
      try {
        const data = await api.getLiveTraffic(currentMap.id);
        if (controller.signal.aborted) return;
        set({ traffic: data });
      } catch (e) {
        // Silently fail on traffic fetch errors — map stays usable, but record in dev.
        if (!controller.signal.aborted) logError(e, { where: "fetchTraffic" });
      }
    };

    fetchTraffic();
    const timer = setInterval(fetchTraffic, Math.max(interval, 30000));
    set({ _pollTimer: timer });
  },

  stopTrafficPolling: () => {
    const { _pollTimer, _abortController } = get();
    if (_pollTimer) {
      clearInterval(_pollTimer);
      set({ _pollTimer: null });
    }
    if (_abortController) {
      _abortController.abort();
      set({ _abortController: null });
    }
  },
}));
