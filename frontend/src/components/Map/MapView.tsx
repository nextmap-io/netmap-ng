import { useEffect, useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
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
    zIndex: n.z_order,
    draggable: true,
  };
}

// Available handles on each side for distributing multiple links
const SIDE_HANDLES: Record<string, string[]> = {
  N: ["N:25", "N", "N:75"],
  S: ["S:25", "S", "S:75"],
  E: ["E:25", "E", "E:75"],
  W: ["W:25", "W", "W:75"],
};

/**
 * Auto-assign anchors to links so multiple links to the same node
 * are distributed across different handles instead of overlapping.
 */
function autoAssignAnchors(
  links: MapLink[],
  nodesById: Map<string, MapNode>,
): MapLink[] {
  // Count links per node per side, and track which handle index to use next
  const nodeHandleCounters: Map<string, Record<string, number>> = new Map();

  function getNextHandle(nodeId: string, side: string): string {
    if (!nodeHandleCounters.has(nodeId)) {
      nodeHandleCounters.set(nodeId, {});
    }
    const counters = nodeHandleCounters.get(nodeId)!;
    const idx = counters[side] ?? 0;
    counters[side] = idx + 1;
    const handles = SIDE_HANDLES[side] || [side];
    return handles[idx % handles.length];
  }

  function bestSide(fromId: string, toId: string): string {
    const from = nodesById.get(fromId);
    const to = nodesById.get(toId);
    if (!from || !to) return "S";
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Pick side based on dominant direction
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? "E" : "W";
    }
    return dy > 0 ? "S" : "N";
  }

  return links.map((l) => {
    const srcAnchor = l.source_anchor || getNextHandle(l.source_id, bestSide(l.source_id, l.target_id));
    const tgtAnchor = l.target_anchor || getNextHandle(l.target_id, bestSide(l.target_id, l.source_id));
    return { ...l, source_anchor: srcAnchor, target_anchor: tgtAnchor };
  });
}

function mapLinkToEdge(l: MapLink, scales: ScaleBand[], traffic: TrafficData): Edge {
  const t = traffic[l.id];
  const inPct = t?.in_pct ?? 0;
  const outPct = t?.out_pct ?? 0;
  const inColor = getScaleColor(inPct, scales);
  const outColor = getScaleColor(outPct, scales);

  return {
    id: l.id,
    source: l.source_id,
    target: l.target_id,
    type: "traffic",
    sourceHandle: l.source_anchor || undefined,
    targetHandle: l.target_anchor ? `${l.target_anchor}-t` : undefined,
    data: {
      linkType: l.link_type,
      bandwidthLabel: l.bandwidth_label,
      bandwidth: l.bandwidth,
      width: l.width,
      inBps: t?.in_bps ?? 0,
      outBps: t?.out_bps ?? 0,
      inPct,
      outPct,
      inColor,
      outColor,
      extra: l.extra,
    },
    zIndex: l.z_order,
  };
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

export function MapView() {
  const { mapId } = useParams<{ mapId: string }>();
  const { map, traffic, loading, error, loadMap, editMode, updateNodePosition, saveNodePositions, selectLink, stopTrafficPolling } =
    useMapStore();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    if (mapId) loadMap(mapId);
    return () => stopTrafficPolling();
  }, [mapId, loadMap, stopTrafficPolling]);

  const scales = useMemo(() => map?.scales?.default ?? [], [map]);

  const nodesById = useMemo(() => {
    if (!map) return new Map<string, MapNode>();
    return new Map(map.nodes.map((n: MapNode) => [n.id, n]));
  }, [map]);

  const initialNodes = useMemo(() => {
    if (!map) return [];
    const groups = map.nodes.filter((n: MapNode) => n.node_type === "group").map(mapNodeToFlow);
    const others = map.nodes.filter((n: MapNode) => n.node_type !== "group").map(mapNodeToFlow);
    return [...groups, ...others];
  }, [map]);

  const initialEdges = useMemo(() => {
    if (!map) return [];
    const enrichedLinks = autoAssignAnchors(map.links, nodesById);
    return enrichedLinks.map((l: MapLink) => mapLinkToEdge(l, scales, traffic));
  }, [map, traffic, scales, nodesById]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

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
          <svg viewBox="0 0 24 24" className="w-6 h-6 mx-auto mb-3 text-node-firewall" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
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
        fitViewOptions={{ padding: 0.12 }}
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
            if (type === "cloud" || type === "internet") return "hsl(190 90% 50%)";
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
