import { useEffect, useCallback, useMemo, useState, useRef } from "react";
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
  ConnectionMode,
  type Node,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useMapStore } from "@/hooks/useMapStore";
import { api } from "@/api/client";
import { NetworkNode } from "./NetworkNode";
import { GroupNode } from "./GroupNode";
import { LabelNode } from "./LabelNode";
import { TrafficEdge } from "./NetworkLink";
import { TrafficLegend } from "./TrafficLegend";
import { CanvasSearch } from "./CanvasSearch";
import { TrafficGraphPanel } from "../Graph/TrafficGraph";
import { EditorToolbox } from "../Editor/EditorToolbox";
import { EditorToolbar } from "../Editor/EditorToolbar";
import { PropertyPanel } from "../Editor/PropertyPanel";
import { useTheme } from "@/hooks/useTheme";
import { NotFound } from "../Layout/NotFound";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import type { MapNode, MapLink, ScaleBand, TrafficData } from "@/types";
import { getScaleColor } from "@/utils/scaleColor";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "@/types";

const nodeTypes = {
  network: NetworkNode,
  group: GroupNode,
  label: LabelNode,
};

const edgeTypes = {
  traffic: TrafficEdge,
};

function mapNodeToFlow(
  n: MapNode,
  editMode: boolean,
  dimmed = false,
  usedHandles: string[] = [],
  isBound = false,
): Node {
  const isGroup = n.node_type === "group";
  const isLabel = n.node_type === "label";
  const flowType = isGroup ? "group" : isLabel ? "label" : "network";
  const baseStyle: React.CSSProperties = isGroup
    ? { width: n.width || 400, height: n.height || 300 }
    : {};
  if (dimmed) {
    baseStyle.opacity = 0.18;
    baseStyle.transition = "opacity 150ms ease";
  }
  const locked = !!(n.locked || n.style?.locked);
  return {
    id: n.id,
    type: flowType,
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
      style: n.style,
      locked,
      isBound,
      usedHandles,
    },
    style: Object.keys(baseStyle).length > 0 ? baseStyle : undefined,
    zIndex: isGroup ? -1 : (n.z_order || 0),
    draggable: editMode && !locked,
  };
}

/**
 * Compute, per node, the set of handle ids actually referenced by connected
 * links (explicit anchors + auto-computed anchors). The custom node uses this
 * to render only the fine-grained percentage handles that are in use, instead
 * of ~150 handles per node, without breaking edge anchoring.
 */
function computeUsedHandles(nodes: MapNode[], links: MapLink[]): Map<string, string[]> {
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absOffset = (n: MapNode): { x: number; y: number } => {
    let x = 0, y = 0;
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
  for (const n of nodes) {
    const { x, y } = absOffset(n);
    const w = n.width || DEFAULT_NODE_WIDTH;
    const h = n.height || DEFAULT_NODE_HEIGHT;
    pos.set(n.id, { x: x + w / 2, y: y + h / 2, w, h });
  }
  const used = new Map<string, Set<string>>();
  const add = (id: string, handle: string) => {
    let s = used.get(id);
    if (!s) { s = new Set(); used.set(id, s); }
    s.add(handle);
  };
  for (const l of links) {
    const sp = pos.get(l.source_id);
    const tp = pos.get(l.target_id);
    let srcHandle: string | undefined;
    let tgtHandle: string | undefined;
    if (l.source_anchor && l.target_anchor) {
      srcHandle = l.source_anchor;
      tgtHandle = `${l.target_anchor}-t`;
    } else if (sp && tp) {
      srcHandle = computeAnchor(sp.x, sp.y, sp.w, sp.h, tp.x, tp.y);
      tgtHandle = computeAnchor(tp.x, tp.y, tp.w, tp.h, sp.x, sp.y) + "-t";
    }
    if (srcHandle) add(l.source_id, srcHandle);
    if (tgtHandle) add(l.target_id, tgtHandle);
  }
  return new Map([...used].map(([k, v]) => [k, [...v]]));
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
  // Build absolute position map (accounting for the FULL parent chain, so
  // deeply nested groups compute correct absolute positions).
  const nodePos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const byId = new Map<string, Node>();
  for (const n of flowNodes) byId.set(n.id, n);

  // Walk the entire ancestor chain, summing each parent's relative offset.
  // Guarded against cycles via a visited set.
  const absOffset = (node: Node): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    const seen = new Set<string>();
    let current: Node | undefined = node;
    while (current) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      x += current.position.x;
      y += current.position.y;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return { x, y };
  };

  for (const n of flowNodes) {
    const { x: absX, y: absY } = absOffset(n);
    const w = Number(n.data?.width) || DEFAULT_NODE_WIDTH;
    const h = Number(n.data?.height) || DEFAULT_NODE_HEIGHT;
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
        viaPoints: l.via_points ?? [],
        viaStyle: l.via_style,
        arrowStyle: l.arrow_style,
      },
      zIndex: l.z_order,
    } satisfies Edge;
  });
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
  const { map, traffic, trafficError, loading, error, errorStatus, loadMap, editMode, updateNodePosition, saveNodePositions, selectLink, stopTrafficPolling, selectNodes, selectLinks, clearSelection, snapToGrid, selectMode, createLink, pushUndo, undo, redo, searchQuery, activeTypeFilters, matchedNodeIds } =
    useMapStore();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { resolvedTheme } = useTheme();
  const flow = useReactFlow();
  const dragStartPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  const showShortcutsRef = useRef(false);
  useEffect(() => { showShortcutsRef.current = showShortcuts; }, [showShortcuts]);

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
      // "?" toggles the keyboard shortcuts help overlay
      if (e.key === "?" && !isInputFocused()) {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      }
      // Escape closes the shortcuts overlay first, otherwise deselects
      if (e.key === "Escape") {
        if (showShortcutsRef.current) {
          setShowShortcuts(false);
        } else {
          clearSelection();
        }
      }
      // Ctrl+A to select all non-group nodes
      if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (map) {
          const allIds = map.nodes.filter(n => n.node_type !== "group").map(n => n.id);
          selectNodes(allIds);
        }
      }
      // Ctrl+Z / Cmd+Z — undo
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !isInputFocused()) {
        e.preventDefault();
        undo();
      }
      // Ctrl+Shift+Z / Cmd+Shift+Z — redo
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && e.shiftKey && !isInputFocused()) {
        e.preventDefault();
        redo();
      }
      // Arrow keys — nudge selected nodes
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && !isInputFocused()) {
        const { selectedNodeIds, nudgeSelectedNodes, snapToGrid: snap } = useMapStore.getState();
        if (selectedNodeIds.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : snap ? 24 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        nudgeSelectedNodes(dx, dy);
      }
      // Ctrl+D / Cmd+D — duplicate selected nodes
      if (e.key === "d" && (e.metaKey || e.ctrlKey) && !isInputFocused()) {
        e.preventDefault();
        const { selectedNodeIds, map: currentMap } = useMapStore.getState();
        if (!currentMap || selectedNodeIds.length === 0) return;
        const selectedNodes = currentMap.nodes.filter(n => selectedNodeIds.includes(n.id));
        (async () => {
          const results = await Promise.all(
            selectedNodes.map((n) =>
              api.createNode(currentMap.id, {
                name: `${n.name}-copy`,
                label: `${n.label || n.name} (copy)`,
                node_type: n.node_type,
                x: n.x + 30,
                y: n.y + 30,
                width: n.width,
                height: n.height,
                parent_id: n.parent_id,
                style: n.style,
              }),
            ),
          );
          const newIds = results.map((r) => r.id);
          await useMapStore.getState().loadMap(currentMap.id);
          useMapStore.getState().selectNodes(newIds);
        })();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, clearSelection, selectNodes, map, undo, redo]);

  const initialNodes = useMemo(() => {
    if (!map) return [];
    const isFiltering = searchQuery.trim().length > 0 || activeTypeFilters.length > 0;
    const matched = new Set(matchedNodeIds);
    const isDimmed = (n: MapNode) =>
      isFiltering && n.node_type !== "group" && !matched.has(n.id);
    const usedHandles = computeUsedHandles(map.nodes, map.links);
    const boundIds = new Set<string>();
    for (const g of map.settings?.bound_groups ?? []) for (const id of g) boundIds.add(id);
    const groups = map.nodes
      .filter((n: MapNode) => n.node_type === "group")
      .map((n) => mapNodeToFlow(n, editMode, false, usedHandles.get(n.id), boundIds.has(n.id)));
    const others = map.nodes
      .filter((n: MapNode) => n.node_type !== "group")
      .map((n) => mapNodeToFlow(n, editMode, isDimmed(n), usedHandles.get(n.id), boundIds.has(n.id)));
    return [...groups, ...others];
  }, [map, editMode, searchQuery, activeTypeFilters, matchedNodeIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    // Preserve selection state from the store when replacing nodes
    const { selectedNodeIds } = useMapStore.getState();
    if (selectedNodeIds.length > 0) {
      const sel = new Set(selectedNodeIds);
      setNodes(initialNodes.map((n) => sel.has(n.id) ? { ...n, selected: true } : n));
    } else {
      setNodes(initialNodes);
    }
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
      // Filter out "remove" changes — nodes are only removed via our deleteNode action,
      // never through ReactFlow's internal reconciliation (which can cause ghost removals)
      const safe = changes.filter((c) => c.type !== "remove");
      onNodesChange(safe);
      if (!editMode) return;

      const posChanges = safe.filter(
        (c): c is Extract<NodeChange, { type: "position" }> =>
          c.type === "position" && !!c.position && !!c.id,
      );
      if (posChanges.length === 0) return;

      const changedIds = new Set(posChanges.map((c) => c.id));
      const { getBoundGroup } = useMapStore.getState();
      const startPos = dragStartPos.current;
      const extraChanges: NodeChange[] = [];
      const movedMembers = new Set<string>();

      for (const c of posChanges) {
        updateNodePosition(c.id, c.position!.x, c.position!.y);

        // Bound-group "move together": on the FIRST drag the other members are
        // not RF-selected yet, so apply the lead node's delta to them directly
        // from the positions captured at drag start (dead machinery, now used).
        const group = getBoundGroup(c.id);
        const start = startPos.get(c.id);
        if (!group || !start) continue;
        const dx = c.position!.x - start.x;
        const dy = c.position!.y - start.y;
        for (const memberId of group) {
          if (changedIds.has(memberId) || movedMembers.has(memberId)) continue;
          const ms = startPos.get(memberId);
          if (!ms) continue;
          movedMembers.add(memberId);
          const nx = ms.x + dx;
          const ny = ms.y + dy;
          extraChanges.push({ type: "position", id: memberId, position: { x: nx, y: ny }, dragging: true });
          updateNodePosition(memberId, nx, ny);
        }
      }

      if (extraChanges.length > 0) onNodesChange(extraChanges);
    },
    [editMode, onNodesChange, updateNodePosition],
  );

  const handleNodeDragStart = useCallback(
    (_event: MouseEvent | TouchEvent, _node: Node) => {
      if (!editMode) return;
      pushUndo();
      // Capture positions of ALL nodes so handleNodesChange can apply the
      // dragged node's delta to bound-group members on the very first drag.
      const allNodes = flow.getNodes();
      const posMap = new Map<string, { x: number; y: number }>();
      for (const n of allNodes) posMap.set(n.id, { ...n.position });
      dragStartPos.current = posMap;
    },
    [editMode, pushUndo, flow],
  );

  const handleNodeDragStop = useCallback(() => {
    if (!editMode) return;
    saveNodePositions();
    dragStartPos.current.clear();
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
      selectNodes(selNodes.map((n) => n.id));
    },
    [editMode, selectNodes],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/netmap-node-type")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      const nodeType = e.dataTransfer.getData("application/netmap-node-type");
      const label = e.dataTransfer.getData("application/netmap-node-label");
      if (!nodeType || !map || !editMode) return;
      e.preventDefault();

      const position = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      try {
        await api.createNode(map.id, {
          name: `new-${nodeType}`,
          label: label || nodeType,
          node_type: nodeType as import("@/types").NodeType,
          x: Math.round(position.x),
          y: Math.round(position.y),
          ...(nodeType === "group" ? { width: 400, height: 300 } : {}),
        });
        await loadMap(map.id);
      } catch (err) {
        console.error("Failed to create node on drop:", err);
      }
    },
    [map, editMode, flow, loadMap],
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

  if (errorStatus === 404) {
    return (
      <NotFound
        title="404"
        message="This map doesn't exist or has been deleted."
        backHref="/"
        backLabel="Back to maps"
      />
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
      <div className={`flex-1 relative${editMode ? " edit-mode" : ""}`} style={{ touchAction: "none" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          panOnDrag={editMode && selectMode ? [1, 2] : true}
          zoomOnPinch
          zoomOnScroll
          preventScrolling
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          onEdgeClick={handleEdgeClick}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onConnect={handleConnect}
          onSelectionChange={handleSelectionChange}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          nodesDraggable={editMode}
          selectionOnDrag={editMode && selectMode}
          multiSelectionKeyCode={editMode ? "Shift" : null}
          snapToGrid={snapToGrid}
          snapGrid={[24, 24]}
          connectionMode={ConnectionMode.Loose}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.1}
          maxZoom={3}
        >
          <Background gap={24} size={snapToGrid ? 1.5 : 0.5} color={
            resolvedTheme === "light"
              ? snapToGrid ? "hsl(30 6% 65%)" : "hsl(30 6% 78%)"
              : resolvedTheme === "scada"
                ? snapToGrid ? "#2a5a2a" : "#1a3a1a"
                : snapToGrid ? "hsl(220 15% 22%)" : "hsl(220 15% 12%)"
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
              if (type === "firewall") return "hsl(0 72% 50%)";
              if (type === "ix") return "hsl(280 60% 55%)";
              if (type === "transit" || type === "internet") return "hsl(340 65% 55%)";
              if (type === "pni") return "hsl(160 60% 45%)";
              // provider shares the cloud palette entry in the node badges
              if (type === "cloud" || type === "provider") return "hsl(190 90% 50%)";
              if (type === "customer") return "hsl(45 85% 50%)";
              if (type === "group") return "hsl(220 15% 24%)";
              if (type === "label") return "hsl(215 12% 40%)";
              return "hsl(220 10% 46%)";
            }}
            maskColor={
              resolvedTheme === "light"
                ? "hsl(38 12% 95% / 0.75)"
                : resolvedTheme === "scada"
                  ? "rgba(10, 10, 10, 0.8)"
                  : "hsl(220 20% 7% / 0.8)"
            }
          />
        </ReactFlow>
        <TrafficLegend scales={scales} />
        <CanvasSearch />

        {trafficError && (
          <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 noc-glass rounded px-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-node-firewall animate-pulse" />
            <span className="text-2xs text-noc-text-muted">Données live indisponibles</span>
          </div>
        )}

        <EditorToolbox />
        <EditorToolbar />
        {editMode && (
          <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
        )}

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
