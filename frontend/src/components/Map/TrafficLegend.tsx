import { useState } from "react";
import type { ScaleBand } from "@/types";
import { useMapStore } from "@/hooks/useMapStore";
import { resolveColor } from "@/utils/scaleColor";
import { LINK_STATUS_STYLE } from "./linkStatus";
import { useThemeKey } from "./canvasTheme";

interface TrafficLegendProps {
  scales: ScaleBand[];
}

/**
 * Floating "Link load" key: the map's scale bands (resolved for the current
 * theme), then the link states drawn exactly like the edges.
 * Positioned inside the canvas container (which is `relative`).
 */
export function TrafficLegend({ scales }: TrafficLegendProps) {
  // Collapsed by default on phones, where an open legend would hide the map.
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  // Re-render on theme change: swatch colors are resolved from tokens.
  useThemeKey();
  // The PropertyPanel (w-72, fixed right-0) slides in when something is
  // selected in edit mode — shift the legend left by its width to avoid overlap.
  const panelOpen = useMapStore(
    (s) =>
      s.editMode &&
      (s.selectedNodeIds.length > 0 || s.selectedLinkIds.length > 0),
  );
  // In edit mode the toolbar spans the top of the canvas: sit below it.
  const editMode = useMapStore((s) => s.editMode);
  const top = editMode ? "top-16" : "top-3";
  const posClass = `absolute ${top} ${panelOpen ? "right-76" : "right-3"} z-20`;

  if (!scales.length) return null;

  const sorted = scales.toSorted((a, b) => a.min - b.min);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className={`${posClass} flex items-center gap-1.5 bg-card border border-border rounded px-2 py-1 text-sm text-foreground-secondary hover:text-foreground hover:bg-muted transition-colors`}
        title="Show legend"
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M18 20V10M12 20V4M6 20v-6" />
        </svg>
        Legend
      </button>
    );
  }

  return (
    <div className={`${posClass} bg-card border border-border rounded px-3 py-2`}>
      <div className="flex items-center justify-between gap-4 mb-1.5">
        <h2 className="text-sm font-semibold text-foreground">Link load</h2>
        <button
          onClick={() => setCollapsed(true)}
          className="p-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors -mr-1"
          title="Hide legend"
          aria-label="Hide legend"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {sorted.map((band) => (
          <div key={`${band.min}-${band.max}`} className="flex items-center gap-2">
            <span
              className="w-5 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: resolveColor(band.color) }}
            />
            <span className="text-xs text-foreground-secondary tabular-nums">{band.label}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-border-soft my-2" />
      <div className="flex flex-col gap-1">
        {LINK_STATE_ROWS.map((row) => (
          <div key={row.label} className="flex items-center gap-2" title={row.title}>
            <svg className="w-5 h-2 shrink-0" viewBox="0 0 20 8" preserveAspectRatio="none" aria-hidden>
              <line
                x1="0" y1="4" x2="20" y2="4"
                stroke={resolveColor(row.color)}
                strokeWidth={3}
                strokeDasharray={row.dash}
              />
            </svg>
            <span className="text-xs text-foreground-secondary">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const LINK_STATE_ROWS = [
  { label: "Down", ...pick("down") },
  { label: "Admin down", ...pick("admin_down") },
  { label: "No data", ...pick("nodata") },
];

function pick(status: "down" | "admin_down" | "nodata") {
  const s = LINK_STATUS_STYLE[status];
  return { color: s?.color ?? "@muted", dash: s?.dash, title: s?.title ?? "" };
}
