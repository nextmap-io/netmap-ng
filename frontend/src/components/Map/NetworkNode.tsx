import { memo, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import type { NodeStatus, NodeType } from "@/types";

/** Neutral short type code (no per-type colour: the type is named, not tinted). */
const NODE_ICONS: Record<NodeType, string> = {
  router: "RTR", switch_l3: "L3", switch_l2: "L2", server: "SRV",
  firewall: "FW", cloud: "CLD", internet: "NET",
  ix: "IX", transit: "TR", pni: "PNI", provider: "PRV",
  customer: "CST", group: "GRP", label: "TXT", custom: "—",
};

export const NODE_TYPE_NAMES: Record<NodeType, string> = {
  router: "Router", switch_l3: "L3 switch", switch_l2: "L2 switch", server: "Server",
  firewall: "Firewall", cloud: "Cloud", internet: "Internet",
  ix: "Internet exchange", transit: "Transit", pni: "Private interconnect", provider: "Provider",
  customer: "Customer", group: "Group", label: "Label", custom: "Custom",
};

const hStyle = "bg-transparent! border-0! w-[3px]! h-[3px]! min-w-0! min-h-0!";

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
  // Stack type/name/capacity only in boxes tall enough; low boxes get one row.
  const stacked = isLarge && nodeHeight >= 44;
  // Narrow boxes drop the type word so the name keeps the room (it stays in
  // the tooltip).
  const showType = !isLarge || nodeWidth >= 80;
  const locked = !!data.locked;
  const isBound = !!data.isBound;
  const status = data.status as NodeStatus | undefined;
  const isDown = status === "down";
  const isUnknown = status === "unknown";
  const usedHandles = useMemo(
    () => new Set(Array.isArray(data.usedHandles) ? (data.usedHandles as string[]) : []),
    [data.usedHandles],
  );

  // Inner elements use `rounded-sm` (same 4px): the selection ring in
  // index.css targets `.react-flow__node.selected .rounded`, i.e. the surface.
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={clsx(
        "relative rounded bg-card border border-border hover:border-muted-foreground transition-colors duration-100 flex items-center justify-center",
        // No overflow clipping here: the Down badge, status ring and lock /
        // bound glyphs sit outside the box. The text row clips instead.
        isLarge ? (stacked ? "flex-col gap-0.5 px-1.5" : "px-1.5") : "px-2 py-1 min-w-[72px]",
      )}
      style={isLarge ? { width: nodeWidth, height: nodeHeight } : undefined}
    >
      <AllHandles showAll={!!selected || hovered} usedHandles={usedHandles} />

      {/* Device status: a 2px incident ring plus the word "Down" when down, a
          subtle muted dot when unknown, nothing when up. No animation. */}
      {isDown && (
        <>
          <span
            aria-hidden
            className="absolute -inset-[3px] rounded-md border-2 border-destructive pointer-events-none"
          />
          <span
            title="Device down"
            className="absolute -top-2.5 left-1 rounded-sm px-1 canvas-text font-semibold bg-destructive text-on-destructive"
          >
            Down
          </span>
        </>
      )}
      {isUnknown && (
        <span
          title="Device status unknown"
          className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-muted-foreground border border-card"
        />
      )}

      {/* Status glyphs: locked / bound-group member */}
      {(locked || isBound) && (
        <div className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5">
          {locked && (
            <span title="Locked" className="text-muted-foreground bg-card rounded-full p-px">
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
          )}
          {isBound && (
            <span title="Bound group (moves together)" className="text-link bg-card rounded-full p-px">
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M9 12H7a3 3 0 0 1 0-6h2M15 6h2a3 3 0 0 1 0 6h-2M8 9h8" />
              </svg>
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 min-w-0 max-w-full overflow-hidden" title={`${NODE_TYPE_NAMES[nodeType] || "Custom"} · ${label}`}>
        {showType && (
          <span className="shrink-0 canvas-text text-muted-foreground">{NODE_ICONS[nodeType] || "—"}</span>
        )}
        <span className={clsx("canvas-name text-foreground truncate", !isLarge && "max-w-[140px]")}>{label}</span>
      </div>
      {data.bandwidthLabel && (stacked || !isLarge) ? (
        <div title={String(data.bandwidthLabel)} className="canvas-text text-muted-foreground">{String(data.bandwidthLabel)}</div>
      ) : null}
    </div>
  );
}

export const NetworkNode = memo(NetworkNodeComponent);
