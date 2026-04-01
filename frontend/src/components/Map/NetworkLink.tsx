import { memo, useMemo } from "react";
import {
  getBezierPath,
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

  // Adaptive curvature based on distance
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(0.4, Math.max(0.15, 80 / dist));

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature,
  });

  // Position labels at 25% and 75% along the path
  const outLabelX = sourceX * 0.7 + targetX * 0.3;
  const outLabelY = sourceY * 0.7 + targetY * 0.3;
  const inLabelX = sourceX * 0.3 + targetX * 0.7;
  const inLabelY = sourceY * 0.3 + targetY * 0.7;

  // Only show bps labels if link is long enough to not overlap
  const showBpsLabels = dist > 120;
  // Only show capacity label on longer links
  const showCapacity = dist > 80;

  const typeLabel =
    linkType === "transit" ? "TR" :
    linkType === "peering_ix" ? "IX" :
    linkType === "peering_pni" ? "PNI" :
    linkType === "customer" ? "CX" : "";

  // Compact single-line label for short links
  const compactLabel = useMemo(() => {
    if (showBpsLabels) return null;
    const parts: string[] = [];
    if (typeLabel) parts.push(typeLabel);
    if (bandwidthLabel) parts.push(bandwidthLabel);
    if (outBps > 0) parts.push(`${formatBps(outBps)}/${formatBps(inBps)}`);
    return parts.join(" ");
  }, [showBpsLabels, typeLabel, bandwidthLabel, outBps, inBps]);

  return (
    <>
      {/* Out direction */}
      <path
        id={`${id}-out`}
        d={edgePath}
        fill="none"
        stroke={outColor}
        strokeWidth={width}
        opacity={selected ? 1 : 0.7}
        strokeDasharray={linkType === "transit" ? "6 3" : undefined}
        filter={selected ? "drop-shadow(0 0 6px hsl(190 90% 50% / 0.4))" : undefined}
        style={{ transition: "stroke 0.3s, opacity 0.15s" }}
      />
      {/* In direction overlay */}
      <path
        id={`${id}-in`}
        d={edgePath}
        fill="none"
        stroke={inColor}
        strokeWidth={Math.max(width - 1, 1.5)}
        opacity={0.35}
      />

      <EdgeLabelRenderer>
        {showBpsLabels ? (
          <>
            {/* Out bps (near source) */}
            <div
              className="nodrag nopan pointer-events-auto cursor-pointer"
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${outLabelX}px, ${outLabelY}px)`,
              }}
            >
              <div className="bg-noc-bg/80 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {formatBps(outBps)}
              </div>
            </div>

            {/* In bps (near target) */}
            <div
              className="nodrag nopan pointer-events-auto cursor-pointer"
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${inLabelX}px, ${inLabelY}px)`,
              }}
            >
              <div className="bg-noc-bg/80 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {formatBps(inBps)}
              </div>
            </div>

            {/* Capacity + type at center */}
            {showCapacity && (bandwidthLabel || typeLabel) && (
              <div
                className="nodrag nopan"
                style={{
                  position: "absolute",
                  transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 4}px)`,
                }}
              >
                <div className="flex items-center gap-0.5 text-2xs text-noc-text-dim whitespace-nowrap opacity-60">
                  {typeLabel && (
                    <span className="font-semibold tracking-wider">{typeLabel}</span>
                  )}
                  <span className="tabular-nums">{bandwidthLabel}</span>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Compact label for short links */
          compactLabel && (
            <div
              className="nodrag nopan"
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              }}
            >
              <div className="bg-noc-bg/80 rounded px-1 py-px text-2xs text-noc-text-dim whitespace-nowrap tabular-nums border border-noc-border/30">
                {compactLabel}
              </div>
            </div>
          )
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const TrafficEdge = memo(TrafficEdgeComponent);
