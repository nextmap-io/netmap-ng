import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBps } from "../Map/MapView";

interface ChartDatum {
  time: number;
  in: number;
  out: number;
}

interface TrafficChartProps {
  data: ChartDatum[];
}

export default function TrafficChart({ data }: TrafficChartProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradientIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(174 72% 46%)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="hsl(174 72% 46%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradientOut" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="hsl(36 100% 55%)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="hsl(36 100% 55%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(220 15% 16%)"
          strokeOpacity={0.5}
        />
        <XAxis
          dataKey="time"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(ts) =>
            new Date(ts).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          }
          stroke="hsl(215 15% 55%)"
          fontSize={10}
          tickLine={false}
          axisLine={{ stroke: "hsl(220 15% 16%)" }}
        />
        <YAxis
          tickFormatter={(v) => formatBps(Math.abs(v))}
          stroke="hsl(215 15% 55%)"
          fontSize={10}
          width={56}
          tickLine={false}
          axisLine={{ stroke: "hsl(220 15% 16%)" }}
        />
        <Tooltip
          labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
          formatter={(value: number) => [
            formatBps(Math.abs(value)) + "bps",
            value >= 0 ? "In" : "Out",
          ]}
          contentStyle={{
            backgroundColor: "hsl(220 18% 10%)",
            border: "1px solid hsl(220 15% 16%)",
            borderRadius: 6,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 11,
          }}
          labelStyle={{
            color: "hsl(215 15% 55%)",
            fontSize: 10,
            marginBottom: 4,
          }}
          itemStyle={{ color: "hsl(210 20% 88%)", padding: "1px 0" }}
        />
        <Area
          type="monotone"
          dataKey="in"
          stroke="hsl(174 72% 46%)"
          fill="url(#gradientIn)"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="out"
          stroke="hsl(36 100% 55%)"
          fill="url(#gradientOut)"
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
