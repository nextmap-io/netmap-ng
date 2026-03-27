import { create } from "zustand";
import type { NetmapData, TrafficData, MapNode } from "@/types";
import { api } from "@/api/client";

interface MapStore {
  // Data
  map: NetmapData | null;
  traffic: TrafficData;
  loading: boolean;
  error: string | null;

  // Editor state
  editMode: boolean;
  selectedNodeId: string | null;
  selectedLinkId: string | null;

  // Polling
  _pollTimer: ReturnType<typeof setInterval> | null;

  // Actions
  loadMap: (id: string) => Promise<void>;
  setEditMode: (on: boolean) => void;
  selectNode: (id: string | null) => void;
  selectLink: (id: string | null) => void;
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  saveNodePositions: () => Promise<void>;
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
  selectedNodeId: null,
  selectedLinkId: null,
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

  setEditMode: (on) => set({ editMode: on, selectedNodeId: null, selectedLinkId: null }),

  selectNode: (id) => set({ selectedNodeId: id, selectedLinkId: null }),
  selectLink: (id) => set({ selectedLinkId: id, selectedNodeId: null }),

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
