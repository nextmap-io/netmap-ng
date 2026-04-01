import { api } from "@/api/client";
import { useMapStore } from "@/hooks/useMapStore";
import type { NodeType } from "@/types";

const NODE_TYPES: { value: NodeType; label: string; badge: string }[] = [
  { value: "router", label: "Router", badge: "RTR" },
  { value: "switch_l3", label: "Switch L3", badge: "L3" },
  { value: "switch_l2", label: "Switch L2", badge: "L2" },
  { value: "server", label: "Server", badge: "SRV" },
  { value: "firewall", label: "Firewall", badge: "FW" },
  { value: "ix", label: "IX Peering", badge: "IX" },
  { value: "transit", label: "Transit", badge: "TR" },
  { value: "pni", label: "PNI", badge: "PNI" },
  { value: "provider", label: "Provider", badge: "PRV" },
  { value: "cloud", label: "Cloud", badge: "CLD" },
  { value: "internet", label: "External", badge: "NET" },
  { value: "group", label: "Group / Site", badge: "GRP" },
];

const BADGE_COLORS: Record<string, string> = {
  router: "text-node-router",
  switch_l3: "text-node-switch-l3",
  switch_l2: "text-node-switch-l2",
  server: "text-node-server",
  firewall: "text-node-firewall",
  cloud: "text-node-cloud",
  internet: "text-node-internet",
  group: "text-noc-text-muted",
};

export function EditorToolbox() {
  const { map, editMode, loadMap } = useMapStore();

  if (!editMode || !map) return null;

  const handleAddNode = async (nodeType: NodeType, label: string) => {
    try {
      await api.createNode(map.id, {
        name: `new-${nodeType}`,
        label,
        node_type: nodeType,
        x: 400 + Math.random() * 200,
        y: 300 + Math.random() * 200,
        ...(nodeType === "group" ? { width: 400, height: 300 } : {}),
      });
      await loadMap(map.id);
    } catch (e) {
      console.error("Failed to create node:", e);
    }
  };

  return (
    <div className="absolute top-14 left-3 noc-glass rounded z-10 w-60 max-h-[80vh] overflow-auto animate-fade-in">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-noc-border/50">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-traffic-out" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
          </svg>
          <span className="noc-label">Editor</span>
        </div>
      </div>

      <div className="p-3 space-y-4">
        {/* Add Node */}
        <section>
          <div className="noc-label mb-2">Add Node</div>
          <div className="grid grid-cols-2 gap-1">
            {NODE_TYPES.map((nt) => (
              <button
                key={nt.value}
                onClick={() => handleAddNode(nt.value, nt.label)}
                className="group flex items-center gap-1.5 px-2 py-1.5 text-2xs bg-noc-surface/50 border border-noc-border/50 rounded hover:border-noc-muted hover:bg-noc-surface transition-colors text-left"
              >
                <span className={`font-semibold tracking-wider ${BADGE_COLORS[nt.value]}`}>
                  {nt.badge}
                </span>
                <span className="text-noc-text-muted group-hover:text-noc-text transition-colors truncate">
                  {nt.label}
                </span>
              </button>
            ))}
          </div>
        </section>



      </div>
    </div>
  );
}
