import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

/**
 * A region (site, rack, logical group): a soft dashed rule and no fill unless
 * the map author set one; the title is a quiet sentence-case caption.
 * The `rounded` class carries the selection ring (index.css).
 */
function GroupNodeComponent({ data }: NodeProps) {
  const label = (data.label as string) || "";
  const bgColor = data.bgColor as string | undefined;

  return (
    <div
      className="w-full h-full rounded border border-dashed border-border-soft p-2"
      style={bgColor ? { backgroundColor: bgColor } : undefined}
    >
      <div title={label} className="px-1 text-sm font-semibold text-muted-foreground truncate">
        {label}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeComponent);
