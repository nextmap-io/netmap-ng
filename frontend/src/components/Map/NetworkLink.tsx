import { memo, useMemo } from "react";
import {
  getSmoothStepPath,
  getStraightPath,
  getBezierPath,
  type EdgeProps,
  EdgeLabelRenderer,
} from "@xyflow/react";
import { formatBps } from "./MapView";

/**
 * Offset a path by shifting all coordinates perpendicular to the source→target direction.
 * For straight paths this is exact; for step/bezier it's an approximation that works
 * well for small offsets (2-4px).
 */
function offsetPath(path: string, dx: number, dy: number): string {
  // Shift all coordinate values in the SVG path by the perpendicular offset
  return path.replace(/(-?\d+\.?\d*)/g, (match, _num, offset, str) => {
    // Determine if this is an X or Y coordinate by counting preceding numbers
    const preceding = str.slice(0, offset);
    const numCount = (preceding.match(/-?\d+\.?\d*/g) || []).length;
    // Even index = X, Odd index = Y (in SVG path commands)
    if (numCount % 2 === 0) {
      return String(parseFloat(match) + dx);
    }
    return String(parseFloat(match) + dy);
  });
}

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

  const extra = data?.extra as Record<string, unknown> | undefined;
  const lineStyle = String(extra?.line_style || "auto");
  const colorOverride = extra?.color_override ? String(extra.color_override) : null;

  const dashArray = lineStyle === "dashed" ? "6 3"
    : lineStyle === "dotted" ? "2 3"
    : lineStyle === "auto" && linkType === "transit" ? "6 3"
    : undefined;

  const strokeOut = colorOverride || outColor;
  const strokeIn = colorOverride || inColor;

  const routing = String(extra?.routing || "auto");
  const isHorizontal = Math.abs(sourceY - targetY) < 15;

  // Perpendicular unit vector for splitting the two directions
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;

  // Split offset: half the line width + 1px gap between the two halves
  const splitOffset = Math.max(width * 0.6, 2);

  // Compute two offset source/target pairs
  const outSrcX = sourceX + perpX * splitOffset;
  const outSrcY = sourceY + perpY * splitOffset;
  const outTgtX = targetX + perpX * splitOffset;
  const outTgtY = targetY + perpY * splitOffset;

  const inSrcX = sourceX - perpX * splitOffset;
  const inSrcY = sourceY - perpY * splitOffset;
  const inTgtX = targetX - perpX * splitOffset;
  const inTgtY = targetY - perpY * splitOffset;

  // Compute paths for each direction
  const computePath = (sx: number, sy: number, tx: number, ty: number) => {
    if (routing === "straight" || (routing === "auto" && isHorizontal)) {
      return getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });
    } else if (routing === "bezier") {
      return getBezierPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition, targetPosition });
    }
    return getSmoothStepPath({
      sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
      sourcePosition, targetPosition, borderRadius: 6, offset: 15,
    });
  };

  const [outPath] = computePath(outSrcX, outSrcY, outTgtX, outTgtY);
  const [inPath] = computePath(inTgtX, inTgtY, inSrcX, inSrcY); // reversed direction

  // Center path for label positioning
  const [, labelX, labelY] = useMemo(() =>
    computePath(sourceX, sourceY, targetX, targetY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceX, sourceY, targetX, targetY, routing, isHorizontal],
  );

  const dist = Math.sqrt((targetX - sourceX) ** 2 + (targetY - sourceY) ** 2);
  const showBpsLabels = dist > 80;

  // Labels: out near source side, in near target side, both above the line
  const LABEL_ABOVE = 8;
  const outLabelX = sourceX * 0.72 + targetX * 0.28 + perpX * (splitOffset + LABEL_ABOVE);
  const outLabelY = sourceY * 0.72 + targetY * 0.28 + perpY * (splitOffset + LABEL_ABOVE);
  const inLabelX = sourceX * 0.28 + targetX * 0.72 - perpX * (splitOffset + LABEL_ABOVE);
  const inLabelY = sourceY * 0.28 + targetY * 0.72 - perpY * (splitOffset + LABEL_ABOVE);

  const typeLabel =
    linkType === "transit" ? "TR" :
    linkType === "peering_ix" ? "IX" :
    linkType === "peering_pni" ? "PNI" :
    linkType === "customer" ? "CX" : "";

  return (
    <>
      {/* Out direction: source → target (top/left half) */}
      <path
        id={`${id}-out`}
        d={outPath}
        fill="none"
        stroke={strokeOut}
        strokeWidth={width}
        opacity={selected ? 1 : 0.8}
        strokeDasharray={dashArray}
        filter={selected ? "drop-shadow(0 0 6px hsl(190 90% 50% / 0.4))" : undefined}
        style={{ transition: "stroke 0.3s, opacity 0.15s" }}
      />
      {/* In direction: target → source (bottom/right half) */}
      <path
        id={`${id}-in`}
        d={inPath}
        fill="none"
        stroke={strokeIn}
        strokeWidth={width}
        opacity={selected ? 1 : 0.8}
        strokeDasharray={dashArray}
        style={{ transition: "stroke 0.3s, opacity 0.15s" }}
      />

      <EdgeLabelRenderer>
        {showBpsLabels && (
          <>
            {/* Out bps label (near source, offset to out side) */}
            <div className="nodrag nopan pointer-events-auto cursor-pointer" style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${outLabelX}px, ${outLabelY}px)`,
            }}>
              <div className="bg-noc-bg/90 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {formatBps(outBps)}
              </div>
            </div>
            {/* In bps label (near target, offset to in side) */}
            <div className="nodrag nopan pointer-events-auto cursor-pointer" style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${inLabelX}px, ${inLabelY}px)`,
            }}>
              <div className="bg-noc-bg/90 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {formatBps(inBps)}
              </div>
            </div>
          </>
        )}
        {/* Capacity + type label at center */}
        {(bandwidthLabel || typeLabel) && (
          <div className="nodrag nopan" style={{
            position: "absolute",
            transform: `translate(-50%, -100%) translate(${labelX + perpX * (splitOffset + 4)}px, ${labelY + perpY * (splitOffset + 4)}px)`,
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
