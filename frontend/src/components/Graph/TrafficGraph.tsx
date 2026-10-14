import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useMapStore } from "@/hooks/useMapStore";
import type { MapLink, TrafficData, TrafficHistory } from "@/types";
import {
  CHART_HEIGHT,
  PERIODS,
  formatPercent,
  formatRate,
  periodSeconds,
  previousWindow,
  type Period,
} from "./format";
import { alignShifted, chartScale, seriesStats, type ScaleMode, type SeriesStats } from "./trafficStats";
import type { ChartDatum, PeakAnnotation } from "./TrafficChart";
import { useKeyedResult } from "./useKeyedResult";

const TrafficChart = lazy(() => import("./TrafficChart"));

/** Fetch history for a period ("-6h", "-24h", …). */
export type TrafficHistoryFetcher = (period: string) => Promise<TrafficHistory>;

interface TrafficGraphPanelProps {
  link: MapLink;
  onClose: () => void;
  /**
   * Optional history source (e.g. a public, token-scoped endpoint). When set
   * it replaces the default Observium/RRD lookup, and the previous-period
   * comparison is hidden (the fetcher only takes a period). Keep it
   * referentially stable (useCallback): a new identity triggers a refetch.
   */
  fetcher?: TrafficHistoryFetcher;
  /** The link's current live values, shown above the history ("Now …"). */
  live?: TrafficData[string];
}

/** "<1%" for small non-zero values, so light traffic never reads as idle. */
const pctText = (pct: number) => (pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`);

interface Loaded {
  h: TrafficHistory;
  /** Side A returned nothing and the graph fell back to side B. */
  onB: boolean;
}

const hasData = (h: TrafficHistory): boolean =>
  h.in_bps.some((v) => v != null) || h.out_bps.some((v) => v != null);

const swapDirections = (h: TrafficHistory): TrafficHistory => ({
  timestamps: h.timestamps,
  in_bps: h.out_bps,
  out_bps: h.in_bps,
});

const maxOf = (xs: readonly (number | null | undefined)[]): number =>
  xs.reduce<number>((m, v) => (v != null && Number.isFinite(v) && v > m ? v : m), 0);

export function TrafficGraphPanel({ link, onClose, fetcher, live }: TrafficGraphPanelProps) {
  const mapId = useMapStore((s) => s.map?.id);
  const [period, setPeriod] = useState<Period>("-24h");
  const [compare, setCompare] = useState(false);
  // Fit to traffic by default: pinned to capacity, a lightly used fat link is
  // a flat line. Remembered per browser.
  const [scaleMode, setScaleModeState] = useState<ScaleMode>(() => {
    try {
      return localStorage.getItem("graphScale") === "capacity" ? "capacity" : "fit";
    } catch {
      return "fit";
    }
  });
  const setScaleMode = (m: ScaleMode) => {
    setScaleModeState(m);
    try {
      localStorage.setItem("graphScale", m);
    } catch {
      /* storage unavailable */
    }
  };
  const [reloadKey, setReloadKey] = useState(0);

  const hostname = typeof link.extra?.hostname === "string" ? link.extra.hostname : "";
  const portIdentifier =
    typeof link.extra?.port_identifier === "string" ? link.extra.port_identifier : "";
  const hasExplicitRrd = !!hostname && !!portIdentifier;
  const portA = link.observium_port_id_a;
  const portB = link.observium_port_id_b;
  const hasSource = !!fetcher || hasExplicitRrd || portA != null || portB != null;
  const capacity = typeof link.bandwidth === "number" && link.bandwidth > 0 ? link.bandwidth : null;

  /**
   * Build the loader for one window. `forceB` reads side B directly (used for
   * the previous period when the current one already fell back to B).
   * B's counters are measured from the other end, so its in/out are swapped
   * to keep the graph in the link's A→B orientation.
   */
  const makeLoader = useCallback(
    (start: string, end: string, forceB: boolean): (() => Promise<Loaded>) | null => {
      if (fetcher) return () => fetcher(start).then((h) => ({ h, onB: false }));
      if (!mapId) return null;
      if (hasExplicitRrd) {
        return () =>
          api.getTrafficHistory(hostname, portIdentifier, mapId, start, end).then((h) => ({ h, onB: false }));
      }
      if (portB != null && (forceB || portA == null)) {
        return () =>
          api
            .getTrafficHistoryByPort(portB, mapId, start, end)
            .then((h) => ({ h: swapDirections(h), onB: portA != null }));
      }
      if (portA != null) {
        return () =>
          api.getTrafficHistoryByPort(portA, mapId, start, end).then((h) => {
            if (hasData(h) || portB == null) return { h, onB: false };
            return api
              .getTrafficHistoryByPort(portB, mapId, start, end)
              .then((hb) => (hasData(hb) ? { h: swapDirections(hb), onB: true } : { h, onB: false }));
          });
      }
      return null;
    },
    [fetcher, mapId, hasExplicitRrd, hostname, portIdentifier, portA, portB],
  );

  // Current window. The key carries the loader (link/period/source) and the
  // retry counter, so a result is only shown for exactly this request.
  const run = useMemo(() => makeLoader(period, "now", false), [makeLoader, period]);
  const mainKey = useMemo(() => ({ run, reloadKey }), [run, reloadKey]);
  const main = useKeyedResult(mainKey, run);
  const loaded = main.data;
  const history = loaded?.h ?? null;
  const usesPortB = !!loaded?.onB || (!fetcher && !hasExplicitRrd && portA == null && portB != null);

  // Previous window of the same length, read from the same side, fetched
  // once the current one is in (private view only).
  const canCompare = !fetcher;
  const showPrevious = canCompare && compare;
  const prevRun = useMemo(() => {
    if (!showPrevious || !loaded) return null;
    const w = previousWindow(period);
    return makeLoader(w.start, w.end, loaded.onB);
  }, [showPrevious, loaded, period, makeLoader]);
  const prevKey = useMemo(() => ({ prevRun, reloadKey }), [prevRun, reloadKey]);
  const prev = useKeyedResult(prevKey, prevRun);
  const prevHistory = prev.data?.h ?? null;

  const stats = useMemo(
    () =>
      history
        ? { in: seriesStats(history.in_bps), out: seriesStats(history.out_bps) }
        : { in: null, out: null },
    [history],
  );
  const hasSamples = !!stats.in || !!stats.out;

  const chartData = useMemo((): ChartDatum[] => {
    if (!history) return [];
    const shift = periodSeconds(period);
    const prevIn = prevHistory ? alignShifted(history.timestamps, prevHistory.timestamps, prevHistory.in_bps, shift) : null;
    const prevOut = prevHistory ? alignShifted(history.timestamps, prevHistory.timestamps, prevHistory.out_bps, shift) : null;
    return history.timestamps.map((ts, i) => {
      const vin = history.in_bps[i];
      const vout = history.out_bps[i];
      const pin = prevIn?.[i];
      const pout = prevOut?.[i];
      // Keep nulls (RRD gaps) as nulls so the chart draws a gap, not a drop to 0.
      return {
        time: ts * 1000,
        in: vin == null ? null : vin,
        out: vout == null ? null : -vout,
        prevIn: pin == null ? null : pin,
        prevOut: pout == null ? null : -pout,
      };
    });
  }, [history, prevHistory, period]);

  const peakIn = stats.in?.max ?? 0;
  const peakOut = stats.out?.max ?? 0;
  const peak: PeakAnnotation | null = hasSamples
    ? peakIn >= peakOut
      ? { value: peakIn, direction: "in" }
      : { value: peakOut, direction: "out" }
    : null;
  const overlayPeak = prevHistory ? Math.max(maxOf(prevHistory.in_bps), maxOf(prevHistory.out_bps)) : 0;
  const scale = chartScale(peak?.value ?? 0, capacity, showPrevious ? overlayPeak : 0, scaleMode);

  const interfaceA = typeof link.extra?.interface_a === "string" ? link.extra.interface_a : "";
  const interfaceB = typeof link.extra?.interface_b === "string" ? link.extra.interface_b : "";
  const linkType = link.link_type ? String(link.link_type).replace(/_/g, " ") : "";
  const secondary = [
    interfaceA && interfaceB ? `${interfaceA} ↔ ${interfaceB}` : "",
    capacity
      ? scale.overCapacity
        ? `peaks above the configured ${formatRate(capacity)} capacity`
        : peak && scaleMode === "fit" && scale.max < capacity
          ? `${formatRate(capacity)} capacity · peak ${formatPercent(peak.value, capacity)} of it`
          : `${formatRate(capacity)} capacity`
      : "",
    linkType,
  ].filter(Boolean);

  const placeholder = { height: CHART_HEIGHT };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 max-h-[60vh] overflow-y-auto overflow-x-hidden bg-card border-t border-border">
      <div className="px-4 py-3 sm:px-5 sm:py-4">
        {/* Header: name and context, then the controls; close stays top-right. */}
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-foreground">{link.name}</h2>
              {secondary.length > 0 && (
                <p className="text-sm text-foreground-secondary">{secondary.join(" · ")}</p>
              )}
              {live && (live.status === undefined || live.status === "ok" || live.status === "stale") && (
                <p className="text-sm tabular-nums text-foreground">
                  <span className="text-muted-foreground">Now </span>
                  {live.in_bps !== undefined && <>in {formatRate(live.in_bps)} </>}
                  <span className="text-muted-foreground">({pctText(live.in_pct)})</span>
                  {" · "}
                  {live.out_bps !== undefined && <>out {formatRate(live.out_bps)} </>}
                  <span className="text-muted-foreground">({pctText(live.out_pct)})</span>
                  {live.status === "stale" && <span className="text-warning"> · Stale</span>}
                </p>
              )}
              {(link.info_url_in || link.info_url_out) && (
                <p className="text-sm">
                  {link.info_url_in && (
                    <a href={link.info_url_in} target="_blank" rel="noreferrer" className="text-link hover:underline">
                      Port page (A)
                    </a>
                  )}
                  {link.info_url_in && link.info_url_out && <span className="text-muted-foreground"> · </span>}
                  {link.info_url_out && (
                    <a href={link.info_url_out} target="_blank" rel="noreferrer" className="text-link hover:underline">
                      Port page (B)
                    </a>
                  )}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div role="radiogroup" aria-label="Period" className="inline-flex rounded bg-muted p-0.5">
                {PERIODS.map((p) => {
                  const active = period === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPeriod(p.value)}
                      className={`rounded px-2.5 py-0.5 text-sm transition-colors duration-100 ${
                        active ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {capacity !== null && (
                <div role="radiogroup" aria-label="Scale" className="inline-flex rounded bg-muted p-0.5">
                  {(
                    [
                      { value: "fit", label: "Fit", title: "Scale to the traffic" },
                      { value: "capacity", label: "Capacity", title: "Top of the chart = link capacity" },
                    ] as const
                  ).map((o) => {
                    const active = scaleMode === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        title={o.title}
                        onClick={() => setScaleMode(o.value)}
                        className={`rounded px-2.5 py-0.5 text-sm transition-colors duration-100 ${
                          active ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {canCompare && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground-secondary">
                  <input
                    type="checkbox"
                    checked={compare}
                    onChange={(e) => setCompare(e.target.checked)}
                    style={{ accentColor: "var(--color-link)" }}
                  />
                  Compare with previous period
                </label>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close graph"
            title="Close"
            className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-3">
          {main.loading ? (
            <div className="rounded bg-muted" style={placeholder} aria-busy="true" aria-label="Loading history" />
          ) : main.error ? (
            <div className="flex flex-col items-start justify-center gap-2" style={placeholder}>
              <p className="text-sm">
                <span className="font-medium text-destructive">Couldn't load history</span>
                <span className="text-foreground-secondary"> — {main.error}</span>
              </p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="rounded border border-border bg-background px-3 py-1 text-sm text-foreground transition-colors duration-100 hover:bg-muted"
              >
                Retry
              </button>
            </div>
          ) : !hasSamples ? (
            <div className="flex items-center" style={placeholder}>
              <p className="text-sm text-foreground-secondary">
                {!hasSource
                  ? "No history for this link — bind an Observium port to record traffic."
                  : fetcher
                    ? "No traffic recorded for this period — try a longer period."
                    : "No traffic recorded for this period — try a longer period, or check that Observium polls this port."}
              </p>
            </div>
          ) : (
            <>
              <Suspense fallback={<div className="rounded bg-muted" style={placeholder} />}>
                <TrafficChart
                  data={chartData}
                  period={period}
                  scale={scale}
                  peak={peak}
                  showPrevious={showPrevious && !!prevHistory}
                />
              </Suspense>
              <TrafficStatsTable inStats={stats.in} outStats={stats.out} capacity={capacity} />
              <p className="mt-2 text-sm text-muted-foreground">
                In above the zero line, out below
                {showPrevious && prevHistory ? "; the dashed lines are the previous period" : ""}
                {usesPortB ? ". Measured on port B, with in and out swapped to keep the A → B direction." : "."}
              </p>
              {showPrevious && prev.loading && (
                <p className="text-sm text-muted-foreground">Loading the previous period…</p>
              )}
              {showPrevious && prev.error && (
                <p className="text-sm text-foreground-secondary">
                  <span className="font-medium text-destructive">Couldn't load the previous period</span> — {prev.error}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TrafficStatsTable({
  inStats,
  outStats,
  capacity,
}: {
  inStats: SeriesStats | null;
  outStats: SeriesStats | null;
  capacity: number | null;
}) {
  const cols: Array<{ key: keyof SeriesStats; label: string; title?: string }> = [
    { key: "max", label: "Max" },
    { key: "avg", label: "Avg" },
    { key: "p95", label: "95th", title: "95th percentile (nearest rank) over the displayed period" },
  ];
  const rows = [
    { label: "In", swatch: "bg-series-a", s: inStats },
    { label: "Out", swatch: "bg-series-b", s: outStats },
  ];
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 pr-6 text-left font-normal">Direction</th>
            {cols.map((c) => (
              <th key={c.key} className="py-1 pr-6 text-right font-normal last:pr-0" title={c.title}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border-soft">
              <td className="py-1 pr-6 text-foreground">
                <span className="inline-flex items-center gap-2">
                  <span className={`inline-block h-0.5 w-3 ${r.swatch}`} aria-hidden="true" />
                  {r.label}
                </span>
              </td>
              {cols.map((c) => (
                <td key={c.key} className="whitespace-nowrap py-1 pr-6 text-right text-foreground last:pr-0">
                  {r.s ? formatRate(r.s[c.key]) : "—"}
                  {r.s && capacity ? (
                    <span className="text-muted-foreground"> · {formatPercent(r.s[c.key], capacity)}</span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
