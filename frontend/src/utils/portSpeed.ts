import type { ObserviumPort } from "@/types";

/**
 * Best-known interface speed in bits per second, or 0 when unknown.
 * Prefers ifHighSpeed (Mbps, 64-bit safe) over ifSpeed, which saturates at
 * ~4.29 Gbps on 32-bit counters and so misreports 10G/100G ports.
 */
export function portSpeedBps(port: Pick<ObserviumPort, "ifSpeed" | "ifHighSpeed"> | null | undefined): number {
  if (!port) return 0;
  const high = Number(port.ifHighSpeed) || 0;
  if (high > 0) return high * 1e6;
  const speed = Number(port.ifSpeed) || 0;
  return speed > 0 ? speed : 0;
}
