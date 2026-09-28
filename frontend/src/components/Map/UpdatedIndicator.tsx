import { useEffect, useState } from "react";
import type { TrafficData } from "@/types";

/** Data older than this is flagged as stale. */
const STALE_MS = 15 * 60 * 1000;

/** `updated_at` may be epoch seconds (backend) or ms — normalize to ms. */
function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

/** Latest `updated_at` across all links, in ms, or null when none is reported. */
function latestTrafficUpdate(traffic: TrafficData): number | null {
  let latest: number | null = null;
  for (const t of Object.values(traffic)) {
    if (typeof t.updated_at !== "number" || !Number.isFinite(t.updated_at)) continue;
    const ms = toMs(t.updated_at);
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

function formatHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface UpdatedIndicatorProps {
  traffic: TrafficData;
  /** Time (ms) of the last successful traffic poll — fallback when links carry no updated_at. */
  lastPoll: number | null;
  className?: string;
}

/**
 * "Updated HH:MM" freshness badge. Uses the newest per-link `updated_at` (the
 * actual data age) or, failing that, the last successful poll time; turns
 * into a warning once the newest data is older than 15 minutes.
 */
export function UpdatedIndicator({ traffic, lastPoll, className = "" }: UpdatedIndicatorProps) {
  // Re-render periodically so the stale warning appears without a new poll.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const ts = latestTrafficUpdate(traffic) ?? lastPoll;
  if (ts === null) return null;
  const stale = now - ts > STALE_MS;

  return (
    <div
      className={`flex items-center gap-1.5 noc-glass rounded px-2 py-1 ${className}`}
      title={stale ? `Newest data is from ${new Date(ts).toLocaleString()} — older than 15 minutes` : new Date(ts).toLocaleString()}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${stale ? "bg-node-router animate-pulse" : "bg-node-server"}`} />
      <span className={`text-2xs tabular-nums ${stale ? "text-node-router" : "text-noc-text-muted"}`}>
        {stale ? "Stale · " : ""}Updated {formatHHMM(ts)}
      </span>
    </div>
  );
}
