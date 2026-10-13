import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { api } from "@/api/client";
import { useMapStore } from "@/hooks/useMapStore";
import type { NodeType } from "@/types";

const NODE_TYPES: { value: NodeType; label: string; badge: string }[] = [
  { value: "router", label: "Router", badge: "RTR" },
  { value: "switch_l3", label: "Switch L3", badge: "L3" },
  { value: "switch_l2", label: "Switch L2", badge: "L2" },
  { value: "server", label: "Server", badge: "SRV" },
  { value: "firewall", label: "Firewall", badge: "FW" },
  { value: "customer", label: "Customer", badge: "CST" },
  { value: "ix", label: "IX Peering", badge: "IX" },
  { value: "transit", label: "Transit", badge: "TR" },
  { value: "pni", label: "PNI", badge: "PNI" },
  { value: "provider", label: "Provider", badge: "PRV" },
  { value: "cloud", label: "Cloud", badge: "CLD" },
  { value: "internet", label: "External", badge: "NET" },
  { value: "group", label: "Group / Site", badge: "GRP" },
  { value: "label", label: "Text Label", badge: "TXT" },
];

export function EditorToolbox() {
  const { map, editMode, loadMap } = useMapStore();
  const flow = useReactFlow();

  const handleDragStart = useCallback(
    (e: React.DragEvent, nodeType: NodeType, label: string) => {
      e.dataTransfer.setData("application/netmap-node-type", nodeType);
      e.dataTransfer.setData("application/netmap-node-label", label);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleAddNode = useCallback(
    async (nodeType: NodeType, label: string) => {
      if (!map) return;
      try {
        // Fallback: spawn at center of current viewport
        const viewport = flow.getViewport();
        const container = document.querySelector(".react-flow");
        const w = container?.clientWidth ?? 800;
        const h = container?.clientHeight ?? 600;
        const centerX = (-viewport.x + w / 2) / viewport.zoom;
        const centerY = (-viewport.y + h / 2) / viewport.zoom;

        await api.createNode(map.id, {
          name: `new-${nodeType}`,
          label,
          node_type: nodeType,
          x: Math.round(centerX + (Math.random() - 0.5) * 60),
          y: Math.round(centerY + (Math.random() - 0.5) * 60),
          ...(nodeType === "group" ? { width: 400, height: 300 } : {}),
        });
        await loadMap(map.id);
      } catch (e) {
        console.error("Failed to create node:", e);
      }
    },
    [map, flow, loadMap],
  );

  if (!editMode || !map) return null;

  return (
    <div className="absolute top-14 left-3 z-10 w-60 max-w-[calc(100vw-32px)] max-h-[80vh] overflow-auto bg-card border border-border rounded">
      <div className="px-3 pt-3 pb-2">
        <h2 className="text-lg font-semibold text-foreground">Add a node</h2>
        <p className="text-sm text-muted-foreground">Drag a type onto the map, or click to add it at the centre.</p>
      </div>

      <div className="px-3 pb-3">
        <div className="grid grid-cols-2 gap-1">
          {NODE_TYPES.map((nt) => (
            <button
              key={nt.value}
              draggable
              onDragStart={(e) => handleDragStart(e, nt.value, nt.label)}
              onClick={() => handleAddNode(nt.value, nt.label)}
              title={`${nt.label} (${nt.badge})`}
              className="px-2 py-1.5 text-sm text-foreground bg-background border border-border rounded hover:bg-muted transition-colors text-left truncate cursor-grab active:cursor-grabbing"
            >
              {nt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
