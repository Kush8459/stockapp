import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompact, formatCurrency } from "@/lib/utils";
import { sipSeries, type Frequency } from "@/lib/sip";

interface SipProjectionChartProps {
  amount: number;
  frequency: Frequency;
  annualRate: number;
  maxYears?: number;
  height?: number;
}

/** Stacked area chart: invested (flat line) and projected value (growing). */
export function SipProjectionChart({
  amount,
  frequency,
  annualRate,
  maxYears = 15,
  height = 170,
}: SipProjectionChartProps) {
  const data = sipSeries(amount, frequency, maxYears, annualRate);
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
          <defs>
            <linearGradient id="grad-invested" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="grad-value" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="year"
            tickFormatter={(v) => `${v}y`}
            tick={{ fill: "#5b6678", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatCompact(v).replace("₹", "")}
            tick={{ fill: "#5b6678", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "#141b26",
              border: "1px solid #1c2431",
              borderRadius: 8,
              fontSize: 12,
              padding: "6px 10px",
            }}
            labelFormatter={(y) => `Year ${y}`}
            formatter={(v: number, key: string) => [
              formatCurrency(v),
              key === "value" ? "Projected" : "Invested",
            ]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#06b6d4"
            strokeWidth={2}
            fill="url(#grad-value)"
          />
          <Area
            type="monotone"
            dataKey="invested"
            stroke="#8b5cf6"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="url(#grad-invested)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
