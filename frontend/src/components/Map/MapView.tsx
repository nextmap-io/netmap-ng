import { useEffect, useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  ConnectionMode,
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
import { EditorToolbox } from "../Editor/EditorToolbox";
import { EditorToolbar } from "../Editor/EditorToolbar";
import { PropertyPanel } from "../Editor/PropertyPanel";
import { useTheme } from "@/hooks/useTheme";
import type { MapNode, MapLink, ScaleBand, TrafficData } from "@/types";

const nodeTypes = {
  network: NetworkNode,
  group: GroupNode,
};

const edgeTypes = {
  traffic: TrafficEdge,
};

function mapNodeToFlow(n: MapNode, editMode: boolean): Node {
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
      bgColor: n.style?.bg_color,
    },
    style: isGroup
      ? { width: n.width || 400, height: n.height || 300 }
      : undefined,
    zIndex: isGroup ? -1 : (n.z_order || 0),
    draggable: editMode && !n.locked && !n.style?.locked,
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
  useGradientScale = false,
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
    const inColor = getScaleColor(inPct, scales, useGradientScale);
    const outColor = getScaleColor(outPct, scales, useGradientScale);

    const sp = nodePos.get(l.source_id);
    const tp = nodePos.get(l.target_id);

    let srcHandle: string | undefined;
    let tgtHandle: string | undefined;

    if (l.source_anchor && l.target_anchor) {
      // Use explicit anchors from DB
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
        inPct, outPct, inColor, outColor,
        extra: l.extra,
      },
      zIndex: l.z_order,
    } satisfies Edge;
  });
}

/**
 * Parse a CSS color string to [r, g, b].
 * Supports hex (#rrggbb, #rgb) and basic named colors.
 */
function parseColor(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
  }
  return [128, 128, 128]; // fallback gray
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r,g,b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2,"0")).join("");
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1,g1,b1] = parseColor(c1);
  const [r2,g2,b2] = parseColor(c2);
  return rgbToHex(r1+(r2-r1)*t, g1+(g2-g1)*t, b1+(b2-b1)*t);
}

function getScaleColor(pct: number, scales: ScaleBand[], gradient = false): string {
  if (!gradient) {
    // Steps mode: return the fixed color for the matching band
    for (const band of scales) {
      if (pct >= band.min && pct <= band.max) return band.color;
    }
    return "hsl(220 15% 24%)";
  }

  // Gradient mode: interpolate between band colors based on pct
  const sorted = [...scales].sort((a, b) => a.min - b.min);
  if (sorted.length === 0) return "hsl(220 15% 24%)";

  // Clamp pct
  if (pct <= sorted[0].min) return sorted[0].color;
  if (pct >= sorted[sorted.length - 1].max) return sorted[sorted.length - 1].color;

  // Find which two bands we're between and interpolate
  for (let i = 0; i < sorted.length; i++) {
    const band = sorted[i];
    if (pct >= band.min && pct <= band.max) {
      // Within this band: if there's a next band, interpolate from this to next
      const next = sorted[i + 1];
      if (next && band.max === next.min) {
        // Interpolate within the band range
        const t = band.max > band.min ? (pct - band.min) / (band.max - band.min) : 0;
        return lerpColor(band.color, next.color, t);
      }
      // Single band or last band: interpolate within band itself
      if (i > 0) {
        const prev = sorted[i - 1];
        const fullRange = band.max - prev.min;
        const t = fullRange > 0 ? (pct - prev.min) / fullRange : 0;
        return lerpColor(prev.color, band.color, t);
      }
      return band.color;
    }
  }
  return "hsl(220 15% 24%)";
}

export function formatBps(bps: number): string {
  if (bps >= 1e12) return `${(bps / 1e12).toFixed(1)}Tbps`;
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)}Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)}Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)}Kbps`;
  return `${bps.toFixed(0)}bps`;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable;
}

function MapViewInner() {
  const { mapId } = useParams<{ mapId: string }>();
  const { map, traffic, loading, error, loadMap, editMode, updateNodePosition, saveNodePositions, selectLink, stopTrafficPolling, selectNodes, selectLinks, clearSelection, snapToGrid, createLink } =
    useMapStore();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (mapId) loadMap(mapId);
    return () => stopTrafficPolling();
  }, [mapId, loadMap, stopTrafficPolling]);

  const scales = useMemo(() => map?.scales?.default ?? [], [map]);

  // Keyboard shortcuts for edit mode
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: KeyboardEvent) => {
      // Delete selected items
      if ((e.key === "Delete" || e.key === "Backspace") && !isInputFocused()) {
        const { selectedNodeIds, selectedLinkIds, deleteNode, deleteLink, map: currentMap } = useMapStore.getState();
        if (!currentMap) return;
        for (const id of selectedLinkIds) deleteLink(id);
        for (const id of selectedNodeIds) deleteNode(id);
      }
      // Escape to deselect
      if (e.key === "Escape") {
        clearSelection();
      }
      // Ctrl+A to select all non-group nodes
      if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (map) {
          const allIds = map.nodes.filter(n => n.node_type !== "group").map(n => n.id);
          selectNodes(allIds);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, clearSelection, selectNodes, map]);

  const initialNodes = useMemo(() => {
    if (!map) return [];
    const groups = map.nodes.filter((n: MapNode) => n.node_type === "group").map((n) => mapNodeToFlow(n, editMode));
    const others = map.nodes.filter((n: MapNode) => n.node_type !== "group").map((n) => mapNodeToFlow(n, editMode));
    return [...groups, ...others];
  }, [map, editMode]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  // Recompute edges whenever nodes move or traffic updates
  const useGradientScale = map?.settings?.scale_mode === "gradient";
  useEffect(() => {
    if (!map) return;
    const newEdges = buildEdges(map.links, nodes, scales, traffic, useGradientScale);
    setEdges(newEdges);
  }, [map, nodes, scales, traffic, setEdges, useGradientScale]);

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
      if (editMode) {
        // Edit mode: select for property panel, no graph
        selectLinks([edge.id]);
      } else {
        // View mode: open traffic graph
        setSelectedEdgeId(edge.id);
        selectLink(edge.id);
      }
    },
    [selectLink, editMode, selectLinks],
  );

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (!editMode) return;
      const { selectedNodeIds } = useMapStore.getState();
      if (event.shiftKey || event.metaKey) {
        // Toggle: add or remove from selection
        if (selectedNodeIds.includes(node.id)) {
          selectNodes(selectedNodeIds.filter((id) => id !== node.id));
        } else {
          selectNodes([...selectedNodeIds, node.id]);
        }
      } else {
        selectNodes([node.id]);
      }
    },
    [editMode, selectNodes],
  );

  const handleConnect = useCallback(
    async (connection: { source: string | null; target: string | null }) => {
      if (!editMode || !map || !connection.source || !connection.target) return;
      const sourceNode = map.nodes.find((n: MapNode) => n.id === connection.source);
      const targetNode = map.nodes.find((n: MapNode) => n.id === connection.target);
      const name = `${sourceNode?.label || "A"} - ${targetNode?.label || "B"}`;
      await createLink({
        name,
        source_id: connection.source,
        target_id: connection.target,
        link_type: "internal",
        bandwidth_label: "1G",
        bandwidth: 1000000000,
      });
    },
    [editMode, map, createLink],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selNodes }: { nodes: Node[]; edges: Edge[] }) => {
      if (!editMode) return;
      if (selNodes.length > 0) {
        selectNodes(selNodes.map((n) => n.id));
      }
    },
    [editMode, selectNodes],
  );

  const handlePaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

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
    <div className="h-[calc(100vh-48px)] relative bg-noc-bg flex">
      <div className={`flex-1 relative${editMode ? " edit-mode" : ""}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          onEdgeClick={handleEdgeClick}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onConnect={handleConnect}
          onSelectionChange={handleSelectionChange}
          nodesDraggable={editMode}
          selectionOnDrag={false}
          // selectionMode partial
          multiSelectionKeyCode={editMode ? "Shift" : null}
          snapToGrid={snapToGrid}
          snapGrid={[24, 24]}
          connectionMode={ConnectionMode.Loose}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.1}
          maxZoom={3}
        >
          <Background gap={24} size={0.5} color={
            theme === "light" || (theme === "system" && !window.matchMedia("(prefers-color-scheme: dark)").matches)
              ? "hsl(30 6% 78%)"
              : theme === "scada"
                ? "#1a3a1a"
                : "hsl(220 15% 12%)"
          } />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
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
            maskColor={
              theme === "light" || (theme === "system" && !window.matchMedia("(prefers-color-scheme: dark)").matches)
                ? "hsl(38 12% 95% / 0.75)"
                : theme === "scada"
                  ? "rgba(10, 10, 10, 0.8)"
                  : "hsl(220 20% 7% / 0.8)"
            }
          />
        </ReactFlow>

        <TrafficLegend scales={scales} />
        <EditorToolbox />
        <EditorToolbar />

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
      {editMode && <PropertyPanel />}
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
