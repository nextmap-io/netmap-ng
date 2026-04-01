import { memo, useMemo } from "react";
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

  const extra = data?.extra as Record<string, unknown> | undefined;
  const lineStyle = String(extra?.line_style || "auto");
  const colorOverride = extra?.color_override ? String(extra.color_override) : null;
  const routing = String(extra?.routing || "auto");

  const dashArray = lineStyle === "dashed" ? "6 3"
    : lineStyle === "dotted" ? "2 3"
    : lineStyle === "auto" && linkType === "transit" ? "6 3"
    : undefined;

  const isHorizontal = Math.abs(sourceY - targetY) < 15;

  const [edgePath, labelX, labelY] = useMemo(() => {
    if (routing === "step") {
      return getSmoothStepPath({
        sourceX, sourceY, targetX, targetY,
        sourcePosition, targetPosition, borderRadius: 6, offset: 15,
      });
    }
    if (routing === "straight" || (routing === "auto" && isHorizontal)) {
      return getStraightPath({ sourceX, sourceY, targetX, targetY });
    } else if (routing === "bezier") {
      return getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
    }
    return getSmoothStepPath({
      sourceX, sourceY, targetX, targetY,
      sourcePosition, targetPosition, borderRadius: 6, offset: 15,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceX, sourceY, targetX, targetY, routing, isHorizontal, sourcePosition, targetPosition]);

  const dist = Math.sqrt((targetX - sourceX) ** 2 + (targetY - sourceY) ** 2);
  const showBpsLabels = dist > 80;

  // Unique gradient ID for this edge (out color first half, in color second half)
  const gradId = `grad-${id}`;
  const strokeOut = colorOverride || outColor;
  const strokeIn = colorOverride || inColor;

  // Label position override: "above" (default), "below", "left", "right"
  const labelPos = String(extra?.label_position || "above");

  // Base label positions at 20% (out/source side) and 80% (in/target side)
  const baseOutX = sourceX * 0.80 + targetX * 0.20;
  const baseOutY = sourceY * 0.80 + targetY * 0.20;
  const baseInX = sourceX * 0.20 + targetX * 0.80;
  const baseInY = sourceY * 0.20 + targetY * 0.80;

  // Offset based on label_position
  const labelOffset = 12;
  const offsets: Record<string, [number, number, string]> = {
    above: [0, -labelOffset, "translate(-50%, -100%)"],
    below: [0, labelOffset, "translate(-50%, 0%)"],
    left:  [-labelOffset, 0, "translate(-100%, -50%)"],
    right: [labelOffset, 0, "translate(0%, -50%)"],
  };
  const [offX, offY, labelTranslate] = offsets[labelPos] || offsets.above;

  const outLabelX = baseOutX + offX;
  const outLabelY = baseOutY + offY;
  const inLabelX = baseInX + offX;
  const inLabelY = baseInY + offY;

  const typeLabel =
    linkType === "transit" ? "TR" :
    linkType === "peering_ix" ? "IX" :
    linkType === "peering_pni" ? "PNI" :
    linkType === "customer" ? "CX" : "";

  // Midpoint for the split indicator
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  // Arrow direction at midpoint (perpendicular ticks)
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  const arrowSize = Math.max(width * 2.5, 8);

  return (
    <>
      {/* Gradient: out color first half → in color second half */}
      <defs>
        <linearGradient id={gradId} x1={sourceX} y1={sourceY} x2={targetX} y2={targetY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={strokeOut} />
          <stop offset="48%" stopColor={strokeOut} />
          <stop offset="52%" stopColor={strokeIn} />
          <stop offset="100%" stopColor={strokeIn} />
        </linearGradient>
      </defs>

      {/* Single path with gradient */}
      <path
        id={`${id}-path`}
        d={edgePath}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={width}
        opacity={selected ? 1 : 0.8}
        strokeDasharray={dashArray}
        filter={selected ? "drop-shadow(0 0 6px hsl(190 90% 50% / 0.4))" : undefined}
        style={{ transition: "opacity 0.15s" }}
      />

      {/* Midpoint: two triangles ►◄ pointing inward, tips 2px apart */}
      {(() => {
        // Unit vectors along and perpendicular to the link
        const ux = dx / len; // along: source → target
        const uy = dy / len;
        const px = perpX; // perpendicular
        const py = perpY;
        const s = arrowSize; // triangle size
        const g = 1.5; // half-gap between tips

        // ► Out arrow: tip points toward target, base on source side
        // Tip at mid + g along direction, base at mid + g + s along direction
        const outTipX = midX + ux * g;
        const outTipY = midY + uy * g;
        const outBaseX = midX - ux * (s - g);
        const outBaseY = midY - uy * (s - g);

        // ◄ In arrow: tip points toward source, base on target side
        const inTipX = midX - ux * g;
        const inTipY = midY - uy * g;
        const inBaseX = midX + ux * (s - g);
        const inBaseY = midY + uy * (s - g);

        return (
          <>
            <polygon
              points={`${outTipX},${outTipY} ${outBaseX + px * s * 0.5},${outBaseY + py * s * 0.5} ${outBaseX - px * s * 0.5},${outBaseY - py * s * 0.5}`}
              fill={strokeOut}
              opacity={0.9}
            />
            <polygon
              points={`${inTipX},${inTipY} ${inBaseX + px * s * 0.5},${inBaseY + py * s * 0.5} ${inBaseX - px * s * 0.5},${inBaseY - py * s * 0.5}`}
              fill={strokeIn}
              opacity={0.9}
            />
          </>
        );
      })()}

      <EdgeLabelRenderer>
        {showBpsLabels && (
          <>
            <div className="nodrag nopan pointer-events-auto cursor-pointer" style={{
              position: "absolute",
              zIndex: 10,
              transform: `${labelTranslate} translate(${outLabelX}px, ${outLabelY}px)`,
            }}>
              <div className="bg-noc-bg/90 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {formatBps(outBps)}
              </div>
            </div>
            <div className="nodrag nopan pointer-events-auto cursor-pointer" style={{
              position: "absolute",
              zIndex: 10,
              transform: `${labelTranslate} translate(${inLabelX}px, ${inLabelY}px)`,
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
            transform: `${labelTranslate} translate(${labelX + offX}px, ${labelY + offY}px)`,
          }}>
            <div className="flex items-center gap-0.5 whitespace-nowrap opacity-40" style={{ fontSize: "8px" }}>
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
