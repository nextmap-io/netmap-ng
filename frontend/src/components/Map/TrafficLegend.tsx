import { useState } from "react";
import type { ScaleBand } from "@/types";
import { useMapStore } from "@/hooks/useMapStore";

interface TrafficLegendProps {
  scales: ScaleBand[];
}

export function TrafficLegend({ scales }: TrafficLegendProps) {
  const [collapsed, setCollapsed] = useState(false);
  // The PropertyPanel (w-72, fixed right-0) slides in when something is
  // selected in edit mode — shift the legend left by its width to avoid overlap.
  const panelOpen = useMapStore(
    (s) =>
      s.editMode &&
      (s.selectedNodeIds.length > 0 || s.selectedLinkIds.length > 0),
  );
  // top-16 keeps clear of the header; right offset dodges the property panel.
  const posClass = panelOpen ? "fixed top-16 right-[19rem] z-40" : "fixed top-16 right-3 z-40";

  if (!scales.length) return null;

  const sorted = scales.toSorted((a, b) => a.min - b.min);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className={`${posClass} noc-glass rounded p-1.5 hover:bg-noc-surface/50 transition-colors`}
        title="Show legend"
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-noc-text-muted" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M18 20V10M12 20V4M6 20v-6" />
        </svg>
      </button>
    );
  }

  return (
    <div className={`${posClass} noc-glass rounded p-2 sm:p-3`}>
      <div className="flex items-center justify-between mb-1.5 sm:mb-2.5">
        <div className="noc-label text-[8px] sm:text-[10px]">Traffic Load</div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-0.5 rounded hover:bg-noc-surface/50 text-noc-text-dim hover:text-noc-text transition-colors -mr-1 ml-3"
          title="Hide legend"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex flex-col gap-1 sm:gap-1.5">
        {sorted.map((band) => (
          <div key={`${band.min}-${band.max}`} className="flex items-center gap-1.5 sm:gap-2">
            <div
              className="w-4 sm:w-5 h-2 sm:h-2.5 rounded-sm"
              style={{ backgroundColor: band.color }}
            />
            <span className="text-[9px] sm:text-2xs text-noc-text-muted tabular-nums">{band.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
