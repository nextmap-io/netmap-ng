import { memo } from "react";
import {
  getSmoothStepPath,
  getStraightPath,
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

  // Use straight path when source and target are roughly aligned horizontally
  // (within 15px Y difference) - this gives clean horizontal server links
  const isHorizontal = Math.abs(sourceY - targetY) < 15;

  const [edgePath, labelX, labelY] = isHorizontal
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : getSmoothStepPath({
        sourceX, sourceY, targetX, targetY,
        sourcePosition, targetPosition,
        borderRadius: 6,
        offset: 15,
      });

  const dist = Math.sqrt((targetX - sourceX) ** 2 + (targetY - sourceY) ** 2);
  const showBpsLabels = dist > 80;

  // Perpendicular offset for labels (always above the link)
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  const labelOff = 12;

  const outLabelX = sourceX * 0.72 + targetX * 0.28 + perpX * labelOff;
  const outLabelY = sourceY * 0.72 + targetY * 0.28 + perpY * labelOff;
  const inLabelX = sourceX * 0.28 + targetX * 0.72 + perpX * labelOff;
  const inLabelY = sourceY * 0.28 + targetY * 0.72 + perpY * labelOff;

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
        stroke={outColor}
        strokeWidth={width}
        opacity={selected ? 1 : 0.7}
        strokeDasharray={linkType === "transit" ? "6 3" : undefined}
        filter={selected ? "drop-shadow(0 0 6px hsl(190 90% 50% / 0.4))" : undefined}
        style={{ transition: "stroke 0.3s, opacity 0.15s" }}
      />
      <path
        id={`${id}-in`}
        d={edgePath}
        fill="none"
        stroke={inColor}
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
            transform: `translate(-50%, -100%) translate(${labelX + perpX * labelOff}px, ${labelY + perpY * labelOff - 2}px)`,
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
