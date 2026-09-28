import { memo, useMemo } from "react";
import {
  getSmoothStepPath,
  getStraightPath,
  getBezierPath,
  useStore,
  type EdgeProps,
  EdgeLabelRenderer,
} from "@xyflow/react";
import type { LinkStatus } from "@/types";
import { formatBps } from "./MapView";
import { analyzePath, type Pt } from "./pathGeometry";
import { LINK_STATUS_OPACITY, LINK_STATUS_STYLE, epochToMs } from "./linkStatus";
import "./linkStatus.css";

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

const LINK_STATUSES: readonly LinkStatus[] = ["ok", "down", "admin_down", "nodata", "unbound", "stale"];

function toLinkStatus(v: unknown): LinkStatus {
  return LINK_STATUSES.includes(v as LinkStatus) ? (v as LinkStatus) : "ok";
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
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
  const status = toLinkStatus(data?.status);
  const updatedAt = typeof data?.updatedAt === "number" ? data.updatedAt : null;

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

  // Non-"ok" states that replace the traffic rendering entirely.
  const statusStyle = LINK_STATUS_STYLE[status];
  const groupOpacity = LINK_STATUS_OPACITY[status];
  const isStale = status === "stale";
  const showArrows = arrowStyle !== "none" && !statusStyle;

  // Live canvas zoom — used to cull/scale labels that would otherwise smear.
  const zoom = useStore((s) => s.transform[2]);

  const userDashArray = lineStyle === "dashed" ? "6 3"
    : lineStyle === "dotted" ? "2 3"
    : lineStyle === "auto" && linkType === "transit" ? "6 3"
    : undefined;
  const dashArray = statusStyle ? statusStyle.dash : userDashArray;

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

  // Derive label anchors, arrow direction and the in/out colour split from the
  // ACTUAL rendered path (step / bezier / waypoint routes), not the straight
  // source→target chord. `geom` is null only for a degenerate path, in which
  // case we fall back to the chord.
  const geom = useMemo(() => {
    const g = analyzePath(edgePath);
    if (!g) return null;
    const [firstHalf, secondHalf] = g.splitAt(0.5);
    return {
      total: g.total,
      out: g.pointAt(0.25),
      mid: g.pointAt(0.5),
      in: g.pointAt(0.75),
      tangent: g.tangentAt(0.5),
      firstHalf,
      secondHalf,
    };
  }, [edgePath]);

  const baseOutX = geom?.out.x ?? sourceX * 0.75 + targetX * 0.25;
  const baseOutY = geom?.out.y ?? sourceY * 0.75 + targetY * 0.25;
  const baseInX = geom?.in.x ?? sourceX * 0.25 + targetX * 0.75;
  const baseInY = geom?.in.y ?? sourceY * 0.25 + targetY * 0.75;
  const midX = geom?.mid.x ?? labelX;
  const midY = geom?.mid.y ?? labelY;

  // Screen-space length gate: rendered path length scaled by the live zoom.
  const chordDist = Math.sqrt((targetX - sourceX) ** 2 + (targetY - sourceY) ** 2);
  const flowDist = geom?.total ?? chordDist;
  const showBpsLabels =
    !statusStyle && zoom >= MIN_BPS_LABEL_ZOOM && flowDist * zoom > MIN_LABEL_SCREEN_DIST;

  const strokeOut = statusStyle?.color ?? colorOverride ?? outColor;
  const strokeIn = statusStyle?.color ?? colorOverride ?? inColor;

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

  // Arrow direction: tangent of the drawn path at its length midpoint.
  const rawDx = targetX - sourceX;
  const rawDy = targetY - sourceY;
  const rawLen = Math.sqrt(rawDx * rawDx + rawDy * rawDy) || 1;
  const dx = geom?.tangent.x ?? rawDx / rawLen;
  const dy = geom?.tangent.y ?? rawDy / rawLen;
  const perpX = -dy;
  const perpY = dx;
  const arrowSize = Math.max(width * 2.5, 8);

  const staleSince = isStale && updatedAt
    ? new Date(epochToMs(updatedAt)).toLocaleString()
    : null;
  const tooltip = statusStyle?.title
    ?? (isStale ? `Stale data${staleSince ? ` — last update ${staleSince}` : ""}` : null);

  const pathCommon = {
    fill: "none",
    strokeWidth: width,
    opacity: selected ? 1 : 0.8,
    className: statusStyle ? "netmap-link-state" : undefined,
    filter: selected ? "drop-shadow(0 0 6px hsl(190 90% 50% / 0.4))" : undefined,
    style: { transition: "opacity 0.15s" },
  } as const;

  // Fallback gradient (chord-based) is only used when the path couldn't be analysed.
  const gradId = `grad-${id}`;

  return (
    <>
      <g opacity={groupOpacity}>
        {tooltip && <title>{tooltip}</title>}
        {geom ? (
          <>
            {/* Out colour on the source half, in colour on the target half,
                split at the path's length midpoint so it follows the route. */}
            <path
              id={`${id}-path`}
              d={geom.firstHalf}
              stroke={strokeOut}
              strokeDasharray={dashArray}
              {...pathCommon}
            />
            <path
              d={geom.secondHalf}
              stroke={strokeIn}
              strokeDasharray={dashArray}
              // Continue the dash pattern across the split instead of restarting it.
              strokeDashoffset={dashArray ? geom.total / 2 : undefined}
              {...pathCommon}
            />
          </>
        ) : (
          <>
            <defs>
              <linearGradient id={gradId} x1={sourceX} y1={sourceY} x2={targetX} y2={targetY} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor={strokeOut} />
                <stop offset="48%" stopColor={strokeOut} />
                <stop offset="52%" stopColor={strokeIn} />
                <stop offset="100%" stopColor={strokeIn} />
              </linearGradient>
            </defs>
            <path
              id={`${id}-path`}
              d={edgePath}
              stroke={`url(#${gradId})`}
              strokeDasharray={dashArray}
              {...pathCommon}
            />
          </>
        )}

        {/* Midpoint: two triangles ►◄ pointing inward, tips 2px apart */}
        {showArrows && (() => {
          // Unit vectors along (path tangent) and perpendicular to the link
          const ux = dx;
          const uy = dy;
          const px = perpX;
          const py = perpY;
          const s = arrowSize; // triangle size
          const g = 1.5; // half-gap between tips

          // ► Out arrow: tip points toward target, base on source side
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
      </g>

      <EdgeLabelRenderer>
        {showBpsLabels && (
          <>
            <div className="nodrag nopan pointer-events-auto cursor-pointer" title={tooltip ?? undefined} style={{
              position: "absolute",
              zIndex: 10,
              opacity: isStale ? 0.6 : undefined,
              transform: `${labelTranslate} translate(${outLabelX}px, ${outLabelY}px)`,
            }}>
              <div className="bg-noc-bg/90 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {outBps > 0 ? formatBps(outBps) : outPct > 0 ? `${outPct.toFixed(1)}%` : "0"}
              </div>
            </div>
            <div className="nodrag nopan pointer-events-auto cursor-pointer" title={tooltip ?? undefined} style={{
              position: "absolute",
              zIndex: 10,
              opacity: isStale ? 0.6 : undefined,
              transform: `${labelTranslate} translate(${inLabelX}px, ${inLabelY}px)`,
            }}>
              <div className="bg-noc-bg/90 rounded px-1 py-px text-2xs text-noc-text whitespace-nowrap tabular-nums border border-noc-border/30">
                {inBps > 0 ? formatBps(inBps) : inPct > 0 ? `${inPct.toFixed(1)}%` : "0"}
              </div>
            </div>
          </>
        )}
        {statusStyle?.label ? (
          // DOWN / ADMIN DOWN badge at the path midpoint (replaces the arrows).
          <div className="nodrag nopan pointer-events-auto" title={statusStyle.title} style={{
            position: "absolute",
            zIndex: 11,
            transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)`,
          }}>
            <div
              className="bg-noc-card rounded px-1 py-px font-bold tracking-wider whitespace-nowrap leading-tight"
              style={{
                fontSize: status === "down" ? "9px" : "8px",
                color: statusStyle.color,
                border: `1px solid ${statusStyle.color}`,
              }}
            >
              {statusStyle.label}
            </div>
          </div>
        ) : (bandwidthLabel || typeLabel || isStale) ? (
          <div className="nodrag nopan" title={tooltip ?? undefined} style={{
            position: "absolute",
            transform: `${labelTranslate} translate(${midX + offX}px, ${midY + offY}px)`,
            pointerEvents: isStale ? "auto" : undefined,
          }}>
            <div className="flex items-center gap-0.5 whitespace-nowrap opacity-40" style={{ fontSize: "8px" }}>
              {isStale && <ClockIcon className="w-2 h-2" />}
              {typeLabel && <span className="font-semibold tracking-wider">{typeLabel}</span>}
              <span className="tabular-nums">{bandwidthLabel}</span>
            </div>
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}

export const TrafficEdge = memo(TrafficEdgeComponent);
