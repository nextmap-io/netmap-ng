import type { Edge } from "@xyflow/react";
import type { MapLink, MapNode, ScaleBand, TrafficData } from "@/types";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "@/types";
import { getScaleColor } from "@/utils/scaleColor";

/**
 * Shared, pure edge building for the private editor (MapView) and the public
 * viewer (PublicMapView) so both render links identically: anchors, via
 * points, arrow style, gradient/step scale colors and link status.
 */

export interface LinkHandles {
  sourceHandle?: string;
  targetHandle?: string;
}

/**
 * Compute the best anchor percentage on a given side of a node,
 * based on where the target node is positioned relative to the source.
 * For vertical sides (E/W): uses the target's Y position relative to source's height.
 * For horizontal sides (N/S): uses the target's X position relative to source's width.
 * This makes links exit the switch at the exact height of the server they connect to.
 */
export function computeAnchor(
  fromX: number, fromY: number, fromW: number, fromH: number,
  toX: number, toY: number,
): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "E" : "W") : (dy > 0 ? "S" : "N");

  let pct: number;
  if (side === "E" || side === "W") {
    // Vertical side: position based on target Y relative to node height
    pct = fromH > 30 ? ((toY - fromY + fromH / 2) / fromH) * 100 : 50;
  } else {
    // Horizontal side: position based on target X relative to node width
    pct = fromW > 30 ? ((toX - fromX + fromW / 2) / fromW) * 100 : 50;
  }

  pct = Math.min(95, Math.max(5, Math.round(pct / 5) * 5));
  if (pct === 50) return side;
  return `${side}:${pct}`;
}

/**
 * Absolute center + size of every node. Positions are stored relative to the
 * parent group, so walk the FULL parent chain (cycle-guarded) to support
 * deeply nested groups.
 */
function nodeCenters(nodes: MapNode[]): Map<string, { x: number; y: number; w: number; h: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absOffset = (n: MapNode): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    const seen = new Set<string>();
    let cur: MapNode | undefined = n;
    while (cur) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      x += cur.x;
      y += cur.y;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return { x, y };
  };
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const n of nodes) {
    const { x, y } = absOffset(n);
    const w = n.width || DEFAULT_NODE_WIDTH;
    const h = n.height || DEFAULT_NODE_HEIGHT;
    pos.set(n.id, { x: x + w / 2, y: y + h / 2, w, h });
  }
  return pos;
}

/**
 * Resolve the source/target handle of every link: explicit anchors from the
 * DB win, otherwise anchors are computed from the committed node positions.
 */
export function computeLinkHandles(nodes: MapNode[], links: MapLink[]): Map<string, LinkHandles> {
  const pos = nodeCenters(nodes);
  const out = new Map<string, LinkHandles>();
  for (const l of links) {
    if (l.source_anchor && l.target_anchor) {
      out.set(l.id, { sourceHandle: l.source_anchor, targetHandle: `${l.target_anchor}-t` });
      continue;
    }
    const sp = pos.get(l.source_id);
    const tp = pos.get(l.target_id);
    if (sp && tp) {
      out.set(l.id, {
        sourceHandle: computeAnchor(sp.x, sp.y, sp.w, sp.h, tp.x, tp.y),
        targetHandle: computeAnchor(tp.x, tp.y, tp.w, tp.h, sp.x, sp.y) + "-t",
      });
    } else {
      out.set(l.id, {});
    }
  }
  return out;
}

/**
 * Per node, the handle ids actually referenced by connected links. The custom
 * node uses this to render only the fine-grained percentage handles in use,
 * instead of ~150 handles per node, without breaking edge anchoring.
 */
export function computeUsedHandles(
  links: MapLink[],
  handles: Map<string, LinkHandles>,
): Map<string, string[]> {
  const used = new Map<string, Set<string>>();
  const add = (id: string, handle: string | undefined) => {
    if (!handle) return;
    let s = used.get(id);
    if (!s) { s = new Set(); used.set(id, s); }
    s.add(handle);
  };
  for (const l of links) {
    const h = handles.get(l.id);
    add(l.source_id, h?.sourceHandle);
    add(l.target_id, h?.targetHandle);
  }
  return new Map([...used].map(([k, v]) => [k, [...v]]));
}

export interface BuildEdgesOptions {
  scales: ScaleBand[];
  traffic: TrafficData;
  /** settings.scale_mode === "gradient" */
  gradient?: boolean;
}

/** Build ReactFlow edges for the traffic edge type from links + live traffic. */
export function buildEdges(
  links: MapLink[],
  handles: Map<string, LinkHandles>,
  { scales, traffic, gradient = false }: BuildEdgesOptions,
): Edge[] {
  return links.map((l) => {
    const t = traffic[l.id];
    const inPct = t?.in_pct ?? 0;
    const outPct = t?.out_pct ?? 0;
    const h = handles.get(l.id);
    return {
      id: l.id,
      source: l.source_id,
      target: l.target_id,
      type: "traffic",
      sourceHandle: h?.sourceHandle,
      targetHandle: h?.targetHandle,
      data: {
        linkType: l.link_type,
        bandwidthLabel: l.bandwidth_label,
        bandwidth: l.bandwidth,
        width: l.width,
        inBps: t?.in_bps ?? 0,
        outBps: t?.out_bps ?? 0,
        inPct,
        outPct,
        inColor: getScaleColor(inPct, scales, gradient),
        outColor: getScaleColor(outPct, scales, gradient),
        extra: l.extra,
        viaPoints: l.via_points ?? [],
        viaStyle: l.via_style,
        arrowStyle: l.arrow_style,
        status: t?.status,
        updatedAt: t?.updated_at,
      },
      zIndex: l.z_order,
    } satisfies Edge;
  });
}
