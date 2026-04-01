import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { api } from "@/api/client";
import { NetworkNode } from "./NetworkNode";
import { GroupNode } from "./GroupNode";
import { TrafficEdge } from "./NetworkLink";
import { TrafficLegend } from "./TrafficLegend";
import type { NetmapData, MapNode, MapLink, ScaleBand, TrafficData } from "@/types";

const nodeTypes = { network: NetworkNode, group: GroupNode };
const edgeTypes = { traffic: TrafficEdge };

function getScaleColor(pct: number, scales: ScaleBand[]): string {
  for (const band of scales) {
    if (pct >= band.min && pct <= band.max) return band.color;
  }
  return "hsl(220 15% 24%)";
}

function computeAnchor(
  fromX: number, fromY: number, fromW: number, fromH: number,
  toX: number, toY: number,
): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "E" : "W") : (dy > 0 ? "S" : "N");
  let pct: number;
  if (side === "E" || side === "W") {
    pct = fromH > 30 ? ((toY - fromY + fromH / 2) / fromH) * 100 : 50;
  } else {
    pct = fromW > 30 ? ((toX - fromX + fromW / 2) / fromW) * 100 : 50;
  }
  pct = Math.min(95, Math.max(5, Math.round(pct / 5) * 5));
  if (pct === 50) return side;
  return `${side}:${pct}`;
}

function mapNodeToFlow(n: MapNode): Node {
  const isGroup = n.node_type === "group";
  return {
    id: n.id,
    type: isGroup ? "group" : "network",
    position: { x: n.x, y: n.y },
    parentId: n.parent_id || undefined,
    extent: n.parent_id ? "parent" as const : undefined,
    data: {
      label: n.label || n.name,
      nodeType: n.node_type,
      width: n.width,
      height: n.height,
      bgColor: n.style?.bg_color,
    },
    style: isGroup ? { width: n.width || 400, height: n.height || 300 } : undefined,
    zIndex: isGroup ? -1 : 0,
    draggable: false,
    selectable: false,
  };
}

function buildPublicEdges(
  links: MapLink[],
  flowNodes: Node[],
  scales: ScaleBand[],
  traffic: TrafficData,
): Edge[] {
  const nodePos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const parentPos = new Map<string, { x: number; y: number }>();

  for (const n of flowNodes) {
    if (n.type === "group") {
      parentPos.set(n.id, { x: n.position.x, y: n.position.y });
    }
  }
  for (const n of flowNodes) {
    let absX = n.position.x;
    let absY = n.position.y;
    if (n.parentId) {
      const pp = parentPos.get(n.parentId);
      if (pp) { absX += pp.x; absY += pp.y; }
    }
    const w = Number(n.data?.width) || 80;
    const h = Number(n.data?.height) || 30;
    nodePos.set(n.id, { x: absX + w / 2, y: absY + h / 2, w, h });
  }

  return links.map((l) => {
    const t = traffic[l.id];
    const inPct = t?.in_pct ?? 0;
    const outPct = t?.out_pct ?? 0;

    const sp = nodePos.get(l.source_id);
    const tp = nodePos.get(l.target_id);

    let srcHandle: string | undefined;
    let tgtHandle: string | undefined;

    if (l.source_anchor && l.target_anchor) {
      srcHandle = l.source_anchor;
      tgtHandle = `${l.target_anchor}-t`;
    } else if (sp && tp) {
      srcHandle = computeAnchor(sp.x, sp.y, sp.w, sp.h, tp.x, tp.y);
      tgtHandle = computeAnchor(tp.x, tp.y, tp.w, tp.h, sp.x, sp.y) + "-t";
    }

    return {
      id: l.id,
      source: l.source_id,
      target: l.target_id,
      type: "traffic",
      sourceHandle: srcHandle,
      targetHandle: tgtHandle,
      data: {
        linkType: l.link_type,
        bandwidthLabel: l.bandwidth_label,
        bandwidth: l.bandwidth,
        width: l.width,
        inBps: t?.in_bps ?? 0,
        outBps: t?.out_bps ?? 0,
        inPct, outPct,
        inColor: getScaleColor(inPct, scales),
        outColor: getScaleColor(outPct, scales),
        extra: l.extra,
      },
    } satisfies Edge;
  });
}

function PublicMapInner() {
  const { token } = useParams<{ token: string }>();
  const [map, setMap] = useState<NetmapData | null>(null);
  const [traffic, setTraffic] = useState<TrafficData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    let interval: ReturnType<typeof setInterval> | undefined;
    api.getPublicMap(token)
      .then((data) => {
        setMap(data);
        setLoading(false);
        const fetchTraffic = () => {
          api.getPublicTraffic(token).then(setTraffic).catch(() => {});
        };
        fetchTraffic();
        interval = setInterval(fetchTraffic, Math.max((data.settings?.refresh_interval ?? 300) * 1000, 30000));
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    return () => { if (interval) clearInterval(interval); };
  }, [token]);

  const scales = useMemo(() => map?.scales?.default ?? [], [map]);

  const initialNodes = useMemo(() => {
    if (!map) return [];
    const groups = map.nodes.filter((n) => n.node_type === "group").map(mapNodeToFlow);
    const others = map.nodes.filter((n) => n.node_type !== "group").map(mapNodeToFlow);
    return [...groups, ...others];
  }, [map]);

  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState<Edge>([]);

  useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);

  useEffect(() => {
    if (!map) return;
    setEdges(buildPublicEdges(map.links, nodes, scales, traffic));
  }, [map, nodes, scales, traffic, setEdges]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-noc-bg">
        <div className="w-6 h-6 border border-accent/40 border-t-accent rounded-full animate-spin-slow" />
      </div>
    );
  }

  if (error || !map) {
    return (
      <div className="flex items-center justify-center h-screen bg-noc-bg">
        <div className="noc-card p-6 text-center">
          <p className="text-xs text-noc-text mb-1">Map not available</p>
          <p className="text-2xs text-noc-text-dim">{error || "Not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-noc-bg">
      <div className="h-10 border-b border-noc-border bg-noc-bg/80 backdrop-blur-md flex items-center px-4">
        <span className="text-xs font-semibold tracking-wider text-accent">NETMAP</span>
        <span className="text-2xs text-noc-text-muted ml-3">{map.name}</span>
      </div>

      <div className="h-[calc(100vh-40px)] relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.1}
          maxZoom={3}
        >
          <Background gap={24} size={0.5} color="hsl(220 15% 12%)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable maskColor="hsl(220 20% 7% / 0.8)" />
        </ReactFlow>
        <TrafficLegend scales={scales} />
      </div>
    </div>
  );
}

export function PublicMapView() {
  return (
    <ReactFlowProvider>
      <PublicMapInner />
    </ReactFlowProvider>
  );
}
