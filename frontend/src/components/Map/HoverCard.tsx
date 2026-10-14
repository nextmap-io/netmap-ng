import { useMemo } from "react";
import type { MapLink, MapNode, NodeStatusData, ScaleBand, TrafficData } from "@/types";
import { formatBps } from "./MapView";
import { NODE_TYPE_NAMES } from "./NetworkNode";
import { UtilBar } from "./UtilBar";
import { LINK_STATUS_WORD, formatTime, linkInfo, nodeInfo, nodeName, peerOf, type LinkInfo } from "./linkInfo";

export interface HoverTarget {
  kind: "link" | "node";
  id: string;
  /** Pointer position (viewport px) when the hover started. */
  x: number;
  y: number;
}

interface Props {
  target: HoverTarget;
  nodes: MapNode[];
  links: MapLink[];
  traffic: TrafficData;
  nodeStatus: NodeStatusData;
  scales: ScaleBand[];
}

const CARD_W = 300;
const CARD_H = 240;

function StateBadge({ word, tone }: { word: string; tone: "incident" | "watch" | "neutral" }) {
  const cls =
    tone === "incident"
      ? "bg-destructive text-on-destructive"
      : tone === "watch"
        ? "bg-warning-muted text-warning"
        : "border border-border text-muted-foreground";
  return <span className={`rounded px-1.5 text-xs leading-5 font-semibold ${cls}`}>{word}</span>;
}

function LinkBody({ li }: { li: LinkInfo }) {
  const word = li.status ? LINK_STATUS_WORD[li.status] : undefined;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-foreground">{li.link.name}</div>
          <div className="truncate text-sm text-foreground-secondary">
            {li.source}
            {li.ifaceA && <span className="font-ip text-muted-foreground"> {li.ifaceA}</span>}
            {" ↔ "}
            {li.target}
            {li.ifaceB && <span className="font-ip text-muted-foreground"> {li.ifaceB}</span>}
          </div>
        </div>
        {word && <StateBadge word={word} tone={li.status === "down" ? "incident" : li.status === "stale" ? "watch" : "neutral"} />}
        {!word && li.severity !== "normal" && (
          <StateBadge word={li.severity === "incident" ? "Incident" : "Watch"} tone={li.severity} />
        )}
      </div>
      {li.hasTraffic ? (
        <div className="mt-3 space-y-2">
          {(
            [
              ["In", li.inBps, li.inPct],
              ["Out", li.outBps, li.outPct],
            ] as const
          ).map(([dir, bps, pct]) => (
            <div key={dir}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">{dir}</span>
                <span className="tabular-nums text-foreground">{formatBps(bps)}</span>
              </div>
              <UtilBar pct={pct} severity={pct === Math.max(li.inPct, li.outPct) ? li.severity : "normal"} />
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-foreground-secondary">
          {li.status === "down"
            ? "The interface reports down."
            : li.status === "admin_down"
              ? "The interface is administratively down."
              : li.status === "unbound"
                ? "No Observium port is bound: bind one in edit mode to see traffic."
                : "No traffic reported for this port."}
        </p>
      )}
      <p className="mt-3 border-t border-border-soft pt-2 text-sm text-muted-foreground">
        {[li.capacity ? `${formatBps(li.capacity)} capacity` : null, li.updatedAt ? `updated ${formatTime(li.updatedAt)}` : null]
          .filter(Boolean)
          .join(" · ")}
        {li.capacity || li.updatedAt ? <br /> : null}
        Click for the traffic graph.
      </p>
    </>
  );
}

/** Floating detail card for the link or node under the pointer (view mode). */
export function HoverCard({ target, nodes, links, traffic, nodeStatus, scales }: Props) {
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Beside the pointer, flipped so it stays inside the window.
  const left = target.x + 16 + CARD_W > window.innerWidth ? Math.max(8, target.x - 16 - CARD_W) : target.x + 16;
  const top = Math.max(8, Math.min(target.y + 16, window.innerHeight - CARD_H - 8));

  let body: React.ReactNode;
  if (target.kind === "link") {
    const link = links.find((l) => l.id === target.id);
    if (!link) return null;
    body = <LinkBody li={linkInfo(link, nodesById, traffic, scales)} />;
  } else {
    const node = nodesById.get(target.id);
    if (!node || node.node_type === "group" || node.node_type === "label") return null;
    const ni = nodeInfo(node, links, nodesById, traffic, scales, nodeStatus);
    const top3 = ni.links.filter((l) => l.hasTraffic).slice(0, 3);
    body = (
      <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-foreground">{nodeName(node)}</div>
            <div className="text-sm text-foreground-secondary">
              {NODE_TYPE_NAMES[node.node_type] ?? "Node"} · {ni.links.length} link{ni.links.length === 1 ? "" : "s"}
            </div>
          </div>
          {ni.status === "down" && <StateBadge word="Down" tone="incident" />}
          {ni.status === "unknown" && <StateBadge word="Unknown" tone="neutral" />}
          {ni.status !== "down" && ni.down > 0 && (
            <StateBadge word={`${ni.down} link${ni.down === 1 ? "" : "s"} down`} tone="incident" />
          )}
        </div>
        {(ni.totalIn > 0 || ni.totalOut > 0) && (
          <div className="mt-3 flex gap-6 text-sm">
            <div>
              <div className="text-muted-foreground">Total in</div>
              <div className="tabular-nums text-foreground">{formatBps(ni.totalIn)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Total out</div>
              <div className="tabular-nums text-foreground">{formatBps(ni.totalOut)}</div>
            </div>
          </div>
        )}
        {top3.length > 0 && (
          <div className="mt-3">
            <div className="text-sm text-muted-foreground">Busiest links</div>
            {top3.map((li) => {
              const { peer } = peerOf(li, node.id);
              return (
                <div key={li.link.id} className="mt-1 grid grid-cols-[1fr_120px] items-center gap-2 text-sm">
                  <span className="truncate text-foreground-secondary">{peer}</span>
                  <UtilBar pct={Math.max(li.inPct, li.outPct)} severity={li.severity} />
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 border-t border-border-soft pt-2 text-sm text-muted-foreground">Click to list all its links.</p>
      </>
    );
  }

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded border border-border bg-card p-3"
      style={{ left, top, width: CARD_W }}
    >
      {body}
    </div>
  );
}
