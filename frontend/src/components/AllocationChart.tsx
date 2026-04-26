import { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Sector } from "recharts";
import { formatCurrency } from "@/lib/utils";

export interface Slice {
  name: string;
  value: number;
}

const palette = ["#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899"];

export function AllocationChart({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const [active, setActive] = useState<number | null>(null);

  const activeSlice = active !== null ? data[active] : null;
  const centerLabel = activeSlice?.name ?? "Total";
  const centerValue = activeSlice?.value ?? total;
  const centerPct =
    activeSlice && total > 0 ? (activeSlice.value / total) * 100 : null;

  return (
    <div className="card flex h-full flex-col p-5">
      <div className="flex items-center justify-between">
        <span className="label">Allocation</span>
        <span className="num text-xs text-fg-muted">{data.length} positions</span>
      </div>

      <div className="mt-3 flex flex-1 items-center gap-4">
        <div className="relative h-44 w-44 shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={82}
                paddingAngle={2}
                stroke="#07090d"
                strokeWidth={2}
                activeIndex={active ?? undefined}
                activeShape={renderActiveShape}
                onMouseEnter={(_, i) => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={palette[i % palette.length]} />
                ))}
              </Pie>
              {/* Tooltip disabled on purpose — the center label reflects the
                  hovered slice instead, so nothing overlaps the donut. */}
              <Tooltip cursor={false} content={() => null} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
              {centerLabel}
            </div>
            <div className="num text-sm font-medium leading-tight">
              {formatCurrency(centerValue)}
            </div>
            {centerPct !== null && (
              <div className="num text-[11px] text-fg-muted">
                {centerPct.toFixed(1)}%
              </div>
            )}
          </div>
        </div>

        <ul className="flex-1 space-y-2 overflow-hidden">
          {data.map((d, i) => (
            <li
              key={d.name}
              className={`flex items-center justify-between gap-2 rounded-md px-1 text-sm transition-colors ${
                active === i ? "bg-white/[0.04]" : ""
              }`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <span className="flex items-center gap-2 truncate">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: palette[i % palette.length] }}
                />
                <span className="truncate">{d.name}</span>
              </span>
              <span className="num text-xs text-fg-muted">
                {((d.value / (total || 1)) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
          {data.length === 0 && (
            <li className="text-xs text-fg-muted">No positions yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// Expands the hovered slice slightly outward so the user gets visual feedback
// without overlapping the donut's center label.
function renderActiveShape(props: unknown) {
  const p = props as {
    cx: number;
    cy: number;
    innerRadius: number;
    outerRadius: number;
    startAngle: number;
    endAngle: number;
    fill: string;
  };
  return (
    <Sector
      cx={p.cx}
      cy={p.cy}
      innerRadius={p.innerRadius}
      outerRadius={p.outerRadius + 4}
      startAngle={p.startAngle}
      endAngle={p.endAngle}
      fill={p.fill}
    />
  );
}
