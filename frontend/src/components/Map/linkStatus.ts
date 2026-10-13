import type { LinkStatus } from "@/types";

/**
 * Visual treatment of non-"ok" link states. Shared by the edge renderer, the
 * legend and the "Right now" band so they always agree. Colors are theme
 * tokens: resolve them with resolveColor() from utils/scaleColor before
 * drawing, and re-render on theme change.
 */
export const LINK_DOWN_COLOR = "@incident";
export const LINK_ADMIN_DOWN_COLOR = "@muted";
export const LINK_NODATA_COLOR = "@muted";

interface StatusStyle {
  color: string;
  dash?: string;
  /** Word shown on the link (sentence case). */
  label?: string;
  /** "incident" badges use the destructive surface, "muted" a neutral one. */
  tone?: "incident" | "muted";
  title: string;
}

/** States that replace the traffic colours entirely (no arrows / bps labels). */
export const LINK_STATUS_STYLE: Partial<Record<LinkStatus, StatusStyle>> = {
  down: { color: LINK_DOWN_COLOR, dash: "8 4", label: "Down", tone: "incident", title: "Link down (oper status)" },
  admin_down: { color: LINK_ADMIN_DOWN_COLOR, dash: "4 4", label: "Admin down", tone: "muted", title: "Administratively down" },
  nodata: { color: LINK_NODATA_COLOR, title: "No traffic data" },
  unbound: { color: LINK_NODATA_COLOR, title: "No datasource bound" },
};

/** Opacity applied to the whole edge group for dimmed states. */
export const LINK_STATUS_OPACITY: Partial<Record<LinkStatus, number>> = {
  unbound: 0.4,
  stale: 0.5,
};

/** Normalise an epoch value that may be in seconds or milliseconds to ms. */
export function epochToMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}
