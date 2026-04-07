import type { MapSummary, NetmapData, TrafficData, TrafficHistory } from "@/types";

const BASE = import.meta.env.VITE_API_URL || "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = "/welcome";
    throw new ApiError(401, "Unauthorized");
  }
  if (res.status === 403) {
    throw new ApiError(403, "Forbidden: insufficient permissions");
  }
  if (res.status === 404) {
    throw new ApiError(404, "Not found");
  }
  if (!res.ok) {
    throw new ApiError(res.status, `API error: ${res.status}`);
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

async function publicRequest<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 404) {
    throw new ApiError(404, "Not found");
  }
  if (!res.ok) {
    throw new ApiError(res.status, `API error: ${res.status}`);
  }
  return res.json();
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
  duplicateMap: (mapId: string) =>
    request<{ id: string; name: string }>(`/api/maps/${encodeURIComponent(mapId)}/duplicate`, { method: "POST" }),

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
  getTrafficHistory: (hostname: string, portId: string, mapId: string, start?: string, end?: string) =>
    request<TrafficHistory>(`/api/datasources/traffic/history?${qs({ hostname, port_identifier: portId, map_id: mapId, start: start || "-24h", end: end || "now" })}`),

  // AI
  generateMap: (data: { device_ids: number[]; instructions: string; map_id?: string }) =>
    request<Record<string, unknown>>("/api/ai/generate-map", { method: "POST", body: JSON.stringify(data) }),

  // Auth
  getUser: () => request<{ sub: string; name: string; email: string }>("/auth/me"),

  // Public (no auth)
  getPublicMap: (token: string) =>
    publicRequest<NetmapData>(`/api/public/maps/${encodeURIComponent(token)}`),
  getPublicTraffic: (token: string) =>
    publicRequest<TrafficData>(`/api/public/maps/${encodeURIComponent(token)}/traffic`),

  // Public index
  getPublicConfig: () =>
    publicRequest<{ public_index: boolean }>("/api/public/config"),
  listPublicMaps: () =>
    publicRequest<Array<{ id: string; name: string; description: string; public_token: string }>>("/api/public/maps"),

  // Map sharing
  shareMap: (mapId: string) =>
    request<{ public_token: string; share_url: string }>(`/api/maps/${encodeURIComponent(mapId)}/share`, { method: "POST" }),
  unshareMap: (mapId: string) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(mapId)}/share`, { method: "DELETE" }),
};
