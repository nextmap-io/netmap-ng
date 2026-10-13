import { useCallback, useEffect, useMemo, useState } from "react";
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

import { api, ApiError } from "@/api/client";
import { useTheme } from "@/hooks/useTheme";
import { NetworkNode } from "./NetworkNode";
import { GroupNode } from "./GroupNode";
import { LabelNode } from "./LabelNode";
import { TrafficEdge } from "./NetworkLink";
import { TrafficLegend } from "./TrafficLegend";
import { RightNowBand } from "./RightNowBand";
import { canvasColors, useThemeKey } from "./canvasTheme";
import { TrafficGraphPanel } from "../Graph/TrafficGraph";
import { NotFound } from "../Layout/NotFound";
import type { NetmapData, MapNode, NodeStatusData, TrafficData } from "@/types";
import { buildEdges, computeLinkHandles, computeUsedHandles } from "@/utils/buildEdges";

const nodeTypes = { network: NetworkNode, group: GroupNode, label: LabelNode };
const edgeTypes = { traffic: TrafficEdge };

/** Read-only counterpart of MapView's mapNodeToFlow (no edit-only extras). */
function mapNodeToFlow(n: MapNode, usedHandles: string[] = [], status?: string): Node {
  const isGroup = n.node_type === "group";
  const isLabel = n.node_type === "label";
  const flowType = isGroup ? "group" : isLabel ? "label" : "network";
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
      width: n.width,
      height: n.height,
      bgColor: n.style?.bg_color,
      style: n.style,
      usedHandles,
      ...(status ? { status } : {}),
    },
    style: isGroup ? { width: n.width || 400, height: n.height || 300 } : undefined,
    zIndex: isGroup ? -1 : (n.z_order || 0),
    draggable: false,
  };
}

function PublicMapInner() {
  const { token } = useParams<{ token: string }>();
  // Map load result, keyed by the token it was fetched for: a token change
  // shows the spinner until that map arrives, without resetting state
  // synchronously in an effect.
  const [loaded, setLoaded] = useState<{
    token: string;
    map: NetmapData | null;
    error: string | null;
    errorStatus: number | null;
  } | null>(null);
  const [traffic, setTraffic] = useState<TrafficData>({});
  const [nodeStatus, setNodeStatus] = useState<NodeStatusData>({});
  const [lastPoll, setLastPoll] = useState<number | null>(null);
  const [trafficFailed, setTrafficFailed] = useState(false);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const { theme, cycle } = useTheme();
  // Theme key (the <html> class): resolved canvas colors depend on it.
  const themeKey = useThemeKey();
  const colors = useMemo(() => canvasColors(themeKey), [themeKey]);

  const current = token && loaded?.token === token ? loaded : null;
  const map = current?.map ?? null;
  const error = current?.error ?? null;
  const errorStatus = current?.errorStatus ?? null;
  const loading = !!token && current === null;

  useEffect(() => {
    if (!token) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    api.getPublicMap(token)
      .then((data) => {
        if (cancelled) return;
        setLoaded({ token, map: data, error: null, errorStatus: null });
        const fetchTraffic = () => {
          api.getPublicTraffic(token)
            .then((t) => {
              if (cancelled) return;
              setTraffic(t);
              setLastPoll(Date.now());
              setTrafficFailed(false);
            })
            .catch(() => { if (!cancelled) setTrafficFailed(true); });
          // Older backends have no nodes-status route (404): just no status.
          api.getPublicNodeStatus(token)
            .then((ns) => { if (!cancelled) setNodeStatus(ns); })
            .catch(() => {});
        };
        fetchTraffic();
        interval = setInterval(fetchTraffic, Math.max((data.settings?.refresh_interval ?? 300) * 1000, 30000));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to load map";
        const status = e instanceof ApiError ? e.status : null;
        setLoaded({ token, map: null, error: message, errorStatus: status });
      });
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [token]);

  const scales = useMemo(() => map?.scales?.default ?? [], [map]);

  const linkHandles = useMemo(
    () => (map ? computeLinkHandles(map.nodes, map.links) : new Map()),
    [map],
  );

  const initialNodes = useMemo(() => {
    if (!map) return [];
    const usedHandles = computeUsedHandles(map.links, linkHandles);
    const toFlow = (n: MapNode) => mapNodeToFlow(n, usedHandles.get(n.id), nodeStatus[n.id]?.status);
    const groups = map.nodes.filter((n) => n.node_type === "group").map(toFlow);
    const others = map.nodes.filter((n) => n.node_type !== "group").map(toFlow);
    return [...groups, ...others];
  }, [map, linkHandles, nodeStatus]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState<Edge>([]);

  useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);

  const useGradientScale = map?.settings?.scale_mode === "gradient";
  useEffect(() => {
    if (!map) return;
    setEdges(buildEdges(map.links, linkHandles, { scales, traffic, gradient: useGradientScale, themeKey }));
  }, [map, linkHandles, scales, traffic, useGradientScale, themeKey, setEdges]);

  const showGraph = map?.public_settings?.show_graph === true;
  const selectedLink = showGraph && selectedLinkId
    ? map?.links.find((l) => l.id === selectedLinkId) ?? null
    : null;
  // Stable per link: TrafficGraphPanel refetches when the fetcher identity changes.
  const historyFetcher = useCallback(
    (period: string) => api.getPublicLinkHistory(token ?? "", selectedLinkId ?? "", period),
    [token, selectedLinkId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <span className="text-sm text-muted-foreground">Loading map…</span>
      </div>
    );
  }

  if (errorStatus === 404 || (!loading && !map)) {
    return (
      <NotFound
        title="404"
        message="This public map doesn't exist or has been revoked."
        backHref="/welcome"
        backLabel="Browse public maps"
        fullScreen
      />
    );
  }

  if (error || !map) {
    return (
      <div className="flex items-center justify-center h-screen bg-background px-4">
        <div className="max-w-sm text-center">
          <p className="text-base text-foreground mb-1">This map isn't available.</p>
          <p className="text-sm text-muted-foreground">{error || "Not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="h-12 shrink-0 border-b border-border bg-background flex items-center justify-between gap-3 px-4">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-sm font-semibold text-foreground-secondary shrink-0">Netmap</span>
          <h1 title={map.name} className="text-base font-semibold text-foreground truncate">{map.name}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={cycle}
            className="p-1.5 rounded border border-border text-foreground-secondary hover:text-foreground hover:bg-muted transition-colors"
            title={`Theme: ${theme}`}
            aria-label={`Theme: ${theme}`}
          >
            {theme === "dark" && (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            {theme === "light" && (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            )}
            {theme === "scada" && (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 20V10M12 20V4M6 20v-6" />
              </svg>
            )}
            {theme === "system" && (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
              </svg>
            )}
          </button>
          <a
            href="/auth/login"
            className="px-2.5 py-1 rounded border border-border text-sm text-foreground hover:bg-muted transition-colors"
          >
            Sign in
          </a>
        </div>
      </header>

      <RightNowBand
        nodes={map.nodes}
        links={map.links}
        traffic={traffic}
        nodeStatus={nodeStatus}
        scales={scales}
        lastPoll={lastPoll}
        liveDataError={trafficFailed}
        refreshInterval={map.settings?.refresh_interval}
        // Respect the public settings: no bit rates unless show_bps.
        showBps={map.public_settings?.show_bps === true}
      />

      <div className="flex-1 min-h-0 relative" style={{ touchAction: "none" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onEdgeClick={showGraph ? (_e, edge) => setSelectedLinkId(edge.id) : undefined}
          onPaneClick={() => setSelectedLinkId(null)}
          panOnDrag
          zoomOnPinch
          zoomOnScroll
          preventScrolling
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.1}
          maxZoom={3}
        >
          <Background gap={24} size={1} color={colors.dots} />
          <Controls showInteractive={false} />
          <MiniMap
            className="max-md:hidden"
            pannable
            zoomable
            // Neutral: node types are named on the canvas, not colored.
            nodeColor={(n) =>
              n.type === "group" ? colors.group : n.type === "label" ? "transparent" : colors.node
            }
            nodeStrokeWidth={0}
            maskColor={colors.mask}
          />
        </ReactFlow>
        <TrafficLegend scales={scales} />
        {selectedLink && (
          <TrafficGraphPanel
            link={selectedLink}
            fetcher={historyFetcher}
            onClose={() => setSelectedLinkId(null)}
          />
        )}
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
