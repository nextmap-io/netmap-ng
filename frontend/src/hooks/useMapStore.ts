import { create } from "zustand";
import type { NetmapData, TrafficData, MapNode, MapLink, AlignDirection } from "@/types";
import { api } from "@/api/client";

interface MapStore {
  // Data
  map: NetmapData | null;
  traffic: TrafficData;
  loading: boolean;
  error: string | null;

  // Editor state
  editMode: boolean;
  selectedNodeIds: string[];
  selectedLinkIds: string[];
  snapToGrid: boolean;
  saving: boolean;
  lastSaved: number | null;

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
  toggleSnapToGrid: () => void;

  // Positions
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  saveNodePositions: () => Promise<void>;

  // Traffic
  setTraffic: (data: TrafficData) => void;
  startTrafficPolling: () => void;
  stopTrafficPolling: () => void;
}

export const useMapStore = create<MapStore>((set, get) => ({
  map: null,
  traffic: {},
  loading: false,
  error: null,
  editMode: false,
  selectedNodeIds: [],
  selectedLinkIds: [],
  selectedNodeId: null,
  selectedLinkId: null,
  snapToGrid: false,
  saving: false,
  lastSaved: null,
  _pollTimer: null,

  loadMap: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const data = await api.getMap(id);
      set({ map: data, loading: false });
      // Start traffic polling after map loads
      get().startTrafficPolling();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load map";
      set({ error: message, loading: false });
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

  // Align selected nodes
  alignNodes: async (direction) => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length < 2) return;

    const selectedNodes = map.nodes.filter((n: MapNode) =>
      selectedNodeIds.includes(n.id)
    );
    if (selectedNodes.length < 2) return;

    let updatedNodes: MapNode[];

    // Helper: get the reference node
    // For horizontal ops (left/center/right): reference = topmost node (smallest Y)
    // For vertical ops (top/middle/bottom): reference = leftmost node (smallest X)
    const nw = (n: MapNode) => n.width || 100;
    const nh = (n: MapNode) => n.height || 28;
    const refByY = [...selectedNodes].sort((a, b) => a.y - b.y)[0]; // topmost
    const refByX = [...selectedNodes].sort((a, b) => a.x - b.x)[0]; // leftmost

    switch (direction) {
      case "left": {
        // Align left edges to the reference (topmost) node's X
        const refX = refByY.x;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, x: refX } : n
        );
        break;
      }
      case "center": {
        // Align centers to the reference (topmost) node's center X
        const refCenterX = refByY.x + nw(refByY) / 2;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, x: refCenterX - nw(n) / 2 } : n
        );
        break;
      }
      case "right": {
        // Align right edges to the reference (topmost) node's right edge
        const refRight = refByY.x + nw(refByY);
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, x: refRight - nw(n) } : n
        );
        break;
      }
      case "top": {
        // Align top edges to the reference (leftmost) node's Y
        const refY = refByX.y;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, y: refY } : n
        );
        break;
      }
      case "middle": {
        // Align vertical centers to the reference (leftmost) node's center Y
        const refMiddleY = refByX.y + nh(refByX) / 2;
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, y: refMiddleY - nh(n) / 2 } : n
        );
        break;
      }
      case "bottom": {
        // Align bottom edges to the reference (leftmost) node's bottom edge
        const refBottom = refByX.y + nh(refByX);
        updatedNodes = map.nodes.map((n: MapNode) =>
          selectedNodeIds.includes(n.id) ? { ...n, y: refBottom - nh(n) } : n
        );
        break;
      }
    }

    // Update local state
    set({ map: { ...map, nodes: updatedNodes } });

    // Batch move via API
    const moves = updatedNodes
      .filter((n: MapNode) => selectedNodeIds.includes(n.id))
      .map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    await api.batchMoveNodes(map.id, moves);
  },

  // Distribute selected nodes with equal spacing
  distributeNodes: async (axis) => {
    const { map, selectedNodeIds } = get();
    if (!map || selectedNodeIds.length < 3) return;

    const selectedNodes = map.nodes.filter((n: MapNode) =>
      selectedNodeIds.includes(n.id)
    );
    if (selectedNodes.length < 3) return;

    let updatedNodes: MapNode[];

    if (axis === "horizontal") {
      const nw = (n: MapNode) => n.width || 100;
      const sorted = [...selectedNodes].sort((a, b) => (a.x + nw(a)/2) - (b.x + nw(b)/2));
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
      const sorted = [...selectedNodes].sort((a, b) => (a.y + nh(a)/2) - (b.y + nh(b)/2));
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

    // Update local state
    set({ map: { ...map, nodes: updatedNodes } });

    // Batch move via API
    const moves = updatedNodes
      .filter((n: MapNode) => selectedNodeIds.includes(n.id))
      .map((n: MapNode) => ({ id: n.id, x: n.x, y: n.y }));
    await api.batchMoveNodes(map.id, moves);
  },

  toggleSnapToGrid: () => set({ snapToGrid: !get().snapToGrid }),

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

    // Fetch immediately, then on interval
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
