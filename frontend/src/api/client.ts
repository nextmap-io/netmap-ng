import type { MapSummary, MapNode, MapLink, NetmapData, NodeStatusData, TrafficData, TrafficHistory } from "@/types";

const BASE = import.meta.env.VITE_API_URL || "";

export class ApiError extends Error {
  status: number;
  /** Human-readable `detail` returned by the backend, when there is one. */
  detail: string | null;
  constructor(status: number, message: string, detail: string | null = null) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.name = "ApiError";
  }
}

/**
 * Extract FastAPI's `detail` from an error response. It is either a string
 * (HTTPException) or a list of validation errors ({loc, msg}) for 422s.
 */
async function readDetail(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || !("detail" in body)) return null;
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d: unknown) => {
          if (!d || typeof d !== "object") return null;
          const { loc, msg } = d as { loc?: unknown; msg?: unknown };
          if (typeof msg !== "string") return null;
          const field = Array.isArray(loc) ? loc.filter((p) => p !== "body").join(".") : "";
          return field ? `${field}: ${msg}` : msg;
        })
        .filter((m): m is string => !!m);
      return msgs.length > 0 ? msgs.join("; ") : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Build an ApiError from a non-OK response, preferring the backend detail. */
async function toApiError(res: Response, fallback: string): Promise<ApiError> {
  const detail = await readDetail(res);
  return new ApiError(res.status, detail || fallback, detail);
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
    throw await toApiError(res, "Forbidden: insufficient permissions");
  }
  if (res.status === 404) {
    throw await toApiError(res, "Not found");
  }
  if (!res.ok) {
    throw await toApiError(res, `API error: ${res.status}`);
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
    throw await toApiError(res, "Not found");
  }
  if (!res.ok) {
    throw await toApiError(res, `API error: ${res.status}`);
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
  /** Delete nodes + links in one call; links attached to deleted nodes are removed server-side. */
  batchDelete: (mapId: string, nodeIds: string[], linkIds: string[]) =>
    request<{ deleted_node_ids: string[]; deleted_link_ids: string[] }>(`/api/maps/${encodeURIComponent(mapId)}/nodes/batch-delete`, {
      method: "POST",
      body: JSON.stringify({ node_ids: nodeIds, link_ids: linkIds }),
    }),
  batchUpdateNodes: (mapId: string, ids: string[], fields: Record<string, unknown>) =>
    request<{ nodes: MapNode[] }>(`/api/maps/${encodeURIComponent(mapId)}/nodes/batch`, {
      method: "PATCH",
      body: JSON.stringify({ node_ids: ids, fields }),
    }),

  // Links
  createLink: (mapId: string, data: Record<string, unknown>) =>
    request<{ id: string }>(`/api/maps/${encodeURIComponent(mapId)}/links`, { method: "POST", body: JSON.stringify(data) }),
  updateLink: (mapId: string, linkId: string, data: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(mapId)}/links/${encodeURIComponent(linkId)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteLink: (mapId: string, linkId: string) =>
    request<{ ok: boolean }>(`/api/maps/${encodeURIComponent(mapId)}/links/${encodeURIComponent(linkId)}`, { method: "DELETE" }),
  batchUpdateLinks: (mapId: string, ids: string[], fields: Record<string, unknown>) =>
    request<{ links: MapLink[] }>(`/api/maps/${encodeURIComponent(mapId)}/links/batch`, {
      method: "PATCH",
      body: JSON.stringify({ link_ids: ids, fields }),
    }),

  // Datasources
  getObserviumDevices: () => request<Record<string, unknown>[]>("/api/datasources/observium/devices"),
  getDevicePorts: (deviceId: number) => request<Record<string, unknown>[]>(`/api/datasources/observium/devices/${deviceId}/ports`),
  getNeighbours: (deviceIds?: number[]) => {
    const query = deviceIds ? `?${qs({ device_ids: deviceIds.join(",") })}` : "";
    return request<Record<string, unknown>[]>(`/api/datasources/observium/neighbours${query}`);
  },
  getLiveTraffic: (mapId: string, signal?: AbortSignal) =>
    request<TrafficData>(`/api/datasources/traffic/live?${qs({ map_id: mapId })}`, { signal }),
  getNodeStatus: (mapId: string, signal?: AbortSignal) =>
    request<NodeStatusData>(`/api/datasources/traffic/nodes?${qs({ map_id: mapId })}`, { signal }),
  getTrafficHistory: (hostname: string, portId: string, mapId: string, start?: string, end?: string) =>
    request<TrafficHistory>(`/api/datasources/traffic/history?${qs({ hostname, port_identifier: portId, map_id: mapId, start: start || "-24h", end: end || "now" })}`),
  getTrafficHistoryByPort: (portId: number, mapId: string, start?: string, end?: string) =>
    request<TrafficHistory>(`/api/datasources/traffic/history/by-port?${qs({ port_id: String(portId), map_id: mapId, start: start || "-24h", end: end || "now" })}`),

  // Auth
  getUser: () => request<{ sub: string; name: string; email: string }>("/auth/me"),

  // Public (no auth)
  getPublicMap: (token: string) =>
    publicRequest<NetmapData>(`/api/public/maps/${encodeURIComponent(token)}`),
  getPublicTraffic: (token: string) =>
    publicRequest<TrafficData>(`/api/public/maps/${encodeURIComponent(token)}/traffic`),
  getPublicNodeStatus: (token: string) =>
    publicRequest<NodeStatusData>(`/api/public/maps/${encodeURIComponent(token)}/nodes-status`),
  /** Link traffic history on a public map (404 unless the map allows show_graph). */
  getPublicLinkHistory: (token: string, linkId: string, start?: string, end?: string, resolution?: number) =>
    publicRequest<TrafficHistory>(
      `/api/public/maps/${encodeURIComponent(token)}/links/${encodeURIComponent(linkId)}/history?${qs({
        start: start || "-24h",
        end: end || "now",
        resolution: resolution !== undefined ? String(resolution) : undefined,
      })}`,
    ),

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
