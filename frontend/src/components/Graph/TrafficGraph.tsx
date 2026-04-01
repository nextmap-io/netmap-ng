import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api } from "@/api/client";
import { useMapStore } from "@/hooks/useMapStore";
import { formatBps } from "../Map/MapView";
import type { MapLink, TrafficHistory } from "@/types";

interface TrafficGraphPanelProps {
  link: MapLink;
  onClose: () => void;
}

export function TrafficGraphPanel({ link, onClose }: TrafficGraphPanelProps) {
  const mapId = useMapStore((s) => s.map?.id);
  const [history, setHistory] = useState<TrafficHistory | null>(null);
  const [timeRange, setTimeRange] = useState("-24h");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!link.extra?.hostname || !link.extra?.port_identifier || !mapId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getTrafficHistory(
        link.extra.hostname as string,
        link.extra.port_identifier as string,
        mapId,
        timeRange,
      )
      .then(setHistory)
      .finally(() => setLoading(false));
  }, [link, timeRange, mapId]);

  const chartData = history
    ? history.timestamps.map((ts, i) => ({
        time: ts * 1000,
        in: history.in_bps[i] || 0,
        out: -(history.out_bps[i] || 0),
      }))
    : [];

  const interfaceA = (link.extra?.interface_a as string) || "";
  const interfaceB = (link.extra?.interface_b as string) || "";

  const timeRanges = [
    { value: "-6h", label: "6H" },
    { value: "-24h", label: "24H" },
    { value: "-7d", label: "7D" },
    { value: "-30d", label: "30D" },
  ];

  return (
    <div className="absolute bottom-0 left-0 right-0 noc-glass border-t border-noc-border z-20 max-h-[50vh] overflow-auto animate-fade-in">
      <div className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-accent/10 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <h3 className="text-xs font-medium text-noc-text">{link.name}</h3>
              <p className="text-2xs text-noc-text-dim">
                {interfaceA && interfaceB
                  ? `${interfaceA} \u2194 ${interfaceB}`
                  : `${link.bandwidth_label} ${link.link_type}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Traffic direction indicators */}
            <div className="flex items-center gap-3 mr-3 hidden sm:flex">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-1 rounded-full bg-traffic-in" />
                <span className="text-2xs text-noc-text-muted">In</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-1 rounded-full bg-traffic-out" />
                <span className="text-2xs text-noc-text-muted">Out</span>
              </div>
            </div>

            <div className="h-4 w-px bg-noc-border hidden sm:block" />

            {/* Time range buttons */}
            {timeRanges.map((range) => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range.value)}
                className={`px-2 py-1 text-2xs rounded font-medium tracking-wider transition-colors ${
                  timeRange === range.value
                    ? "bg-accent/15 text-accent border border-accent/20"
                    : "text-noc-text-dim border border-transparent hover:text-noc-text-muted hover:bg-noc-surface"
                }`}
              >
                {range.label}
              </button>
            ))}

            <div className="h-4 w-px bg-noc-border ml-1" />

            <button
              onClick={onClose}
              className="p-1.5 text-noc-text-dim hover:text-noc-text rounded hover:bg-noc-surface transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Chart */}
        {loading ? (
          <div className="flex items-center justify-center h-44">
            <div className="w-5 h-5 border border-accent/40 border-t-accent rounded-full animate-spin-slow" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-44 text-center">
            <svg viewBox="0 0 24 24" className="w-6 h-6 mb-2 text-noc-text-dim opacity-40" fill="none" stroke="currentColor" strokeWidth={1}>
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <p className="text-2xs text-noc-text-dim">
              No historical data available
            </p>
            <p className="text-2xs text-noc-text-dim mt-0.5">
              Configure an RRD datasource for this link
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
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
                  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
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
                labelStyle={{ color: "hsl(215 15% 55%)", fontSize: 10, marginBottom: 4 }}
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
        )}
      </div>
    </div>
  );
}
