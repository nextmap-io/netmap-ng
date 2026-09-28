import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useMapStore } from "@/hooks/useMapStore";
import type { MapLink, TrafficHistory } from "@/types";
import { formatBps } from "../Map/MapView";
import { seriesStats, type SeriesStats } from "./trafficStats";

const TrafficChart = lazy(() => import("./TrafficChart"));

/** Fetch history for a period ("-6h", "-24h", …). */
export type TrafficHistoryFetcher = (period: string) => Promise<TrafficHistory>;

interface TrafficGraphPanelProps {
  link: MapLink;
  onClose: () => void;
  /**
   * Optional history source (e.g. a public, token-scoped endpoint). When set
   * it replaces the default Observium/RRD lookup. Keep it referentially
   * stable (useCallback): a new identity triggers a refetch.
   */
  fetcher?: TrafficHistoryFetcher;
}

const hasData = (h: TrafficHistory): boolean =>
  h.in_bps.some((v) => v != null) || h.out_bps.some((v) => v != null);

const swapDirections = (h: TrafficHistory): TrafficHistory => ({
  timestamps: h.timestamps,
  in_bps: h.out_bps,
  out_bps: h.in_bps,
});

export function TrafficGraphPanel({ link, onClose, fetcher }: TrafficGraphPanelProps) {
  const mapId = useMapStore((s) => s.map?.id);
  const [history, setHistory] = useState<TrafficHistory | null>(null);
  const [timeRange, setTimeRange] = useState("-24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Set when side A returned nothing and the graph fell back to side B,
  // mirroring the live-traffic fallback.
  const [fellBackToB, setFellBackToB] = useState(false);

  const hostname = typeof link.extra?.hostname === "string" ? link.extra.hostname : "";
  const portIdentifier =
    typeof link.extra?.port_identifier === "string" ? link.extra.port_identifier : "";
  const hasExplicitRrd = !!hostname && !!portIdentifier;
  const portA = link.observium_port_id_a;
  const portB = link.observium_port_id_b;
  // B-only binding: B's counters are measured from the other end, so its
  // in/out are swapped to keep the graph in the link's A→B orientation.
  const usesPortB =
    fellBackToB || (!fetcher && !hasExplicitRrd && portA == null && portB != null);
  const hasSource = !!fetcher || hasExplicitRrd || portA != null || portB != null;

  useEffect(() => {
    // Always drop the previous link's/period's graph first so a stale chart
    // can never show under a different selection.
    setHistory(null);
    setError(null);
    setFellBackToB(false);

    let onB = false;
    let request: (() => Promise<TrafficHistory>) | null = null;
    if (fetcher) {
      request = () => fetcher(timeRange);
    } else if (mapId && hasExplicitRrd) {
      request = () => api.getTrafficHistory(hostname, portIdentifier, mapId, timeRange);
    } else if (mapId && portA != null) {
      request = () =>
        api.getTrafficHistoryByPort(portA, mapId, timeRange).then((h) => {
          if (hasData(h) || portB == null) return h;
          return api.getTrafficHistoryByPort(portB, mapId, timeRange).then((hb) => {
            if (!hasData(hb)) return h;
            onB = true;
            return swapDirections(hb);
          });
        });
    } else if (mapId && portB != null) {
      request = () => api.getTrafficHistoryByPort(portB, mapId, timeRange).then(swapDirections);
    }

    if (!request) {
      setLoading(false);
      return;
    }

    // Ignore late responses: selecting link B while A's request is in flight
    // must not let A's result overwrite B.
    let cancelled = false;
    setLoading(true);
    request()
      .then((h) => {
        if (cancelled) return;
        setHistory(h);
        setFellBackToB(onB);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load traffic history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [link.id, hostname, portIdentifier, hasExplicitRrd, portA, portB, mapId, timeRange, fetcher, reloadKey]);

  const chartData = useMemo(
    () =>
      history
        ? history.timestamps.map((ts, i) => {
            const vin = history.in_bps[i];
            const vout = history.out_bps[i];
            // Keep nulls (RRD gaps) as nulls so the chart draws a gap, not a drop to 0.
            return {
              time: ts * 1000,
              in: vin == null ? null : vin,
              out: vout == null ? null : -vout,
            };
          })
        : [],
    [history],
  );

  const stats = useMemo(
    () =>
      history
        ? { in: seriesStats(history.in_bps), out: seriesStats(history.out_bps) }
        : { in: null, out: null },
    [history],
  );
  const hasSamples = !!stats.in || !!stats.out;

  const interfaceA = (link.extra?.interface_a as string) || "";
  const interfaceB = (link.extra?.interface_b as string) || "";

  const timeRanges = [
    { value: "-6h", label: "6H" },
    { value: "-24h", label: "24H" },
    { value: "-7d", label: "7D" },
    { value: "-30d", label: "30D" },
  ];

  return (
    <div className="absolute bottom-0 left-0 right-0 noc-glass border-t border-noc-border z-20 max-h-[50vh] overflow-auto animate-fade-in">
      <div className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-accent/10 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <h3 className="text-xs font-medium text-noc-text">{link.name}</h3>
              <p className="text-2xs text-noc-text-dim">
                {interfaceA && interfaceB
                  ? `${interfaceA} \u2194 ${interfaceB}`
                  : `${link.bandwidth_label} ${link.link_type}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Traffic direction indicators */}
            <div className="flex items-center gap-3 mr-3 hidden sm:flex">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-1 rounded-full bg-traffic-in" />
                <span className="text-2xs text-noc-text-muted">In</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-1 rounded-full bg-traffic-out" />
                <span className="text-2xs text-noc-text-muted">Out</span>
              </div>
            </div>

            <div className="h-4 w-px bg-noc-border hidden sm:block" />

            {/* Time range buttons */}
            {timeRanges.map((range) => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range.value)}
                className={`px-2 py-1 text-2xs rounded font-medium tracking-wider transition-colors ${
                  timeRange === range.value
                    ? "bg-accent/15 text-accent border border-accent/20"
                    : "text-noc-text-dim border border-transparent hover:text-noc-text-muted hover:bg-noc-surface"
                }`}
              >
                {range.label}
              </button>
            ))}

            <div className="h-4 w-px bg-noc-border ml-1" />

            <button
              onClick={onClose}
              className="p-1.5 text-noc-text-dim hover:text-noc-text rounded hover:bg-noc-surface transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Chart */}
        {loading ? (
          <div className="flex items-center justify-center h-44">
            <div className="w-5 h-5 border border-accent/40 border-t-accent rounded-full animate-spin-slow" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-44 text-center">
            <p className="text-2xs text-node-firewall">Failed to load traffic history</p>
            <p className="text-2xs text-noc-text-dim mt-0.5 max-w-sm truncate" title={error}>{error}</p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-2 px-2 py-1 text-2xs text-accent bg-accent/10 border border-accent/20 rounded hover:bg-accent/20 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : !hasSamples ? (
          <div className="flex flex-col items-center justify-center h-44 text-center">
            <svg viewBox="0 0 24 24" className="w-6 h-6 mb-2 text-noc-text-dim opacity-40" fill="none" stroke="currentColor" strokeWidth={1}>
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <p className="text-2xs text-noc-text-dim">
              No historical data available
            </p>
            {!hasSource && (
              <p className="text-2xs text-noc-text-dim mt-0.5">
                Configure an RRD datasource for this link
              </p>
            )}
          </div>
        ) : (
          <>
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-44">
                  <div className="w-5 h-5 border border-accent/40 border-t-accent rounded-full animate-spin-slow" />
                </div>
              }
            >
              <TrafficChart data={chartData} />
            </Suspense>
            <TrafficStatsTable inStats={stats.in} outStats={stats.out} note={usesPortB ? "measured on port B" : null} />
          </>
        )}
      </div>
    </div>
  );
}

function TrafficStatsTable({
  inStats,
  outStats,
  note,
}: {
  inStats: SeriesStats | null;
  outStats: SeriesStats | null;
  note: string | null;
}) {
  const cell = (s: SeriesStats | null, k: keyof SeriesStats) => (s ? formatBps(s[k]) : "—");
  const rows = [
    { label: "In", dot: "bg-traffic-in", s: inStats },
    { label: "Out", dot: "bg-traffic-out", s: outStats },
  ];
  return (
    <div className="mt-2 flex items-end justify-between gap-4">
      <table className="text-2xs tabular-nums">
        <thead>
          <tr className="text-noc-text-dim">
            <th className="font-normal text-left pr-4" />
            <th className="font-normal text-right pr-4">Max</th>
            <th className="font-normal text-right pr-4">Avg</th>
            <th className="font-normal text-right" title="95th percentile (nearest rank) over the displayed period">95th</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="text-noc-text-muted">
              <td className="pr-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2.5 h-1 rounded-full ${r.dot}`} />
                  {r.label}
                </span>
              </td>
              <td className="text-right pr-4 text-noc-text">{cell(r.s, "max")}</td>
              <td className="text-right pr-4">{cell(r.s, "avg")}</td>
              <td className="text-right text-noc-text">{cell(r.s, "p95")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <span className="text-2xs text-noc-text-dim italic">{note}</span>}
    </div>
  );
}
