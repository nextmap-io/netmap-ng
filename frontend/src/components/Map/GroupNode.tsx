import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

function GroupNodeComponent({ data }: NodeProps) {
  const label = (data.label as string) || "";
  const bgColor = data.bgColor as string | undefined;

  return (
    <div
      className="w-full h-full rounded border border-dashed border-noc-border/50 p-2"
      style={bgColor ? { backgroundColor: bgColor } : undefined}
    >
      <div className="noc-label px-1 flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-noc-text-dim" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        {label}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeComponent);
