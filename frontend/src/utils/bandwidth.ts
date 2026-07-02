/**
 * Bandwidth label <-> bits-per-second helpers.
 * Shared between the link creation dialog and the link property editor so a
 * free-text capacity (e.g. "2G", "500M") round-trips consistently.
 */

/** Parse a human bandwidth label (e.g. "2.5G", "500M") into bits per second. */
export function parseBandwidth(label: string): number {
  const match = label.trim().match(/^([\d.]+)\s*(T|G|M|K)?$/i);
  if (!match) return 1_000_000_000;
  const value = parseFloat(match[1]);
  const unit = (match[2] || "").toUpperCase();
  switch (unit) {
    case "T": return value * 1e12;
    case "G": return value * 1e9;
    case "M": return value * 1e6;
    case "K": return value * 1e3;
    default: return value;
  }
}

/** Format a bits-per-second capacity into a compact label (e.g. "2.5G"). */
export function formatBandwidthLabel(bps: number): string {
  if (bps >= 1e12) return `${trim(bps / 1e12)}T`;
  if (bps >= 1e9) return `${trim(bps / 1e9)}G`;
  if (bps >= 1e6) return `${trim(bps / 1e6)}M`;
  if (bps >= 1e3) return `${trim(bps / 1e3)}K`;
  return `${Math.round(bps)}`;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
