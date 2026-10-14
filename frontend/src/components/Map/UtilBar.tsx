import type { Severity } from "@/utils/scaleColor";

const FILL: Record<Severity, string> = {
  normal: "bg-foreground-secondary",
  watch: "bg-warning-mark",
  incident: "bg-destructive",
};

/**
 * Ledger utilization bar: a quiet track, a neutral fill that turns amber /
 * red only past the scale thresholds, a dashed tick at 70% and the percentage
 * in tabular figures.
 */
export function UtilBar({ pct, severity, className = "" }: { pct: number; severity: Severity; className?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  const text = pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative h-1.5 flex-1 rounded-sm bg-muted" aria-hidden>
        <div className={`absolute inset-y-0 left-0 rounded-sm ${FILL[severity]}`} style={{ width: `${w}%` }} />
        <div className="absolute -inset-y-0.5 left-[70%] border-l border-dashed border-muted-foreground" />
      </div>
      <span
        className={`w-10 text-right text-sm tabular-nums ${
          severity === "incident" ? "text-destructive" : severity === "watch" ? "text-warning" : "text-foreground-secondary"
        }`}
      >
        {text}
      </span>
    </div>
  );
}
