import { memo } from "react";
import {
  getSmoothStepPath,
  getStraightPath,
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

  // Style overrides from extra
  const extra = data?.extra as Record<string, unknown> | undefined;
  const lineStyle = String(extra?.line_style || "auto");
  const colorOverride = extra?.color_override ? String(extra.color_override) : null;

  // Compute dash pattern
  const dashArray = lineStyle === "dashed" ? "6 3"
    : lineStyle === "dotted" ? "2 3"
    : lineStyle === "auto" && linkType === "transit" ? "6 3"
    : undefined;

  // Override colors if set
  const strokeOut = colorOverride || outColor;
  const strokeIn = colorOverride || inColor;

  // Routing mode: auto (default), straight, step, bezier
  const routing = String(extra?.routing || "auto");
  const isHorizontal = Math.abs(sourceY - targetY) < 15;

  let edgePath: string, labelX: number, labelY: number;
  if (routing === "straight" || (routing === "auto" && isHorizontal)) {
    [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  } else if (routing === "bezier") {
    [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  } else {
    // step (default for non-horizontal)
    [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX, sourceY, targetX, targetY,
      sourcePosition, targetPosition,
      borderRadius: 6, offset: 15,
    });
  }

  const dist = Math.sqrt((targetX - sourceX) ** 2 + (targetY - sourceY) ** 2);
  const showBpsLabels = dist > 80;

  // Labels above the line (small gap)
  const LABEL_ABOVE = 6;
  const outLabelX = sourceX * 0.72 + targetX * 0.28;
  const outLabelY = sourceY * 0.72 + targetY * 0.28 - LABEL_ABOVE;
  const inLabelX = sourceX * 0.28 + targetX * 0.72;
  const inLabelY = sourceY * 0.28 + targetY * 0.72 - LABEL_ABOVE;

  const typeLabel =
    linkType === "transit" ? "TR" :
    linkType === "peering_ix" ? "IX" :
    linkType === "peering_pni" ? "PNI" :
    linkType === "customer" ? "CX" : "";

  return (
    <>
      <path
        id={`${id}-out`}
        d={edgePath}
        fill="none"
        stroke={strokeOut}
        strokeWidth={width}
        opacity={selected ? 1 : 0.7}
        strokeDasharray={dashArray}
        filter={selected ? "drop-shadow(0 0 6px hsl(190 90% 50% / 0.4))" : undefined}
        style={{ transition: "stroke 0.3s, opacity 0.15s" }}
      />
      <path
        id={`${id}-in`}
        d={edgePath}
        fill="none"
        stroke={strokeIn}
        strokeWidth={Math.max(width - 1, 1.5)}
        opacity={0.3}
      />

      <EdgeLabelRenderer>
        {showBpsLabels && (
          <>
            <div className="nodrag nopan pointer-events-auto cursor-pointer" style={{
              position: "absolute",
              transform: `translate(-50%, -100%) translate(${outLabelX}px, ${outLabelY}px)`,
            }}>
              <div className="bg-noc-bg/90 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {formatBps(outBps)}
              </div>
            </div>
            <div className="nodrag nopan pointer-events-auto cursor-pointer" style={{
              position: "absolute",
              transform: `translate(-50%, -100%) translate(${inLabelX}px, ${inLabelY}px)`,
            }}>
              <div className="bg-noc-bg/90 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {formatBps(inBps)}
              </div>
            </div>
          </>
        )}
        {(bandwidthLabel || typeLabel) && (
          <div className="nodrag nopan" style={{
            position: "absolute",
            transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - LABEL_ABOVE}px)`,
          }}>
            <div className="flex items-center gap-0.5 text-2xs text-noc-text-dim whitespace-nowrap opacity-50">
              {typeLabel && <span className="font-semibold tracking-wider">{typeLabel}</span>}
              <span className="tabular-nums">{bandwidthLabel}</span>
            </div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const TrafficEdge = memo(TrafficEdgeComponent);
