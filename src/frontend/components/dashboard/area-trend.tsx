"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/frontend/components/ui/chart";
import type { SeriesRow, SeriesSpec } from "./types";

/**
 * AreaTrend — multi-series time-series ("qué se avanzó esta semana", activity
 * per day, throughput…). Gradient area per series, brand-token coloured.
 */
export function AreaTrend({
  data,
  xKey,
  series,
  height = 220,
  formatX,
}: {
  data: SeriesRow[];
  xKey: string;
  series: SeriesSpec[];
  height?: number;
  /** Optional x-tick formatter (e.g. ISO day → "Lun"). */
  formatX?: (v: string) => string;
}) {
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  ) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0.04} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 11, fill: "var(--ink-2)" }}
          tickFormatter={formatX}
        />
        <YAxis hide />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        {series.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            type="monotone"
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#fill-${s.key})`}
            stackId={series.length > 1 ? "a" : undefined}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
