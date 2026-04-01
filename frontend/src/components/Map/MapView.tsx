import { useEffect, useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useMapStore } from "@/hooks/useMapStore";
import { NetworkNode } from "./NetworkNode";
import { GroupNode } from "./GroupNode";
import { TrafficEdge } from "./NetworkLink";
import { TrafficLegend } from "./TrafficLegend";
import { TrafficGraphPanel } from "../Graph/TrafficGraph";
import { MapEditor } from "../Editor/MapEditor";
import type { MapNode, MapLink, ScaleBand, TrafficData } from "@/types";

const nodeTypes = {
  network: NetworkNode,
  group: GroupNode,
};

const edgeTypes = {
  traffic: TrafficEdge,
};

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
      bandwidthLabel: n.extra?.bandwidth_label,
      observiumDeviceId: n.observium_device_id,
      infoUrl: n.info_url,
      width: n.width,
      height: n.height,
    },
    style: isGroup
      ? { width: n.width || 400, height: n.height || 300 }
      : undefined,
    zIndex: isGroup ? -1 : (n.z_order || 0),
    draggable: !n.style?.locked,
  };
}

/**
 * Compute the best anchor percentage on a given side of a node,
 * based on where the target node is positioned relative to the source.
 * For vertical sides (E/W): uses the target's Y position relative to source's height.
 * For horizontal sides (N/S): uses the target's X position relative to source's width.
 * This makes links exit the switch at the exact height of the server they connect to.
 */
function computeAnchor(
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
 * Build edges with dynamically computed anchors based on current node positions.
 * This is called on every render so anchors update when nodes are dragged.
 */
function buildEdges(
  links: MapLink[],
  flowNodes: Node[],
  scales: ScaleBand[],
  traffic: TrafficData,
): Edge[] {
  // Build absolute position map (accounting for parent offsets)
  const nodePos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const parentPos = new Map<string, { x: number; y: number }>();

  // First pass: get parent positions
  for (const n of flowNodes) {
    if (n.type === "group") {
      parentPos.set(n.id, { x: n.position.x, y: n.position.y });
    }
  }

  // Second pass: compute absolute positions
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
    const inColor = getScaleColor(inPct, scales);
    const outColor = getScaleColor(outPct, scales);

    const sp = nodePos.get(l.source_id);
    const tp = nodePos.get(l.target_id);

    let srcHandle: string | undefined;
    let tgtHandle: string | undefined;

    if (l.source_anchor && l.target_anchor) {
      // Use explicit anchors from DB
      srcHandle = l.source_anchor;
      tgtHandle = `${l.target_anchor}-t`;
    } else if (sp && tp) {
      // Auto-compute: anchor exits toward the target, positioned proportionally
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
        inPct, outPct, inColor, outColor,
        extra: l.extra,
      },
      zIndex: l.z_order,
    } satisfies Edge;
  });
}

function getScaleColor(pct: number, scales: ScaleBand[]): string {
  for (const band of scales) {
    if (pct >= band.min && pct <= band.max) return band.color;
  }
  return "hsl(220 15% 24%)";
}

export function formatBps(bps: number): string {
  if (bps >= 1e12) return `${(bps / 1e12).toFixed(1)}T`;
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)}G`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)}M`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)}K`;
  return `${bps.toFixed(0)}`;
}

function MapViewInner() {
  const { mapId } = useParams<{ mapId: string }>();
  const { map, traffic, loading, error, loadMap, editMode, updateNodePosition, saveNodePositions, selectLink, stopTrafficPolling } =
    useMapStore();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    if (mapId) loadMap(mapId);
    return () => stopTrafficPolling();
  }, [mapId, loadMap, stopTrafficPolling]);

  const scales = useMemo(() => map?.scales?.default ?? [], [map]);

  const initialNodes = useMemo(() => {
    if (!map) return [];
    const groups = map.nodes.filter((n: MapNode) => n.node_type === "group").map(mapNodeToFlow);
    const others = map.nodes.filter((n: MapNode) => n.node_type !== "group").map(mapNodeToFlow);
    return [...groups, ...others];
  }, [map]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  // Recompute edges whenever nodes move or traffic updates
  useEffect(() => {
    if (!map) return;
    const newEdges = buildEdges(map.links, nodes, scales, traffic);
    setEdges(newEdges);
  }, [map, nodes, scales, traffic, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      if (editMode) {
        for (const change of changes) {
          if (change.type === "position" && change.position && change.id) {
            updateNodePosition(change.id, change.position.x, change.position.y);
          }
        }
      }
    },
    [editMode, onNodesChange, updateNodePosition],
  );

  const handleNodeDragStop = useCallback(() => {
    if (editMode) saveNodePositions();
  }, [editMode, saveNodePositions]);

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      setSelectedEdgeId(edge.id);
      selectLink(edge.id);
    },
    [selectLink],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)] bg-noc-bg">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="w-6 h-6 border border-accent/40 border-t-accent rounded-full animate-spin-slow" />
          <span className="text-2xs text-noc-text-dim tracking-wider uppercase">Loading map</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)] bg-noc-bg">
        <div className="noc-card p-6 max-w-xs text-center animate-fade-in border-node-firewall/30">
          <p className="text-xs text-noc-text mb-1">Failed to load map</p>
          <p className="text-2xs text-noc-text-dim">Check your connection and try again</p>
        </div>
      </div>
    );
  }

  if (!map) return null;

  const selectedLink = selectedEdgeId ? map.links.find((l: MapLink) => l.id === selectedEdgeId) : null;

  return (
    <div className="h-[calc(100vh-48px)] relative bg-noc-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onEdgeClick={handleEdgeClick}
        nodesDraggable={editMode}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.1}
        maxZoom={3}
      >
        <Background gap={24} size={0.5} color="hsl(220 15% 12%)" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const type = String(n.data?.nodeType || "");
            if (type === "router") return "hsl(36 100% 55%)";
            if (type === "switch_l3") return "hsl(270 60% 60%)";
            if (type === "switch_l2") return "hsl(210 80% 55%)";
            if (type === "server") return "hsl(152 60% 44%)";
            if (type === "ix") return "hsl(280 60% 55%)";
            if (type === "transit" || type === "internet") return "hsl(340 65% 55%)";
            if (type === "pni") return "hsl(160 60% 45%)";
            if (type === "cloud" || type === "provider") return "hsl(190 90% 50%)";
            return "hsl(220 15% 24%)";
          }}
          maskColor="hsl(220 20% 7% / 0.8)"
        />
      </ReactFlow>

      <TrafficLegend scales={scales} />
      <MapEditor />

      {selectedLink && (
        <TrafficGraphPanel
          link={selectedLink}
          onClose={() => {
            setSelectedEdgeId(null);
            selectLink(null);
          }}
        />
      )}
    </div>
  );
}

export function MapView() {
  return (
    <ReactFlowProvider>
      <MapViewInner />
    </ReactFlowProvider>
  );
}
