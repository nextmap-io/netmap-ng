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

/** Smallest "nice" value (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ) ≥ v. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * mag >= v) return m * mag;
  }
  return 10 * mag;
}

export interface ChartScale {
  /** The chart spans [-max, +max]: in above zero, out below, one scale. */
  max: number;
  ticks: number[];
  /** Configured link capacity in b/s, or null when unknown. */
  capacity: number | null;
  /** The observed peak exceeds the configured capacity. */
  overCapacity: boolean;
}

/**
 * Mirror-chart scale. With a capacity the top of the chart is 100% of the
 * link (never auto-scaled, so a full chart means a full pipe); if the data
 * peaks above it, the scale extends to the peak and says so. Without a
 * capacity both directions share the larger of the two maxima.
 */
export function chartScale(peak: number, capacity: number | null, overlayPeak = 0): ChartScale {
  const extent = Math.max(peak, overlayPeak);
  let max: number;
  let overCapacity = false;
  if (capacity && capacity > 0) {
    overCapacity = peak > capacity;
    max = extent > capacity ? niceCeil(extent) : capacity;
  } else {
    max = niceCeil(extent);
  }
  const half = max / 2;
  return { max, ticks: [-max, -half, 0, half, max], capacity: capacity && capacity > 0 ? capacity : null, overCapacity };
}

/**
 * Index the previous-period series onto the current timestamps: each previous
 * sample is shifted forward by `shiftSeconds` and matched to the nearest
 * current timestamp within half a step. Unmatched points stay null (a gap).
 */
export function alignShifted(
  timestamps: readonly number[],
  prevTimestamps: readonly number[],
  prevValues: readonly (number | null)[],
  shiftSeconds: number,
): (number | null)[] {
  const out: (number | null)[] = timestamps.map(() => null);
  if (!timestamps.length || !prevTimestamps.length) return out;
  const step = timestamps.length > 1 ? Math.abs(timestamps[1] - timestamps[0]) : 300;
  let j = 0;
  for (let i = 0; i < prevTimestamps.length; i++) {
    const t = prevTimestamps[i] + shiftSeconds;
    while (j < timestamps.length - 1 && Math.abs(timestamps[j + 1] - t) <= Math.abs(timestamps[j] - t)) j++;
    if (Math.abs(timestamps[j] - t) <= step / 2) {
      const v = prevValues[i];
      out[j] = v != null && Number.isFinite(v) ? v : null;
    }
  }
  return out;
}
