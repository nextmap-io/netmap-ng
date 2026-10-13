import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_HEIGHT, formatAxis, formatRate, formatTimeTick, timeTicks, type Period } from "./format";
import type { ChartScale } from "./trafficStats";
import { useChartColors } from "./useChartColors";

export interface ChartDatum {
  time: number;
  /** In, ≥ 0 (drawn above zero). */
  in: number | null;
  /** Out, ≤ 0 (negated, drawn below zero). */
  out: number | null;
  prevIn?: number | null;
  prevOut?: number | null;
}

export interface PeakAnnotation {
  value: number;
  direction: "in" | "out";
}

interface TrafficChartProps {
  data: ChartDatum[];
  period: Period;
  scale: ChartScale;
  peak: PeakAnnotation | null;
  showPrevious: boolean;
}


const SERIES_NAMES: Record<string, string> = {
  in: "In",
  out: "Out",
  prevIn: "In, previous period",
  prevOut: "Out, previous period",
};

export default function TrafficChart({ data, period, scale, peak, showPrevious }: TrafficChartProps) {
  const c = useChartColors();
  const first = data.length ? data[0].time : 0;
  const last = data.length ? data[data.length - 1].time : 0;
  const xTicks = timeTicks(first, last, period);
  const axisTick = { fill: c.axis, fontSize: 12 };
  // The capacity is annotated only when it is not already the top of the chart.
  const capacityInside = scale.capacity !== null && scale.capacity < scale.max;

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <ComposedChart data={data} margin={{ top: 20, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis
          dataKey="time"
          type="number"
          scale="time"
          domain={[first, last]}
          ticks={xTicks}
          tickFormatter={(ts: number) => formatTimeTick(ts, period)}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis
          type="number"
          domain={[-scale.max, scale.max]}
          ticks={scale.ticks}
          allowDataOverflow
          tickFormatter={(v: number) => formatAxis(v)}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={48}
          label={{ value: "b/s", position: "top", offset: 8, fill: c.axis, fontSize: 12 }}
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: c.cursor, strokeWidth: 1 }}
          labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
          formatter={(value: unknown, name: string | number) => [
            typeof value === "number" ? formatRate(Math.abs(value)) : "—",
            SERIES_NAMES[String(name)] ?? String(name),
          ]}
        />

        <Area
          type="stepAfter"
          dataKey="in"
          name="in"
          stroke={c.seriesA}
          strokeWidth={1.5}
          fill={c.seriesA}
          fillOpacity={0.12}
          baseValue={0}
          connectNulls={false}
          isAnimationActive={false}
          activeDot={false}
        />
        <Area
          type="stepAfter"
          dataKey="out"
          name="out"
          stroke={c.seriesB}
          strokeWidth={1.5}
          fill={c.seriesB}
          fillOpacity={0.12}
          baseValue={0}
          connectNulls={false}
          isAnimationActive={false}
          activeDot={false}
        />

        {showPrevious && (
          <Line
            type="stepAfter"
            dataKey="prevIn"
            name="prevIn"
            stroke={c.ink}
            strokeWidth={1}
            strokeDasharray="4 3"
            dot={false}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        )}
        {showPrevious && (
          <Line
            type="stepAfter"
            dataKey="prevOut"
            name="prevOut"
            stroke={c.ink}
            strokeWidth={1}
            strokeDasharray="4 3"
            dot={false}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        )}

        {/* Solid zero line between in (above) and out (below). */}
        <ReferenceLine y={0} stroke={c.zero} strokeWidth={1} />

        {capacityInside && scale.capacity !== null && (
          <>
            <ReferenceLine
              y={scale.capacity}
              stroke={c.axis}
              strokeDasharray="2 3"
              label={{ value: `Capacity ${formatRate(scale.capacity)}`, position: "insideBottomLeft", fill: c.axis, fontSize: 12 }}
            />
            <ReferenceLine y={-scale.capacity} stroke={c.axis} strokeDasharray="2 3" />
          </>
        )}

        {peak && (
          <ReferenceLine
            y={peak.direction === "in" ? peak.value : -peak.value}
            stroke={c.ink}
            strokeDasharray="4 3"
            label={{
              value: `Peak ${formatRate(peak.value)} ${peak.direction}`,
              position: peak.direction === "in" ? "insideTopRight" : "insideBottomRight",
              fill: c.ink,
              fontSize: 12,
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
