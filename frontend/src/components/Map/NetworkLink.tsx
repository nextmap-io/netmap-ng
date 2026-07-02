import { memo, useMemo, useRef, useState, useLayoutEffect } from "react";
import {
  getSmoothStepPath,
  getStraightPath,
  getBezierPath,
  useStore,
  type EdgeProps,
  EdgeLabelRenderer,
} from "@xyflow/react";
import { formatBps } from "./MapView";

type Pt = { x: number; y: number };

/** Build a straight-segment (angled) path through source → waypoints → target. */
function angledPath(pts: Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");
}

/** Build a smooth path that passes through every waypoint (Q segments meeting at edge midpoints). */
function curvedPath(pts: Pt[]): string {
  if (pts.length < 3) return angledPath(pts);
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += ` Q ${pts[i].x},${pts[i].y} ${mid.x},${mid.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

// Below this zoom the 10px bps labels collapse into an unreadable smear.
const MIN_BPS_LABEL_ZOOM = 0.5;
// Minimum on-screen (pixel) length before bps labels are worth showing.
const MIN_LABEL_SCREEN_DIST = 80;

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
  const inColor = String(data?.inColor || "hsl(220 10% 46%)");
  const outColor = String(data?.outColor || "hsl(220 10% 46%)");
  const inBps = Number(data?.inBps) || 0;
  const outBps = Number(data?.outBps) || 0;
  const inPct = Number(data?.inPct) || 0;
  const outPct = Number(data?.outPct) || 0;
  const width = Number(data?.width) || 3;
  const bandwidthLabel = String(data?.bandwidthLabel || "");
  const linkType = String(data?.linkType || "internal");

  const extra = data?.extra as Record<string, unknown> | undefined;
  const lineStyle = String(extra?.line_style || "auto");
  const colorOverride = extra?.color_override ? String(extra.color_override) : null;
  const routing = String(extra?.routing || "auto");

  // Waypoint routing (via_points / via_style) overrides the auto/step/bezier path.
  const viaPoints = useMemo(
    () => (Array.isArray(data?.viaPoints) ? (data.viaPoints as Pt[]) : []),
    [data?.viaPoints],
  );
  const viaStyle = String(data?.viaStyle || "curved");
  const arrowStyle = String(data?.arrowStyle || "");
  const showArrows = arrowStyle !== "none";

  // Live canvas zoom — used to cull/scale labels that would otherwise smear.
  const zoom = useStore((s) => s.transform[2]);

  const dashArray = lineStyle === "dashed" ? "6 3"
    : lineStyle === "dotted" ? "2 3"
    : lineStyle === "auto" && linkType === "transit" ? "6 3"
    : undefined;

  const isHorizontal = Math.abs(sourceY - targetY) < 15;

  const [edgePath, labelX, labelY] = useMemo(() => {
    if (viaPoints.length > 0) {
      const pts: Pt[] = [{ x: sourceX, y: sourceY }, ...viaPoints, { x: targetX, y: targetY }];
      const d = viaStyle === "angled" ? angledPath(pts) : curvedPath(pts);
      const midPt = pts[Math.floor(pts.length / 2)];
      return [d, midPt.x, midPt.y] as [string, number, number];
    }
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
  }, [sourceX, sourceY, targetX, targetY, routing, isHorizontal, sourcePosition, targetPosition, viaPoints, viaStyle]);

  // Derive label/arrow anchor points from the ACTUAL rendered path so labels
  // follow step/bezier/waypoint routing instead of the straight source→target
  // chord. Falls back to chord interpolation before the first measure.
  const pathRef = useRef<SVGPathElement>(null);
  const [anchors, setAnchors] = useState<{ out: Pt; mid: Pt; in: Pt } | null>(null);
  useLayoutEffect(() => {
    const p = pathRef.current;
    if (!p) return;
    let len = 0;
    try {
      len = p.getTotalLength();
    } catch {
      return;
    }
    if (!len) return;
    const at = (frac: number): Pt => {
      const pt = p.getPointAtLength(len * frac);
      return { x: pt.x, y: pt.y };
    };
    setAnchors({ out: at(0.25), mid: at(0.5), in: at(0.75) });
  }, [edgePath]);

  const baseOutX = anchors?.out.x ?? sourceX * 0.75 + targetX * 0.25;
  const baseOutY = anchors?.out.y ?? sourceY * 0.75 + targetY * 0.25;
  const baseInX = anchors?.in.x ?? sourceX * 0.25 + targetX * 0.75;
  const baseInY = anchors?.in.y ?? sourceY * 0.25 + targetY * 0.75;
  const midX = anchors?.mid.x ?? labelX;
  const midY = anchors?.mid.y ?? labelY;

  // Screen-space length gate: flow-unit distance scaled by the live zoom.
  const flowDist = Math.sqrt((targetX - sourceX) ** 2 + (targetY - sourceY) ** 2);
  const showBpsLabels =
    zoom >= MIN_BPS_LABEL_ZOOM && flowDist * zoom > MIN_LABEL_SCREEN_DIST;

  // Unique gradient ID for this edge (out color first half, in color second half)
  const gradId = `grad-${id}`;
  const strokeOut = colorOverride || outColor;
  const strokeIn = colorOverride || inColor;

  // Label position override: "above" (default), "below", "left", "right"
  const labelPos = String(extra?.label_position || "above");

  // Offset based on label_position
  const labelOffset = 8;
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

  // Arrow direction: always use source→target direction (works for straight, step, bezier)
  const rawDx = targetX - sourceX;
  const rawDy = targetY - sourceY;
  const rawLen = Math.sqrt(rawDx * rawDx + rawDy * rawDy) || 1;
  const dx = rawDx / rawLen;
  const dy = rawDy / rawLen;
  const len = 1;
  const perpX = -dy;
  const perpY = dx;
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
        ref={pathRef}
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
      {showArrows && (() => {
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
              stroke="hsl(220 15% 30%)"
              strokeWidth={0.5}
              opacity={0.9}
            />
            <polygon
              points={`${inTipX},${inTipY} ${inBaseX + px * s * 0.5},${inBaseY + py * s * 0.5} ${inBaseX - px * s * 0.5},${inBaseY - py * s * 0.5}`}
              fill={strokeIn}
              stroke="hsl(220 15% 30%)"
              strokeWidth={0.5}
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
                {outBps > 0 ? formatBps(outBps) : outPct > 0 ? `${outPct.toFixed(1)}%` : "0"}
              </div>
            </div>
            <div className="nodrag nopan pointer-events-auto cursor-pointer" style={{
              position: "absolute",
              zIndex: 10,
              transform: `${labelTranslate} translate(${inLabelX}px, ${inLabelY}px)`,
            }}>
              <div className="bg-noc-bg/90 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {inBps > 0 ? formatBps(inBps) : inPct > 0 ? `${inPct.toFixed(1)}%` : "0"}
              </div>
            </div>
          </>
        )}
        {(bandwidthLabel || typeLabel) && (
          <div className="nodrag nopan" style={{
            position: "absolute",
            transform: `${labelTranslate} translate(${midX + offX}px, ${midY + offY}px)`,
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
