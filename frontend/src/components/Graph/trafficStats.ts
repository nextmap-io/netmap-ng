export interface SeriesStats {
  max: number;
  avg: number;
  p95: number;
}

/**
 * Max / average / 95th percentile (nearest-rank, the usual burstable-billing
 * definition) over a series, ignoring null gaps and non-finite values.
 * Returns null when the series has no samples.
 */
export function seriesStats(values: readonly (number | null)[]): SeriesStats | null {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!xs.length) return null;
  const sorted = xs.toSorted((a, b) => a - b);
  const sum = xs.reduce((acc, v) => acc + v, 0);
  const rank = Math.max(1, Math.ceil(0.95 * sorted.length));
  return {
    max: sorted[sorted.length - 1],
    avg: sum / xs.length,
    p95: sorted[rank - 1],
  };
}
