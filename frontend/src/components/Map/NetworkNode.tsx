import { memo, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import type { NodeType } from "@/types";

const NODE_ICONS: Record<NodeType, string> = {
  router: "RTR", switch_l3: "L3", switch_l2: "L2", server: "SRV",
  firewall: "FW", cloud: "CLD", internet: "NET",
  ix: "IX", transit: "TR", pni: "PNI", provider: "PRV",
  customer: "CST", group: "GRP", label: "TXT", custom: "---",
};

const NODE_BORDER: Record<NodeType, string> = {
  router: "border-node-router/40 hover:border-node-router/70",
  switch_l3: "border-node-switch-l3/40 hover:border-node-switch-l3/70",
  switch_l2: "border-node-switch-l2/40 hover:border-node-switch-l2/70",
  server: "border-node-server/40 hover:border-node-server/70",
  firewall: "border-node-firewall/40 hover:border-node-firewall/70",
  cloud: "border-node-cloud/40 hover:border-node-cloud/70",
  internet: "border-node-internet/40 hover:border-node-internet/70",
  ix: "border-[hsl(280,60%,55%)]/40 hover:border-[hsl(280,60%,55%)]/70",
  transit: "border-node-internet/40 hover:border-node-internet/70",
  pni: "border-[hsl(160,60%,45%)]/40 hover:border-[hsl(160,60%,45%)]/70",
  provider: "border-node-cloud/40 hover:border-node-cloud/70",
  customer: "border-node-customer/40 hover:border-node-customer/70",
  group: "border-noc-border", label: "border-transparent", custom: "border-noc-border",
};

const NODE_BADGE_BG: Record<NodeType, string> = {
  router: "bg-node-router/20 text-node-router",
  switch_l3: "bg-node-switch-l3/20 text-node-switch-l3",
  switch_l2: "bg-node-switch-l2/20 text-node-switch-l2",
  server: "bg-node-server/20 text-node-server",
  firewall: "bg-node-firewall/20 text-node-firewall",
  cloud: "bg-node-cloud/20 text-node-cloud",
  internet: "bg-node-internet/20 text-node-internet",
  ix: "bg-[hsl(280,60%,55%)]/20 text-[hsl(280,60%,55%)]",
  transit: "bg-node-internet/20 text-node-internet",
  pni: "bg-[hsl(160,60%,45%)]/20 text-[hsl(160,60%,45%)]",
  provider: "bg-node-cloud/20 text-node-cloud",
  customer: "bg-node-customer/20 text-node-customer",
  group: "bg-noc-muted/20 text-noc-text-muted", label: "bg-transparent text-noc-text-muted", custom: "bg-noc-muted/20 text-noc-text-muted",
};

const hStyle = "!bg-transparent !border-0 !w-[3px] !h-[3px] !min-w-0 !min-h-0";

const HANDLE_SIDES = [
  { pos: Position.Top, prefix: "N", styleProp: "left" as const },
  { pos: Position.Bottom, prefix: "S", styleProp: "left" as const },
  { pos: Position.Left, prefix: "W", styleProp: "top" as const },
  { pos: Position.Right, prefix: "E", styleProp: "top" as const },
];

interface HandleDef {
  pos: Position;
  id: string;
  style: React.CSSProperties;
  type: "source" | "target";
}

/**
 * Handles for a node. To avoid rendering ~150 handles per node, the fine
 * per-percentage handles are only mounted when the node is active
 * (selected/hovered) OR when a connected edge actually references them
 * (`usedHandles`). The 8 coarse side anchors are always mounted so anchoring
 * and new-link dragging keep working.
 */
function AllHandles({ showAll, usedHandles }: { showAll: boolean; usedHandles: Set<string> }) {
  const handles = useMemo<HandleDef[]>(() => {
    const result: HandleDef[] = [];
    for (const { pos, prefix, styleProp } of HANDLE_SIDES) {
      // Coarse anchors (always mounted).
      result.push({ pos, id: prefix, style: {}, type: "source" });
      result.push({ pos, id: `${prefix}-t`, style: {}, type: "target" });
      for (let pct = 5; pct <= 95; pct += 5) {
        if (pct === 50) continue;
        const srcId = `${prefix}:${pct}`;
        const tgtId = `${prefix}:${pct}-t`;
        const style = { [styleProp]: `${pct}%` };
        if (showAll || usedHandles.has(srcId)) {
          result.push({ pos, id: srcId, style, type: "source" });
        }
        if (showAll || usedHandles.has(tgtId)) {
          result.push({ pos, id: tgtId, style, type: "target" });
        }
      }
    }
    return result;
  }, [showAll, usedHandles]);
  return <>{handles.map((h) => <Handle key={h.id} type={h.type} position={h.pos} id={h.id} style={h.style} className={hStyle} />)}</>;
}

function NetworkNodeComponent({ data, selected }: NodeProps) {
  const [hovered, setHovered] = useState(false);
  const nodeType = (data.nodeType as NodeType) || "custom";
  const label = (data.label as string) || "";
  const nodeWidth = Number(data.width) || 0;
  const nodeHeight = Number(data.height) || 0;
  const isLarge = nodeWidth > 0 && nodeHeight > 0;
  const locked = !!data.locked;
  const isBound = !!data.isBound;
  const usedHandles = useMemo(
    () => new Set(Array.isArray(data.usedHandles) ? (data.usedHandles as string[]) : []),
    [data.usedHandles],
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={clsx(
        "rounded bg-noc-card border transition-all duration-150 flex items-center justify-center",
        NODE_BORDER[nodeType] || NODE_BORDER.custom,
        selected && "ring-1 ring-accent/50 border-accent/40",
        isBound && !selected && "ring-1 ring-accent/20",
        isLarge ? "flex-col gap-1 p-2" : "px-2.5 py-1.5 min-w-[72px]",
      )}
      style={isLarge ? { width: nodeWidth, height: nodeHeight } : undefined}
    >
      <AllHandles showAll={!!selected || hovered} usedHandles={usedHandles} />

      {/* Status glyphs: locked / bound-group member */}
      {(locked || isBound) && (
        <div className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5">
          {locked && (
            <span title="Locked" className="text-noc-text-dim bg-noc-card rounded-full p-px">
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
          )}
          {isBound && (
            <span title="Bound group (moves together)" className="text-accent/70 bg-noc-card rounded-full p-px">
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M9 12H7a3 3 0 0 1 0-6h2M15 6h2a3 3 0 0 1 0 6h-2M8 9h8" />
              </svg>
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <span className={clsx("node-badge text-2xs font-semibold rounded px-1 py-px leading-tight tracking-wider", NODE_BADGE_BG[nodeType] || NODE_BADGE_BG.custom)}>
          {NODE_ICONS[nodeType] || "---"}
        </span>
        <span title={label} className="text-2xs font-medium text-noc-text truncate max-w-[110px]">{label}</span>
      </div>
      {data.bandwidthLabel ? (
        <div title={String(data.bandwidthLabel)} className="text-2xs text-noc-text-dim mt-0.5 tracking-wide">{String(data.bandwidthLabel)}</div>
      ) : null}
    </div>
  );
}

export const NetworkNode = memo(NetworkNodeComponent);
