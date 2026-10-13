const UNITS: Array<[number, string]> = [
  [1e12, "T"],
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "K"],
];

/** "7.4", "12", "0.5": one decimal below 100, trailing ".0" dropped. */
function short(v: number): string {
  const s = v >= 100 ? v.toFixed(0) : v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function split(bps: number): [string, string] {
  const abs = Math.abs(bps);
  for (const [div, unit] of UNITS) {
    if (abs >= div) return [short(abs / div), unit];
  }
  return [short(abs), ""];
}

/** A rate for prose and tables: "7.4 Gb/s", "800 Mb/s", "0 b/s". */
export function formatRate(bps: number): string {
  const [n, unit] = split(bps);
  return `${n} ${unit}b/s`;
}

/** A compact axis tick ("800M", "1.2G"); the unit "b/s" is on the axis label. */
export function formatAxis(bps: number): string {
  if (bps === 0) return "0";
  const [n, unit] = split(bps);
  return `${n}${unit}`;
}

/** Percent of capacity, "74%" (one decimal under 10%). */
export function formatPercent(value: number, capacity: number): string {
  const pct = (value / capacity) * 100;
  return pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

export type Period = "-6h" | "-24h" | "-7d" | "-30d";

export const PERIODS: Array<{ value: Period; label: string; seconds: number }> = [
  { value: "-6h", label: "6h", seconds: 6 * 3600 },
  { value: "-24h", label: "24h", seconds: 24 * 3600 },
  { value: "-7d", label: "7d", seconds: 7 * 86400 },
  { value: "-30d", label: "30d", seconds: 30 * 86400 },
];

export const periodSeconds = (p: Period): number =>
  PERIODS.find((x) => x.value === p)?.seconds ?? 86400;

/**
 * The window just before `p`, as rrdtool start/end strings: "-24h" → start
 * "-48h", end "-24h". Matches the backend's `-<n><unit>` time format.
 */
export function previousWindow(p: Period): { start: string; end: string } {
  const m = /^-(\d+)([a-zA-Z])$/.exec(p);
  if (!m) return { start: p, end: "now" };
  return { start: `-${Number(m[1]) * 2}${m[2]}`, end: p };
}

/**
 * Time-axis ticks aligned to local clock boundaries, sized to the period
 * (hourly for 6h, every 4h for 24h, daily for 7d, every 5 days for 30d).
 */
export function timeTicks(min: number, max: number, p: Period): number[] {
  if (!(max > min)) return [];
  const hour = 3600_000;
  const stepHours = p === "-6h" ? 1 : p === "-24h" ? 4 : p === "-7d" ? 24 : 24 * 5;
  const d = new Date(min);
  d.setMinutes(0, 0, 0);
  if (stepHours >= 24) d.setHours(0);
  else d.setHours(Math.floor(d.getHours() / stepHours) * stepHours);
  const ticks: number[] = [];
  // Step in calendar units so DST changes keep ticks on the boundary.
  while (d.getTime() <= max && ticks.length < 50) {
    if (d.getTime() >= min) ticks.push(d.getTime());
    if (stepHours >= 24) d.setDate(d.getDate() + stepHours / 24);
    else d.setTime(d.getTime() + stepHours * hour);
  }
  return ticks;
}

export function formatTimeTick(ts: number, p: Period): string {
  const d = new Date(ts);
  if (p === "-6h" || p === "-24h") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Height of the chart, and of its loading / empty / error placeholders. */
export const CHART_HEIGHT = 220;
