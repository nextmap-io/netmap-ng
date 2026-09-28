import type { LinkStatus } from "@/types";

/**
 * Visual treatment of non-"ok" link states. Shared by the edge renderer and
 * the legend so both always agree. Colours are deliberately outside the load
 * scale (no blue/green/yellow) so a dead link never reads as "lightly loaded".
 */
export const LINK_DOWN_COLOR = "#ff3300";
export const LINK_ADMIN_DOWN_COLOR = "hsl(220 6% 54%)";
export const LINK_NODATA_COLOR = "hsl(220 6% 46%)";

interface StatusStyle {
  color: string;
  dash?: string;
  label?: string;
  title: string;
}

/** States that replace the traffic colours entirely (no arrows / bps labels). */
export const LINK_STATUS_STYLE: Partial<Record<LinkStatus, StatusStyle>> = {
  down: { color: LINK_DOWN_COLOR, dash: "8 4", label: "DOWN", title: "Link down (oper status)" },
  admin_down: { color: LINK_ADMIN_DOWN_COLOR, dash: "4 4", label: "ADMIN DOWN", title: "Administratively down" },
  nodata: { color: LINK_NODATA_COLOR, title: "No traffic data" },
  unbound: { color: LINK_NODATA_COLOR, title: "No datasource bound" },
};

/** Opacity applied to the whole edge group for dimmed states. */
export const LINK_STATUS_OPACITY: Partial<Record<LinkStatus, number>> = {
  unbound: 0.4,
  stale: 0.5,
};

export const NODE_DOWN_COLOR = LINK_DOWN_COLOR;
export const NODE_UNKNOWN_COLOR = "hsl(220 6% 52%)";

/** Normalise an epoch value that may be in seconds or milliseconds to ms. */
export function epochToMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}
