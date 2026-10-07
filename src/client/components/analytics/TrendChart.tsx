import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MAX_SERIES, ROLLING_DAYS, type TrendPoint } from "@/client/lib/trends";

const SERIES_COLORS = Array.from({ length: MAX_SERIES }, (_, i) => `var(--series-${i + 1})`);
const TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | null;
  color?: string;
}

function TrendTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: string;
  format: (value: number | null) => string;
}) {
  if (!active || !payload?.length || typeof label !== "string") return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="text-muted-foreground mb-1">
        {formatDay(label)} · {ROLLING_DAYS}-day median
      </div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3 shrink-0" style={{ background: p.color }} />
          <span className="font-medium tabular-nums">{format(p.value ?? null)}</span>
          <span className="text-muted-foreground">{String(p.name)}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  points: TrendPoint[];
  series: string[];
  format: (value: number | null) => string;
}

/** Rolling-median lines, one per series, in the fixed series palette. */
export function TrendChart({ points, series, format }: Props) {
  const data = points.map((p) => ({ day: p.day, ...p.values }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="day" tickFormatter={formatDay} tick={TICK} axisLine={false} tickLine={false} minTickGap={32} />
        <YAxis tickFormatter={(v: number) => format(v)} tick={TICK} axisLine={false} tickLine={false} width={64} />
        <Tooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
          content={<TrendTooltip format={format} />}
          isAnimationActive={false}
        />
        {series.length > 1 && (
          <Legend iconType="plainline" formatter={(value: string) => <span className="text-xs text-foreground">{value}</span>} />
        )}
        {series.map((name, i) => (
          <Line
            key={name}
            type="linear"
            dataKey={name}
            stroke={SERIES_COLORS[i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
