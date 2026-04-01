import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import type { NodeType } from "@/types";

const NODE_ICONS: Record<NodeType, string> = {
  router: "RTR", switch_l3: "L3", switch_l2: "L2", server: "SRV",
  firewall: "FW", cloud: "IX", internet: "EXT", group: "GRP", custom: "---",
};

const NODE_BORDER: Record<NodeType, string> = {
  router: "border-node-router/40 hover:border-node-router/70",
  switch_l3: "border-node-switch-l3/40 hover:border-node-switch-l3/70",
  switch_l2: "border-node-switch-l2/40 hover:border-node-switch-l2/70",
  server: "border-node-server/40 hover:border-node-server/70",
  firewall: "border-node-firewall/40 hover:border-node-firewall/70",
  cloud: "border-node-cloud/40 hover:border-node-cloud/70",
  internet: "border-node-internet/40 hover:border-node-internet/70",
  group: "border-noc-border", custom: "border-noc-border",
};

const NODE_BADGE_BG: Record<NodeType, string> = {
  router: "bg-node-router/20 text-node-router",
  switch_l3: "bg-node-switch-l3/20 text-node-switch-l3",
  switch_l2: "bg-node-switch-l2/20 text-node-switch-l2",
  server: "bg-node-server/20 text-node-server",
  firewall: "bg-node-firewall/20 text-node-firewall",
  cloud: "bg-node-cloud/20 text-node-cloud",
  internet: "bg-node-internet/20 text-node-internet",
  group: "bg-noc-muted/20 text-noc-text-muted", custom: "bg-noc-muted/20 text-noc-text-muted",
};

const hStyle = "!bg-noc-muted/50 !border-0 !w-[3px] !h-[3px] !min-w-0 !min-h-0";

/** Generate handles at every 5% increment on all 4 sides */
function AllHandles() {
  const handles = useMemo(() => {
    const h: Array<{ pos: Position; id: string; style: React.CSSProperties; type: "source" | "target" }> = [];
    // Primary handles at 50%
    h.push({ pos: Position.Top, id: "N", style: {}, type: "target" });
    h.push({ pos: Position.Bottom, id: "S", style: {}, type: "source" });
    h.push({ pos: Position.Left, id: "W", style: {}, type: "target" });
    h.push({ pos: Position.Right, id: "E", style: {}, type: "source" });
    // Distribution handles every 5%
    for (let pct = 5; pct <= 95; pct += 5) {
      if (pct === 50) continue;
      h.push({ pos: Position.Top, id: `N:${pct}`, style: { left: `${pct}%` }, type: "target" });
      h.push({ pos: Position.Bottom, id: `S:${pct}`, style: { left: `${pct}%` }, type: "source" });
      h.push({ pos: Position.Left, id: `W:${pct}`, style: { top: `${pct}%` }, type: "target" });
      h.push({ pos: Position.Right, id: `E:${pct}`, style: { top: `${pct}%` }, type: "source" });
    }
    return h;
  }, []);

  return (
    <>
      {handles.map((h) => (
        <Handle key={h.id} type={h.type} position={h.pos} id={h.id} style={h.style} className={hStyle} />
      ))}
    </>
  );
}

function NetworkNodeComponent({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as NodeType) || "custom";
  const label = (data.label as string) || "";
  const nodeWidth = Number(data.width) || 0;
  const nodeHeight = Number(data.height) || 0;
  const isLarge = nodeWidth > 0 && nodeHeight > 0;

  return (
    <div
      className={clsx(
        "rounded bg-noc-card border transition-all duration-150 flex items-center justify-center",
        NODE_BORDER[nodeType],
        selected && "ring-1 ring-accent/50 border-accent/40",
        isLarge ? "flex-col gap-1 p-2" : "px-2.5 py-1.5 min-w-[72px]",
      )}
      style={isLarge ? { width: nodeWidth, height: nodeHeight } : undefined}
    >
      <AllHandles />

      <div className="flex items-center gap-1.5">
        <span className={clsx("text-2xs font-semibold rounded px-1 py-px leading-tight tracking-wider", NODE_BADGE_BG[nodeType])}>
          {NODE_ICONS[nodeType]}
        </span>
        <span className="text-2xs font-medium text-noc-text truncate max-w-[110px]">{label}</span>
      </div>

      {data.bandwidthLabel ? (
        <div className="text-2xs text-noc-text-dim mt-0.5 tracking-wide">{String(data.bandwidthLabel)}</div>
      ) : null}
    </div>
  );
}

export const NetworkNode = memo(NetworkNodeComponent);
