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
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useShallow } from "zustand/react/shallow";

import { useMapStore } from "@/hooks/useMapStore";
import { toast } from "@/hooks/useToast";
import { api } from "@/api/client";
import { NetworkNode } from "./NetworkNode";
import { GroupNode } from "./GroupNode";
import { LabelNode } from "./LabelNode";
import { TrafficEdge } from "./NetworkLink";
import { TrafficLegend } from "./TrafficLegend";
import { CanvasSearch } from "./CanvasSearch";
import { UpdatedIndicator } from "./UpdatedIndicator";
import { TrafficGraphPanel } from "../Graph/TrafficGraph";
import { EditorToolbox } from "../Editor/EditorToolbox";
import { EditorToolbar } from "../Editor/EditorToolbar";
import { PropertyPanel } from "../Editor/PropertyPanel";
import { DeleteConfirmDialog } from "../Editor/DeleteConfirmDialog";
import { ToastViewport } from "../Layout/Toast";
import { useTheme } from "@/hooks/useTheme";
import { NotFound } from "../Layout/NotFound";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import type { MapNode, MapLink, NodeType } from "@/types";
import { buildEdges, computeLinkHandles, computeUsedHandles } from "@/utils/buildEdges";

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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface PendingDelete {
  nodeIds: string[];
  linkIds: string[];
  /** Links not explicitly selected that go away with their deleted nodes. */
  attachedLinks: number;
}

function MapViewInner() {
  const { mapId } = useParams<{ mapId: string }>();
  // Narrow selectors: this view no longer re-renders on unrelated store
  // changes (saving flags, undo stacks, …).
  const {
    map, traffic, nodeStatus, lastTrafficAt, trafficError, loading, error, errorStatus,
    editMode, snapToGrid, selectMode, searchQuery, activeTypeFilters, matchedNodeIds,
  } = useMapStore(
    useShallow((s) => ({
      map: s.map,
      traffic: s.traffic,
      nodeStatus: s.nodeStatus,
      lastTrafficAt: s.lastTrafficAt,
      trafficError: s.trafficError,
      loading: s.loading,
      error: s.error,
      errorStatus: s.errorStatus,
      editMode: s.editMode,
      snapToGrid: s.snapToGrid,
      selectMode: s.selectMode,
      searchQuery: s.searchQuery,
      activeTypeFilters: s.activeTypeFilters,
      matchedNodeIds: s.matchedNodeIds,
    })),
  );
  // Actions are stable references.
  const {
    loadMap, refreshMap, selectLink, stopTrafficPolling, selectNodes, selectLinks, clearSelection,
    createLink, undo, redo, applyNodePositions, deleteEntities,
  } = useMapStore(
    useShallow((s) => ({
      loadMap: s.loadMap,
      refreshMap: s.refreshMap,
      selectLink: s.selectLink,
      stopTrafficPolling: s.stopTrafficPolling,
      selectNodes: s.selectNodes,
      selectLinks: s.selectLinks,
      clearSelection: s.clearSelection,
      createLink: s.createLink,
      undo: s.undo,
      redo: s.redo,
      applyNodePositions: s.applyNodePositions,
      deleteEntities: s.deleteEntities,
    })),
  );

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const { resolvedTheme } = useTheme();
  const flow = useReactFlow();
  const dragStartPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  const showShortcutsRef = useRef(false);
  useEffect(() => { showShortcutsRef.current = showShortcuts; }, [showShortcuts]);
  const pendingDeleteRef = useRef(false);
  useEffect(() => { pendingDeleteRef.current = pendingDelete !== null; }, [pendingDelete]);

  useEffect(() => {
    // Initial load / map switch: full load (spinner, fresh undo history).
    if (mapId) loadMap(mapId, { reset: true });
    return () => stopTrafficPolling();
  }, [mapId, loadMap, stopTrafficPolling]);

  const scales = useMemo(() => map?.scales?.default ?? [], [map]);

  // Keyboard shortcuts for edit mode
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: KeyboardEvent) => {
      // The delete confirmation dialog owns the keyboard while open.
      if (pendingDeleteRef.current) return;

      // Delete / Backspace — confirm, then delete the whole selection at once
      if ((e.key === "Delete" || e.key === "Backspace") && !isInputFocused()) {
        const { selectedNodeIds, selectedLinkIds, map: currentMap } = useMapStore.getState();
        if (!currentMap || (selectedNodeIds.length === 0 && selectedLinkIds.length === 0)) return;
        e.preventDefault();
        const nodeSet = new Set(selectedNodeIds);
        const linkSet = new Set(selectedLinkIds);
        const attachedLinks = currentMap.links.filter(
          (l) => !linkSet.has(l.id) && (nodeSet.has(l.source_id) || nodeSet.has(l.target_id)),
        ).length;
        setPendingDelete({ nodeIds: [...selectedNodeIds], linkIds: [...selectedLinkIds], attachedLinks });
        return;
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
      if (e.key === "a" && (e.metaKey || e.ctrlKey) && !isInputFocused()) {
        e.preventDefault();
        const currentMap = useMapStore.getState().map;
        if (currentMap) {
          const allIds = currentMap.nodes.filter(n => n.node_type !== "group").map(n => n.id);
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
          try {
            const results = await Promise.all(
              selectedNodes.map(async (n) => {
                const created = await api.createNode(currentMap.id, {
                  name: `${n.name}-copy`,
                  label: `${n.label || n.name} (copy)`,
                  node_type: n.node_type,
                  x: n.x + 30,
                  y: n.y + 30,
                  width: n.width,
                  height: n.height,
                  parent_id: n.parent_id,
                  style: n.style,
                  observium_device_id: n.observium_device_id,
                  info_url: n.info_url,
                  extra: n.extra,
                });
                // The create schema has no `icon`; carry it over with an update.
                if (n.icon) await api.updateNode(currentMap.id, created.id, { icon: n.icon });
                return created;
              }),
            );
            await refreshMap();
            useMapStore.getState().selectNodes(results.map((r) => r.id));
          } catch (err) {
            toast.fromError(err, "Failed to duplicate nodes");
            // Some copies may have been created before the failure.
            await refreshMap();
          }
        })();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, clearSelection, selectNodes, undo, redo, refreshMap]);

  // Handles depend only on committed (store) positions, so they are computed
  // once per map change — not on every drag frame.
  const linkHandles = useMemo(
    () => (map ? computeLinkHandles(map.nodes, map.links) : new Map()),
    [map],
  );

  const baseNodes = useMemo(() => {
    if (!map) return [];
    const isFiltering = searchQuery.trim().length > 0 || activeTypeFilters.length > 0;
    const matched = new Set(matchedNodeIds);
    const isDimmed = (n: MapNode) =>
      isFiltering && n.node_type !== "group" && !matched.has(n.id);
    const usedHandles = computeUsedHandles(map.links, linkHandles);
    const boundIds = new Set<string>();
    for (const g of map.settings?.bound_groups ?? []) for (const id of g) boundIds.add(id);
    const groups = map.nodes
      .filter((n: MapNode) => n.node_type === "group")
      .map((n) => mapNodeToFlow(n, editMode, false, usedHandles.get(n.id), boundIds.has(n.id)));
    const others = map.nodes
      .filter((n: MapNode) => n.node_type !== "group")
      .map((n) => mapNodeToFlow(n, editMode, isDimmed(n), usedHandles.get(n.id), boundIds.has(n.id)));
    return [...groups, ...others];
  }, [map, linkHandles, editMode, searchQuery, activeTypeFilters, matchedNodeIds]);

  // Cheap overlay of the polled node status (no handle recomputation).
  const flowNodes = useMemo(
    () =>
      baseNodes.map((n) => {
        const status = nodeStatus[n.id]?.status;
        return status ? { ...n, data: { ...n.data, status } } : n;
      }),
    [baseNodes, nodeStatus],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    // Preserve selection from the store, and keep the live position of any
    // node being dragged (a status poll or refresh mid-drag must not snap it back).
    const sel = new Set(useMapStore.getState().selectedNodeIds);
    setNodes((prev) => {
      const dragging = new Map<string, { x: number; y: number }>();
      for (const n of prev) if (n.dragging) dragging.set(n.id, n.position);
      return flowNodes.map((n) => {
        const pos = dragging.get(n.id);
        const selected = sel.has(n.id);
        if (!pos && !selected) return n;
        return {
          ...n,
          ...(pos ? { position: pos, dragging: true } : {}),
          ...(selected ? { selected: true } : {}),
        };
      });
    });
  }, [flowNodes, setNodes]);

  // Rebuild edges when links, traffic or scales change. During a drag
  // ReactFlow moves connected edges natively (node positions live in RF state).
  const useGradientScale = map?.settings?.scale_mode === "gradient";
  const builtEdges = useMemo(
    () => (map ? buildEdges(map.links, linkHandles, { scales, traffic, gradient: useGradientScale }) : []),
    [map, linkHandles, scales, traffic, useGradientScale],
  );
  useEffect(() => {
    setEdges((prev) => {
      const sel = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return sel.size === 0 ? builtEdges : builtEdges.map((e) => (sel.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [builtEdges, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Filter out "remove" changes — nodes are only removed via our delete actions,
      // never through ReactFlow's internal reconciliation (which can cause ghost removals)
      const safe = changes.filter((c) => c.type !== "remove");
      onNodesChange(safe);
      if (!editMode) return;

      const posChanges = safe.filter(
        (c): c is Extract<NodeChange, { type: "position" }> =>
          c.type === "position" && !!c.position && !!c.id,
      );
      if (posChanges.length === 0) return;

      // Positions stay in ReactFlow state while dragging; they are committed
      // to the store (batch-move) once, on drag stop.
      const changedIds = new Set(posChanges.map((c) => c.id));
      const { getBoundGroup } = useMapStore.getState();
      const startPos = dragStartPos.current;
      const extraChanges: NodeChange[] = [];
      const movedMembers = new Set<string>();

      for (const c of posChanges) {
        // Bound-group "move together": on the FIRST drag the other members are
        // not RF-selected yet, so apply the lead node's delta to them directly
        // from the positions captured at drag start.
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
          extraChanges.push({
            type: "position",
            id: memberId,
            position: { x: ms.x + dx, y: ms.y + dy },
            dragging: c.dragging,
          });
        }
      }

      if (extraChanges.length > 0) onNodesChange(extraChanges);
    },
    [editMode, onNodesChange],
  );

  const handleNodeDragStart = useCallback<OnNodeDrag>(
    () => {
      if (!editMode) return;
      // Capture positions of ALL nodes so handleNodesChange can apply the
      // dragged node's delta to bound-group members on the very first drag.
      const posMap = new Map<string, { x: number; y: number }>();
      for (const n of flow.getNodes()) posMap.set(n.id, { ...n.position });
      dragStartPos.current = posMap;
    },
    [editMode, flow],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag>(
    (_event, _node, draggedNodes) => {
      if (!editMode) return;
      dragStartPos.current.clear();
      const current = useMapStore.getState().map;
      if (!current) return;
      // Final positions: RF state, overridden by the drag-stop payload (which
      // is guaranteed up to date for the dragged nodes themselves).
      const finalPos = new Map<string, { x: number; y: number }>();
      for (const n of flow.getNodes()) finalPos.set(n.id, n.position);
      for (const n of draggedNodes) finalPos.set(n.id, n.position);
      const moves: Array<{ id: string; x: number; y: number }> = [];
      for (const n of current.nodes) {
        const p = finalPos.get(n.id);
        if (p && (p.x !== n.x || p.y !== n.y)) moves.push({ id: n.id, x: p.x, y: p.y });
      }
      // One undo entry + one batch-move per drag; rolled back on failure.
      if (moves.length > 0) applyNodePositions(moves);
    },
    [editMode, flow, applyNodePositions],
  );

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
      const current = useMapStore.getState().map;
      if (!editMode || !current || !connection.source || !connection.target) return;
      const sourceNode = current.nodes.find((n: MapNode) => n.id === connection.source);
      const targetNode = current.nodes.find((n: MapNode) => n.id === connection.target);
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
    [editMode, createLink],
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
      const current = useMapStore.getState().map;
      if (!nodeType || !current || !editMode) return;
      e.preventDefault();

      const position = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      try {
        await api.createNode(current.id, {
          name: `new-${nodeType}`,
          label: label || nodeType,
          node_type: nodeType as NodeType,
          x: Math.round(position.x),
          y: Math.round(position.y),
          ...(nodeType === "group" ? { width: 400, height: 300 } : {}),
        });
      } catch (err) {
        toast.fromError(err, "Failed to create node");
        return;
      }
      await refreshMap();
    },
    [editMode, flow, refreshMap],
  );

  const handlePaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const handleConfirmDelete = useCallback(async () => {
    const pending = pendingDelete;
    setPendingDelete(null);
    if (!pending) return;
    clearSelection();
    await deleteEntities(pending.nodeIds, pending.linkIds);
  }, [pendingDelete, clearSelection, deleteEntities]);

  const handleCancelDelete = useCallback(() => setPendingDelete(null), []);

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

  const deleteMessage = pendingDelete
    ? [
        `Delete ${[
          pendingDelete.nodeIds.length > 0 ? plural(pendingDelete.nodeIds.length, "node") : null,
          pendingDelete.linkIds.length > 0 ? plural(pendingDelete.linkIds.length, "link") : null,
        ].filter(Boolean).join(" and ")}?`,
        pendingDelete.attachedLinks > 0
          ? `${plural(pendingDelete.attachedLinks, "attached link")} will also be removed.`
          : null,
        "This cannot be undone.",
      ].filter(Boolean).join(" ")
    : "";

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
          // Deletion goes through our confirm dialog + batch-delete instead.
          deleteKeyCode={null}
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

        {/* Data freshness + live-data error, right of the zoom controls */}
        <div className="absolute bottom-3 left-14 z-20 flex flex-col items-start gap-1.5">
          {trafficError && (
            <div className="flex items-center gap-1.5 noc-glass rounded px-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-node-firewall animate-pulse" />
              <span className="text-2xs text-noc-text-muted">Live data unavailable</span>
            </div>
          )}
          <UpdatedIndicator traffic={traffic} lastPoll={lastTrafficAt} />
        </div>

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
      <DeleteConfirmDialog
        open={pendingDelete !== null}
        title="Delete selection"
        message={deleteMessage}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
      <ToastViewport />
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
