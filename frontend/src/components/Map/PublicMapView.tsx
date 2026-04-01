import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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

// Reuse the same helpers from MapView (import not possible due to coupling)
function getScaleColor(pct: number, scales: ScaleBand[]): string {
  for (const band of scales) {
    if (pct >= band.min && pct <= band.max) return band.color;
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
        // Start traffic polling
        const fetchTraffic = () => {
          api.getPublicTraffic(token).then(setTraffic).catch(() => {});
        };
        fetchTraffic();
        interval = setInterval(fetchTraffic, (data.settings?.refresh_interval ?? 300) * 1000);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [token]);

  const scales = useMemo(() => map?.scales?.default ?? [], [map]);

  const nodes = useMemo(() => {
    if (!map) return [];
    return map.nodes.map((n: MapNode): Node => {
      const isGroup = n.node_type === "group";
      return {
        id: n.id,
        type: isGroup ? "group" : "network",
        position: { x: n.x, y: n.y },
        parentId: n.parent_id || undefined,
        extent: n.parent_id ? "parent" as const : undefined,
        data: { label: n.label || n.name, nodeType: n.node_type, width: n.width, height: n.height },
        style: isGroup ? { width: n.width || 400, height: n.height || 300 } : undefined,
        zIndex: isGroup ? -1 : 0,
        draggable: false,
        selectable: false,
      };
    });
  }, [map]);

  const edges = useMemo(() => {
    if (!map) return [];
    return map.links.map((l: MapLink): Edge => {
      const t = traffic[l.id];
      const inPct = t?.in_pct ?? 0;
      const outPct = t?.out_pct ?? 0;
      return {
        id: l.id,
        source: l.source_id,
        target: l.target_id,
        type: "traffic",
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
      };
    });
  }, [map, traffic, scales]);

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
      {/* Minimal header for public view */}
      <div className="h-10 border-b border-noc-border bg-noc-bg/80 backdrop-blur-md flex items-center px-4">
        <span className="text-xs font-semibold tracking-wider text-accent">NETMAP</span>
        <span className="text-2xs text-noc-text-muted ml-3">{map.name}</span>
      </div>

      <div className="h-[calc(100vh-40px)]">
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
