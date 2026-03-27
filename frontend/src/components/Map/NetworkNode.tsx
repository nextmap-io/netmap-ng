import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import type { NodeType } from "@/types";

const NODE_ICONS: Record<NodeType, string> = {
  router: "RTR",
  switch_l3: "L3",
  switch_l2: "L2",
  server: "SRV",
  firewall: "FW",
  cloud: "IX",
  internet: "EXT",
  group: "GRP",
  custom: "---",
};

const NODE_BORDER: Record<NodeType, string> = {
  router: "border-node-router/40 hover:border-node-router/70",
  switch_l3: "border-node-switch-l3/40 hover:border-node-switch-l3/70",
  switch_l2: "border-node-switch-l2/40 hover:border-node-switch-l2/70",
  server: "border-node-server/40 hover:border-node-server/70",
  firewall: "border-node-firewall/40 hover:border-node-firewall/70",
  cloud: "border-node-cloud/40 hover:border-node-cloud/70",
  internet: "border-node-internet/40 hover:border-node-internet/70",
  group: "border-noc-border",
  custom: "border-noc-border",
};

const NODE_BADGE_BG: Record<NodeType, string> = {
  router: "bg-node-router/20 text-node-router",
  switch_l3: "bg-node-switch-l3/20 text-node-switch-l3",
  switch_l2: "bg-node-switch-l2/20 text-node-switch-l2",
  server: "bg-node-server/20 text-node-server",
  firewall: "bg-node-firewall/20 text-node-firewall",
  cloud: "bg-node-cloud/20 text-node-cloud",
  internet: "bg-node-internet/20 text-node-internet",
  group: "bg-noc-muted/20 text-noc-text-muted",
  custom: "bg-noc-muted/20 text-noc-text-muted",
};

const handleBase = "!bg-noc-muted !border-0 opacity-0 hover:opacity-100 transition-opacity";

function NetworkNodeComponent({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as NodeType) || "custom";
  const label = (data.label as string) || "";

  return (
    <div
      className={clsx(
        "rounded bg-noc-card border px-2.5 py-1.5 min-w-[72px] transition-all duration-150",
        NODE_BORDER[nodeType],
        selected && "ring-1 ring-accent/50 border-accent/40",
      )}
    >
      {/* Primary handles */}
      <Handle type="target" position={Position.Top} id="N" className={`!w-1.5 !h-1.5 ${handleBase}`} />
      <Handle type="target" position={Position.Left} id="W" className={`!w-1.5 !h-1.5 ${handleBase}`} />
      <Handle type="source" position={Position.Bottom} id="S" className={`!w-1.5 !h-1.5 ${handleBase}`} />
      <Handle type="source" position={Position.Right} id="E" className={`!w-1.5 !h-1.5 ${handleBase}`} />
      {/* Distribution handles */}
      <Handle type="target" position={Position.Top} id="N:25" style={{ left: "25%" }} className={`!w-1 !h-1 ${handleBase}`} />
      <Handle type="target" position={Position.Top} id="N:75" style={{ left: "75%" }} className={`!w-1 !h-1 ${handleBase}`} />
      <Handle type="source" position={Position.Bottom} id="S:25" style={{ left: "25%" }} className={`!w-1 !h-1 ${handleBase}`} />
      <Handle type="source" position={Position.Bottom} id="S:75" style={{ left: "75%" }} className={`!w-1 !h-1 ${handleBase}`} />
      <Handle type="target" position={Position.Left} id="W:25" style={{ top: "25%" }} className={`!w-1 !h-1 ${handleBase}`} />
      <Handle type="target" position={Position.Left} id="W:75" style={{ top: "75%" }} className={`!w-1 !h-1 ${handleBase}`} />
      <Handle type="source" position={Position.Right} id="E:25" style={{ top: "25%" }} className={`!w-1 !h-1 ${handleBase}`} />
      <Handle type="source" position={Position.Right} id="E:75" style={{ top: "75%" }} className={`!w-1 !h-1 ${handleBase}`} />

      <div className="flex items-center gap-1.5">
        <span
          className={clsx(
            "text-2xs font-semibold rounded px-1 py-px leading-tight tracking-wider",
            NODE_BADGE_BG[nodeType],
          )}
        >
          {NODE_ICONS[nodeType]}
        </span>
        <span className="text-2xs font-medium text-noc-text truncate max-w-[110px]">
          {label}
        </span>
      </div>

      {data.bandwidthLabel ? (
        <div className="text-2xs text-noc-text-dim mt-0.5 tracking-wide">
          {String(data.bandwidthLabel)}
        </div>
      ) : null}
    </div>
  );
}

export const NetworkNode = memo(NetworkNodeComponent);
