import { memo } from "react";
import {
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
  EdgeLabelRenderer,
} from "@xyflow/react";
import { formatBps } from "./MapView";

function TrafficEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const inColor = String(data?.inColor || "hsl(220 15% 24%)");
  const outColor = String(data?.outColor || "hsl(220 15% 24%)");
  const inBps = Number(data?.inBps) || 0;
  const outBps = Number(data?.outBps) || 0;
  const width = Number(data?.width) || 3;
  const bandwidthLabel = String(data?.bandwidthLabel || "");
  const linkType = String(data?.linkType || "internal");

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  const outLabelX = midX * 0.35 + sourceX * 0.65;
  const outLabelY = midY * 0.35 + sourceY * 0.65;
  const inLabelX = midX * 0.35 + targetX * 0.65;
  const inLabelY = midY * 0.35 + targetY * 0.65;

  const typeLabel =
    linkType === "transit" ? "TR" :
    linkType === "peering_ix" ? "IX" :
    linkType === "peering_pni" ? "PNI" :
    linkType === "customer" ? "CX" : "";

  return (
    <>
      {/* Out direction (source -> target) */}
      <BaseEdge
        id={`${id}-out`}
        path={edgePath}
        style={{
          stroke: outColor,
          strokeWidth: width,
          opacity: selected ? 1 : 0.75,
          strokeDasharray: linkType === "transit" ? "6 3" : undefined,
          filter: selected ? "drop-shadow(0 0 6px hsl(190 90% 50% / 0.4))" : undefined,
          transition: "opacity 0.15s",
        }}
        markerEnd="url(#arrow)"
      />
      {/* In direction overlay */}
      <BaseEdge
        id={`${id}-in`}
        path={edgePath}
        style={{
          stroke: inColor,
          strokeWidth: Math.max(width - 1, 2),
          opacity: 0.4,
          strokeDashoffset: width,
        }}
      />

      <EdgeLabelRenderer>
        {/* Out label (near source) */}
        <div
          className="nodrag nopan pointer-events-auto cursor-pointer"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${outLabelX}px, ${outLabelY}px)`,
          }}
        >
          <div className="noc-glass rounded px-1.5 py-0.5 text-2xs text-noc-text whitespace-nowrap tabular-nums">
            {formatBps(outBps)}
          </div>
        </div>

        {/* In label (near target) */}
        <div
          className="nodrag nopan pointer-events-auto cursor-pointer"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${inLabelX}px, ${inLabelY}px)`,
          }}
        >
          <div className="noc-glass rounded px-1.5 py-0.5 text-2xs text-noc-text whitespace-nowrap tabular-nums">
            {formatBps(inBps)}
          </div>
        </div>

        {/* Capacity + type badge at center */}
        {(bandwidthLabel || typeLabel) && (
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 12}px)`,
            }}
          >
            <div className="flex items-center gap-1 text-2xs text-noc-text-dim whitespace-nowrap">
              {typeLabel && (
                <span className="bg-noc-surface/80 text-noc-text-muted px-1 py-px rounded text-2xs font-semibold tracking-wider">
                  {typeLabel}
                </span>
              )}
              <span className="tabular-nums">{bandwidthLabel}</span>
            </div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const TrafficEdge = memo(TrafficEdgeComponent);
