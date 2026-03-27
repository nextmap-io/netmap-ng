import type { MapSummary, NetmapData, TrafficData, TrafficHistory } from "@/types";

const BASE = import.meta.env.VITE_API_URL || "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = "/auth/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) p.set(k, v);
  }
  return p.toString();
}

export const api = {
  // Maps
  listMaps: () => request<MapSummary[]>("/api/maps"),
  getMap: (id: string) => request<NetmapData>(`/api/maps/${encodeURIComponent(id)}`),
  createMap: (data: { name: string; description?: string }) =>
    request<{ id: string; name: string }>("/api/maps", { method: "POST", body: JSON.stringify(data) }),
  updateMap: (id: string, data: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMap: (id: string) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Nodes
  createNode: (mapId: string, data: Record<string, unknown>) =>
    request<{ id: string }>(`/api/maps/${encodeURIComponent(mapId)}/nodes`, { method: "POST", body: JSON.stringify(data) }),
  updateNode: (mapId: string, nodeId: string, data: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(mapId)}/nodes/${encodeURIComponent(nodeId)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteNode: (mapId: string, nodeId: string) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(mapId)}/nodes/${encodeURIComponent(nodeId)}`, { method: "DELETE" }),
  batchMoveNodes: (mapId: string, moves: Array<{ id: string; x: number; y: number }>) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(mapId)}/nodes/batch-move`, { method: "POST", body: JSON.stringify({ moves }) }),

  // Links
  createLink: (mapId: string, data: Record<string, unknown>) =>
    request<{ id: string }>(`/api/maps/${encodeURIComponent(mapId)}/links`, { method: "POST", body: JSON.stringify(data) }),
  updateLink: (mapId: string, linkId: string, data: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(mapId)}/links/${encodeURIComponent(linkId)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteLink: (mapId: string, linkId: string) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(mapId)}/links/${encodeURIComponent(linkId)}`, { method: "DELETE" }),

  // Datasources
  getObserviumDevices: () => request<Record<string, unknown>[]>("/api/datasources/observium/devices"),
  getDevicePorts: (deviceId: number) => request<Record<string, unknown>[]>(`/api/datasources/observium/devices/${deviceId}/ports`),
  getNeighbours: (deviceIds?: number[]) => {
    const query = deviceIds ? `?${qs({ device_ids: deviceIds.join(",") })}` : "";
    return request<Record<string, unknown>[]>(`/api/datasources/observium/neighbours${query}`);
  },
  getLiveTraffic: (mapId: string) =>
    request<TrafficData>(`/api/datasources/traffic/live?${qs({ map_id: mapId })}`),
  getTrafficHistory: (hostname: string, portId: string, start?: string, end?: string) =>
    request<TrafficHistory>(`/api/datasources/traffic/history?${qs({ hostname, port_identifier: portId, start: start || "-24h", end: end || "now" })}`),

  // AI
  generateMap: (data: { device_ids: number[]; instructions: string; map_id?: string }) =>
    request<Record<string, unknown>>("/api/ai/generate-map", { method: "POST", body: JSON.stringify(data) }),

  // Auth
  getUser: () => request<{ sub: string; name: string; email: string }>("/auth/me"),
};
