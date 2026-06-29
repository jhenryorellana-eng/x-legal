"use client";

import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/frontend/components/ui/chart";
import { chartColor } from "./format";
import type { BreakdownItem } from "./types";

/**
 * BarBreakdown — horizontal bars for a single-dimension group-by
 * (cases by status / stage / service, leads by source…). One colour per slice
 * from the brand palette; height scales with the number of slices.
 */
export function BarBreakdown({
  items,
  valueLabel = "Total",
}: {
  items: BreakdownItem[];
  valueLabel?: string;
}) {
  const data = items.map((it, i) => ({
    name: it.name,
    value: it.value,
    fill: it.color ?? chartColor(i),
  }));
  const config = { value: { label: valueLabel } } satisfies ChartConfig;
  const height = Math.max(140, data.length * 44 + 16);

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={132}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: "var(--ink-2)" }}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="value" radius={6}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
