import { useEffect, useMemo, useState } from "react";
import type { MapLink, MapNode, NodeStatusData, ScaleBand, TrafficData } from "@/types";
import { utilizationSeverity, type Severity } from "@/utils/scaleColor";
import { formatBps } from "./MapView";
import { epochToMs } from "./linkStatus";

/** Newest data older than this is flagged "Watch". */
const STALE_MS = 15 * 60 * 1000;

interface RightNowBandProps {
  nodes: MapNode[];
  links: MapLink[];
  traffic: TrafficData;
  nodeStatus: NodeStatusData;
  scales: ScaleBand[];
  /** Time (ms) of the last successful traffic poll — fallback when links carry no updated_at. */
  lastPoll: number | null;
  /** The last traffic poll failed. */
  liveDataError?: boolean;
  /** Seconds between polls (map setting), for the Data context sentence. */
  refreshInterval?: number;
  /** Public maps without show_bps: never reveal bit rates. */
  showBps?: boolean;
  className?: string;
}

interface Fact {
  label: string;
  value: string;
  context: string;
  severity: Severity;
  /** Full text for the tooltip (values/sentences may be truncated). */
  title?: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "a, b and 2 more" */
function listNames(names: string[], max = 2): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/** Latest `updated_at` across all links, in ms, or null when none is reported. */
function latestTrafficUpdate(traffic: TrafficData): number | null {
  let latest: number | null = null;
  for (const t of Object.values(traffic)) {
    if (typeof t.updated_at !== "number" || !Number.isFinite(t.updated_at)) continue;
    const ms = epochToMs(t.updated_at);
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

/**
 * "Right now" band (DESIGN.md): answers "is anything wrong?" before the map.
 * Four facts on the page ground separated by vertical rules. A normal fact has
 * no color; an abnormal one colors its value, adds a word badge, and its value
 * names what triggered it.
 */
export function RightNowBand({
  nodes,
  links,
  traffic,
  nodeStatus,
  scales,
  lastPoll,
  liveDataError = false,
  refreshInterval,
  showBps = true,
  className = "",
}: RightNowBandProps) {
  // Tick so the data-age fact turns "Watch" without waiting for a new poll.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const nodeLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, n.label || n.name);
    return m;
  }, [nodes]);

  const linkFacts = useMemo<[Fact, Fact]>(() => {
    const endpoints = (l: MapLink) =>
      `${nodeLabel.get(l.source_id) ?? "?"} → ${nodeLabel.get(l.target_id) ?? "?"}`;
    const hasData = Object.keys(traffic).length > 0;

    const down: string[] = [];
    let adminDown = 0;
    let noData = 0;
    let reporting = 0;
    let busiest: { link: MapLink; pct: number; dir: "in" | "out"; bps: number } | null = null;

    for (const l of links) {
      const t = traffic[l.id];
      const status = t?.status ?? (t ? "ok" : "nodata");
      if (status === "down") down.push(endpoints(l));
      else if (status === "admin_down") adminDown++;
      else if (status === "nodata" || status === "unbound") noData++;
      if (!t || status === "unbound") continue;
      reporting++;
      if (status !== "ok" && status !== "stale") continue;
      const inPct = t.in_pct || 0;
      const outPct = t.out_pct || 0;
      const dir = outPct >= inPct ? "out" : "in";
      const pct = Math.max(inPct, outPct);
      if (!busiest || pct > busiest.pct) {
        busiest = { link: l, pct, dir, bps: dir === "out" ? t.out_bps || 0 : t.in_bps || 0 };
      }
    }

    // ── Links down ──
    const extras = [
      adminDown > 0 ? `${adminDown} admin down` : null,
      noData > 0 ? `${noData} without data` : null,
    ].filter(Boolean);
    let linksFact: Fact;
    if (!hasData) {
      linksFact = { label: "Links down", value: "—", context: "Waiting for the first poll", severity: "normal" };
    } else if (down.length > 0) {
      const ctx = [listNames(down), ...extras].join("; ");
      linksFact = {
        label: "Links down",
        value: down.length === 1 ? "1 link down" : `${down.length} links down`,
        context: ctx,
        severity: "incident",
        title: [down.join(", "), ...extras].join("; "),
      };
    } else {
      const ctx = [`${plural(reporting, "link")} reporting`, ...extras].join(", ");
      linksFact = { label: "Links down", value: "None down", context: ctx, severity: "normal" };
    }

    // ── Busiest link ──
    let busiestFact: Fact;
    if (!busiest) {
      busiestFact = {
        label: "Busiest link",
        value: "—",
        context: hasData ? "No link is reporting traffic" : "Waiting for the first poll",
        severity: "normal",
      };
    } else {
      const { link, pct, dir, bps } = busiest;
      const name = endpoints(link);
      const pctText = `${Math.round(pct)}%`;
      const severity = utilizationSeverity(pct, scales);
      const bw = link.bandwidth_label;
      const ctx =
        `${dir === "out" ? "Outbound" : "Inbound"}` +
        (showBps && bps > 0 ? `, ${formatBps(bps)}` : "") +
        (bw ? ` of ${bw}` : "") +
        (link.name && link.name !== name ? ` · ${link.name}` : "");
      busiestFact = {
        label: "Busiest link",
        value: severity === "normal" ? `${pctText} ${name}` : `${name} at ${pctText}`,
        context: ctx,
        severity,
        title: `${name} at ${pctText} — ${ctx}`,
      };
    }

    return [linksFact, busiestFact];
  }, [links, traffic, nodeLabel, scales, showBps]);

  const devicesFact = useMemo<Fact>(() => {
    const down: string[] = [];
    let up = 0;
    let unknown = 0;
    for (const n of nodes) {
      const s = nodeStatus[n.id]?.status;
      if (s === "down") down.push(n.label || n.name);
      else if (s === "up") up++;
      else if (s === "unknown") unknown++;
    }
    const monitored = up + down.length + unknown;
    if (monitored === 0) {
      return { label: "Devices down", value: "—", context: "No device status reported", severity: "normal" };
    }
    const unknownText = unknown > 0 ? `${unknown} unknown` : null;
    if (down.length > 0) {
      return {
        label: "Devices down",
        value: down.length === 1 ? "1 device down" : `${down.length} devices down`,
        context: [listNames(down), unknownText].filter(Boolean).join("; "),
        severity: "incident",
        title: [down.join(", "), unknownText].filter(Boolean).join("; "),
      };
    }
    return {
      label: "Devices down",
      value: "None down",
      context: [`${plural(monitored, "device")} monitored`, unknownText].filter(Boolean).join(", "),
      severity: "normal",
    };
  }, [nodes, nodeStatus]);

  // ── Data freshness (newest per-link updated_at, else the last poll) ──
  const ts = latestTrafficUpdate(traffic) ?? lastPoll;
  let dataFact: Fact;
  if (liveDataError) {
    dataFact = {
      label: "Data",
      value: "Live data unavailable",
      context: ts !== null ? `Couldn't refresh; showing data from ${formatHHMM(ts)}` : "Couldn't reach the traffic source",
      severity: "incident",
    };
  } else if (ts === null) {
    dataFact = { label: "Data", value: "—", context: "Waiting for the first poll", severity: "normal" };
  } else {
    const age = Math.max(0, now - ts);
    const every = refreshInterval
      ? `Refreshed every ${refreshInterval < 60 ? `${refreshInterval} s` : formatAge(refreshInterval * 1000)}`
      : "";
    dataFact = age > STALE_MS
      ? {
          label: "Data",
          value: `Data ${formatAge(age)} old`,
          context: `Newest poll at ${formatHHMM(ts)}, older than 15 min`,
          severity: "watch",
          title: new Date(ts).toLocaleString(),
        }
      : {
          label: "Data",
          value: `Updated ${formatHHMM(ts)}`,
          context: every || "Newest poll",
          severity: "normal",
          title: new Date(ts).toLocaleString(),
        };
  }

  const facts: Fact[] = [linkFacts[0], devicesFact, linkFacts[1], dataFact];

  return (
    <section
      aria-label="Right now"
      className={`shrink-0 grid grid-cols-2 md:grid-cols-4 gap-y-3 px-4 py-3 border-b border-border bg-background ${className}`}
    >
      {facts.map((f, i) => (
        <FactCell key={f.label} fact={f} className={CELL_RULES[i]} />
      ))}
    </section>
  );
}

/**
 * Vertical rules between facts: 4 in a row on desktop, 2×2 on mobile (the
 * left column of each mobile row has no rule).
 */
const CELL_RULES = [
  "pr-4",
  "pl-4 pr-4 border-l border-border",
  "pr-4 md:pl-4 md:border-l md:border-border",
  "pl-4 border-l border-border",
];

const VALUE_COLOR: Record<Severity, string> = {
  normal: "text-foreground",
  watch: "text-warning",
  incident: "text-destructive",
};

function FactCell({ fact, className }: { fact: Fact; className: string }) {
  return (
    <div className={`min-w-0 ${className}`} title={fact.title}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="truncate">{fact.label}</span>
        {fact.severity === "watch" && (
          <span className="shrink-0 rounded-sm px-1.5 text-xs leading-4 font-semibold bg-warning-muted text-warning">
            Watch
          </span>
        )}
        {fact.severity === "incident" && (
          <span className="shrink-0 rounded-sm px-1.5 text-xs leading-4 font-semibold bg-destructive text-on-destructive">
            Incident
          </span>
        )}
      </div>
      <div className={`text-xl truncate ${VALUE_COLOR[fact.severity]}`}>{fact.value}</div>
      <div className="text-sm text-foreground-secondary truncate">{fact.context}</div>
    </div>
  );
}
