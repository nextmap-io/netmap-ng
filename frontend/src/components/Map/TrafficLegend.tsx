import { useState } from "react";
import type { ScaleBand } from "@/types";

interface TrafficLegendProps {
  scales: ScaleBand[];
}

export function TrafficLegend({ scales }: TrafficLegendProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!scales.length) return null;

  const sorted = [...scales].sort((a, b) => a.min - b.min);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed top-16 right-3 z-40 noc-glass rounded p-1.5 hover:bg-noc-surface/50 transition-colors"
        title="Show legend"
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-noc-text-muted" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M18 20V10M12 20V4M6 20v-6" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed top-16 right-3 z-40 noc-glass rounded p-2 sm:p-3">
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
        {sorted.map((band, i) => (
          <div key={i} className="flex items-center gap-1.5 sm:gap-2">
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
