import type { ScaleBand } from "@/types";

interface TrafficLegendProps {
  scales: ScaleBand[];
}

export function TrafficLegend({ scales }: TrafficLegendProps) {
  if (!scales.length) return null;

  return (
    <div className="absolute top-3 right-3 noc-glass rounded z-10 p-3 animate-fade-in">
      <div className="noc-label mb-2.5">Traffic Load</div>
      <div className="flex flex-col gap-1.5">
        {scales.map((band, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className="w-5 h-2.5 rounded-sm"
              style={{ backgroundColor: band.color }}
            />
            <span className="text-2xs text-noc-text-muted tabular-nums">{band.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
