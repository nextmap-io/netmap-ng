import type { LinkStatus, MapLink, MapNode, NodeStatus, NodeStatusData, ScaleBand, TrafficData } from "@/types";
import { utilizationSeverity, type Severity } from "@/utils/scaleColor";
import { epochToMs } from "./linkStatus";

/** Everything the hover card, node panel and graph header show about a link. */
export interface LinkInfo {
  link: MapLink;
  source: string;
  target: string;
  /** Interface names when known (extra.interface / interface_a / interface_b). */
  ifaceA: string;
  ifaceB: string;
  capacity: number | null;
  inBps: number;
  outBps: number;
  inPct: number;
  outPct: number;
  status: LinkStatus | undefined;
  /** Epoch ms of the last poll of this link, when reported. */
  updatedAt: number | null;
  /** Worst of in/out against the map scale. */
  severity: Severity;
  hasTraffic: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const nodeName = (n: MapNode | undefined) => (n ? n.label || n.name : "?");

export function linkInfo(
  link: MapLink,
  nodesById: Map<string, MapNode>,
  traffic: TrafficData,
  scales: ScaleBand[],
): LinkInfo {
  const t = traffic[link.id];
  const inPct = t?.in_pct ?? 0;
  const outPct = t?.out_pct ?? 0;
  const status = t?.status;
  const live = status === undefined || status === "ok" || status === "stale";
  return {
    link,
    source: nodeName(nodesById.get(link.source_id)),
    target: nodeName(nodesById.get(link.target_id)),
    ifaceA: str(link.extra?.interface_a) || str(link.extra?.interface),
    ifaceB: str(link.extra?.interface_b),
    capacity: link.bandwidth && link.bandwidth > 0 ? link.bandwidth : null,
    inBps: t?.in_bps ?? 0,
    outBps: t?.out_bps ?? 0,
    inPct,
    outPct,
    status,
    updatedAt: t?.updated_at != null ? epochToMs(t.updated_at) : null,
    severity: live ? utilizationSeverity(Math.max(inPct, outPct), scales) : "normal",
    hasTraffic: !!t && live,
  };
}

/** Status words for abnormal link states (normal states have none). */
export const LINK_STATUS_WORD: Partial<Record<LinkStatus, string>> = {
  down: "Down",
  admin_down: "Admin down",
  nodata: "No data",
  unbound: "Not bound",
  stale: "Stale",
};

export interface NodeInfo {
  node: MapNode;
  status: NodeStatus | undefined;
  links: LinkInfo[];
  /** Traffic totals across the node's links, from the node's side. */
  totalIn: number;
  totalOut: number;
  down: number;
}

/**
 * A node's links, busiest first, with in/out seen from the node: on links
 * where the node is the target, the link's "out" (A→B) arrives at the node.
 */
export function nodeInfo(
  node: MapNode,
  links: MapLink[],
  nodesById: Map<string, MapNode>,
  traffic: TrafficData,
  scales: ScaleBand[],
  nodeStatus: NodeStatusData,
): NodeInfo {
  const mine = links
    .filter((l) => l.source_id === node.id || l.target_id === node.id)
    .map((l) => linkInfo(l, nodesById, traffic, scales))
    .sort((a, b) => Math.max(b.inPct, b.outPct) - Math.max(a.inPct, a.outPct));
  let totalIn = 0;
  let totalOut = 0;
  for (const li of mine) {
    if (!li.hasTraffic) continue;
    const isSource = li.link.source_id === node.id;
    totalIn += isSource ? li.inBps : li.outBps;
    totalOut += isSource ? li.outBps : li.inBps;
  }
  return {
    node,
    status: nodeStatus[node.id]?.status,
    links: mine,
    totalIn,
    totalOut,
    down: mine.filter((l) => l.status === "down").length,
  };
}

/** The other end of `li` as seen from `nodeId`, with the local interface. */
export function peerOf(li: LinkInfo, nodeId: string): { peer: string; iface: string } {
  return li.link.source_id === nodeId
    ? { peer: li.target, iface: li.ifaceA }
    : { peer: li.source, iface: li.ifaceB };
}

export function formatTime(ms: number | null): string {
  if (ms == null) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
