import { useState } from "react";
import { api } from "@/api/client";
import { useMapStore } from "@/hooks/useMapStore";
import type { NodeType } from "@/types";

const NODE_TYPES: { value: NodeType; label: string; badge: string }[] = [
  { value: "router", label: "Router", badge: "RTR" },
  { value: "switch_l3", label: "Switch L3", badge: "L3" },
  { value: "switch_l2", label: "Switch L2", badge: "L2" },
  { value: "server", label: "Server", badge: "SRV" },
  { value: "firewall", label: "Firewall", badge: "FW" },
  { value: "cloud", label: "IX / Cloud", badge: "IX" },
  { value: "internet", label: "External", badge: "EXT" },
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

export function MapEditor() {
  const { map, editMode, loadMap } = useMapStore();
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      await api.generateMap({
        device_ids: [],
        instructions: aiPrompt,
        map_id: map.id,
      });
      await loadMap(map.id);
    } catch {
      setAiError("Generation failed. Check API key and try again.");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="absolute top-3 left-3 noc-glass rounded z-10 w-60 max-h-[80vh] overflow-auto animate-fade-in">
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

        {/* Separator */}
        <div className="h-px bg-noc-border/50" />

        {/* AI Layout */}
        <section>
          <div className="noc-label mb-2 flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 2a4 4 0 014 4c0 1.95-1.4 3.58-3.25 3.93L12 22l-.75-12.07A4.001 4.001 0 0112 2z" />
            </svg>
            AI Layout
          </div>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            maxLength={2000}
            placeholder="Describe your topology or import from Observium..."
            className="w-full bg-noc-bg text-2xs text-noc-text rounded border border-noc-border p-2 resize-none h-16 placeholder:text-noc-text-dim focus-visible:ring-1 focus-visible:ring-accent/50 focus:outline-none"
          />
          {aiError && (
            <p className="text-2xs text-node-firewall mt-1 mb-1">{aiError}</p>
          )}
          <button
            onClick={handleAiGenerate}
            disabled={aiLoading || !aiPrompt.trim()}
            className="w-full mt-1.5 px-3 py-1.5 bg-accent/10 text-accent border border-accent/20 rounded text-2xs font-medium tracking-wider uppercase hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {aiLoading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-3 h-3 border border-accent/40 border-t-accent rounded-full animate-spin-slow" />
                Generating
              </span>
            ) : (
              "Generate with Claude"
            )}
          </button>
        </section>
      </div>
    </div>
  );
}
