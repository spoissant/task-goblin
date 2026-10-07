import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, ChartColumn, ChevronDown, ChevronRight } from "lucide-react";
import {
  aggregationFn_median,
  aggregationFn_sum,
  columnGroupingFeature,
  createColumnHelper,
  createExpandedRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  flexRender,
  rowAggregationFeature,
  rowExpandingFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
  type ExpandedState,
  type GroupingState,
  type SortingState,
} from "@tanstack/react-table";
import { useConcurrencyQuery, useSessionAnalyticsQuery } from "@/client/lib/queries/sessions";
import type { SessionAnalyticsRow } from "@/client/lib/types";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { EmptyState } from "@/client/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/client/components/ui/table";
import { formatActive, formatCost, formatTime } from "@/client/components/tasks/SessionsTable";
import { TrendChart } from "@/client/components/analytics/TrendChart";
import {
  CONCURRENCY_SERIES,
  ROLLING_DAYS,
  dayOf,
  daysAgo,
  median,
  pickSeries,
  rollingConcurrency,
  rollingMedian,
  trendSamples,
  type TrendDimension,
  type TrendMetric,
  type TrendUnit,
} from "@/client/lib/trends";
import { cn } from "@/client/lib/utils";

const DIMENSIONS = [
  { id: "task", label: "Task" },
  { id: "model", label: "Model" },
  { id: "effort", label: "Effort" },
  { id: "chore", label: "Chore" },
  { id: "repo", label: "Repo" },
] as const;

const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: null, label: "All" },
] as const;

type Metric = TrendMetric | "parallelism";

const METRICS: { id: Metric; label: string; format: (v: number | null) => string }[] = [
  { id: "cost", label: "Cost", format: formatCost },
  { id: "active", label: "Active time", format: formatActive },
  { id: "parallelism", label: "Parallelism", format: (v) => (v === null ? "—" : `${v.toFixed(1)}×`) },
];

const UNITS: { id: TrendUnit; label: string }[] = [
  { id: "session", label: "per session" },
  { id: "task", label: "per task" },
];

const NUMERIC = new Set(["sessions", "cost", "medianCost", "active", "medianActive", "turns", "subagents"]);

const features = tableFeatures({
  rowSortingFeature,
  columnGroupingFeature,
  rowAggregationFeature,
  rowExpandingFeature,
  groupedRowModel: createGroupedRowModel(),
  sortedRowModel: createSortedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
  aggregationFns: { sum: aggregationFn_sum, median: aggregationFn_median },
});

const helper = createColumnHelper<typeof features, SessionAnalyticsRow>();

const dimension = (id: (typeof DIMENSIONS)[number]["id"], header: string) =>
  helper.accessor((row) => row[id] ?? "—", { id, header });

// Leaf rows are single sessions: medians and the session count only show on group rows.
// Group rows render each column's aggregatedCell (v9's default prints the raw value).
const columns = helper.columns([
  helper.accessor((row) => row.task, {
    id: "task",
    header: "Task",
    cell: ({ row }) =>
      row.original.taskId !== null ? (
        <Link to={`/tasks/${row.original.taskId}`} className="hover:underline" title={row.original.taskTitle ?? undefined}>
          {row.original.task}
        </Link>
      ) : (
        row.original.task
      ),
  }),
  dimension("chore", "Chore"),
  dimension("model", "Model"),
  dimension("effort", "Effort"),
  dimension("repo", "Repo"),
  helper.accessor("createdAt", {
    id: "started",
    header: "Started",
    cell: ({ getValue }) => formatTime(getValue()),
  }),
  helper.accessor(() => 1, {
    id: "sessions",
    header: "Sessions",
    aggregationFn: "sum",
    cell: () => null,
    aggregatedCell: ({ getValue }) => getValue(),
  }),
  helper.accessor("costUsd", {
    id: "cost",
    header: "Cost",
    aggregationFn: "sum",
    cell: ({ getValue }) => formatCost(getValue()),
    aggregatedCell: ({ getValue }) => formatCost(getValue()),
  }),
  helper.accessor("costUsd", {
    id: "medianCost",
    header: "Median cost",
    aggregationFn: "median",
    cell: () => null,
    aggregatedCell: ({ getValue }) => formatCost((getValue() as number | undefined) ?? null),
  }),
  helper.accessor("activeMs", {
    id: "active",
    header: "Active",
    aggregationFn: "sum",
    cell: ({ getValue }) => formatActive(getValue()),
    aggregatedCell: ({ getValue }) => formatActive(getValue()),
  }),
  helper.accessor("activeMs", {
    id: "medianActive",
    header: "Median active",
    aggregationFn: "median",
    cell: () => null,
    aggregatedCell: ({ getValue }) => formatActive((getValue() as number | undefined) ?? null),
  }),
  helper.accessor("turnCount", { id: "turns", header: "Turns", aggregationFn: "sum", aggregatedCell: ({ getValue }) => getValue() }),
  helper.accessor("subagentCount", {
    id: "subagents",
    header: "Subagents",
    aggregationFn: "sum",
    aggregatedCell: ({ getValue }) => getValue(),
  }),
]);

export function AnalyticsPage() {
  const { data, isLoading, error } = useSessionAnalyticsQuery();
  const concurrency = useConcurrencyQuery();
  const [days, setDays] = useState<number | null>(30);
  const [grouping, setGrouping] = useState<GroupingState>(["task"]);
  const [sorting, setSorting] = useState<SortingState>([{ id: "cost", desc: true }]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [metric, setMetric] = useState<Metric>("cost");
  const [unit, setUnit] = useState<TrendUnit>("session");

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    if (days === null) return items;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return items.filter((s) => s.createdAt >= since);
  }, [data, days]);

  // Lines split on the first grouped dimension (never task: one line per task is noise).
  // The rolling window reads every session, so the first days of a period are full medians.
  // Parallelism is global: always the same two lines, sessions and agents.
  const trend = useMemo(() => {
    const items = data?.items ?? [];
    if (items.length === 0) return null;
    const first = dayOf(items.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b)).createdAt);
    const from = days === null ? first : [first, daysAgo(days - 1)].sort().at(-1)!;
    const to = dayOf(new Date().toISOString());
    if (metric === "parallelism") {
      return { dimension: null, series: [...CONCURRENCY_SERIES], points: rollingConcurrency(concurrency.data?.items ?? [], from, to) };
    }
    const dimension = (grouping.find((g) => g !== "task" && (unit === "session" || g === "repo")) ?? null) as TrendDimension | null;
    const { series, samples } = pickSeries(trendSamples(items, metric, unit, dimension));
    return { dimension, series, points: rollingMedian(samples, series, from, to) };
  }, [data, concurrency.data, grouping, metric, unit, days]);
  const metricDef = METRICS.find((m) => m.id === metric)!;

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { grouping, sorting, expanded },
    onGroupingChange: setGrouping,
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    autoResetExpanded: false,
  });

  const toggleGroup = (id: string) => {
    setExpanded({});
    setGrouping((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  };

  const totalCost = rows.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const totalActive = rows.reduce((sum, s) => sum + (s.activeMs ?? 0), 0);
  const medianCost = median(rows.flatMap((s) => (s.costUsd === null ? [] : [s.costUsd])));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">AI Analytics</h1>

      <div className="flex flex-wrap items-center gap-6 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Group by</span>
          {DIMENSIONS.map((d) => {
            const position = grouping.indexOf(d.id);
            return (
              <Button key={d.id} size="sm" variant={position >= 0 ? "default" : "outline"} onClick={() => toggleGroup(d.id)}>
                {position >= 0 && grouping.length > 1 && <span className="tabular-nums">{position + 1}.</span>}
                {d.label}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Period</span>
          {PERIODS.map((p) => (
            <Button key={p.label} size="sm" variant={days === p.days ? "default" : "outline"} onClick={() => setDays(p.days)}>
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p className="text-sm text-red-500">{error instanceof Error ? error.message : "Failed to load analytics"}</p>
      ) : rows.length === 0 ? (
        <EmptyState message="No AI session usage in this period" icon={ChartColumn} />
      ) : (
        <>
          {trend && (
            <div className="rounded-lg border bg-card p-4 mb-6">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div>
                  <h2 className="text-sm font-medium">
                    {metricDef.label} {metric !== "parallelism" && UNITS.find((u) => u.id === unit)!.label}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {metric === "parallelism"
                      ? `${ROLLING_DAYS}-day rolling average of sessions, and agents with sub-agents counted, making requests in the same 5-minute slot`
                      : `${ROLLING_DAYS}-day rolling median` +
                        (trend.dimension
                          ? `, one line per ${trend.dimension}`
                          : unit === "task" && grouping.some((g) => g !== "task")
                            ? "; a task spans chores and models, so only Repo splits lines"
                            : "")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-1">
                    {METRICS.map((m) => (
                      <Button key={m.id} size="sm" variant={metric === m.id ? "default" : "outline"} onClick={() => setMetric(m.id)}>
                        {m.label}
                      </Button>
                    ))}
                  </div>
                  <div className={cn("flex items-center gap-1", metric === "parallelism" && "invisible")}>
                    {UNITS.map((u) => (
                      <Button key={u.id} size="sm" variant={unit === u.id ? "default" : "outline"} onClick={() => setUnit(u.id)}>
                        {u.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <TrendChart points={trend.points} series={trend.series} format={metricDef.format} />
            </div>
          )}
          <p className="text-sm text-muted-foreground mb-3 tabular-nums">
            {rows.length} sessions · {formatCost(totalCost)} · {formatActive(totalActive)} active · median{" "}
            {formatCost(medianCost)} per session
          </p>
          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      return (
                        <TableHead
                          key={header.id}
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn("cursor-pointer select-none whitespace-nowrap", NUMERIC.has(header.column.id) && "text-right")}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" && <ArrowUp className="inline h-3 w-3 ml-1" />}
                          {sorted === "desc" && <ArrowDown className="inline h-3 w-3 ml-1" />}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className={cn(row.getIsGrouped() && "bg-muted/30")}>
                    {row.getAllCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn("text-sm whitespace-nowrap", NUMERIC.has(cell.column.id) && "text-right tabular-nums")}
                      >
                        {cell.getIsGrouped() ? (
                          <button
                            type="button"
                            onClick={row.getToggleExpandedHandler()}
                            className="inline-flex items-center gap-1 cursor-pointer font-medium"
                            style={{ paddingLeft: `${row.depth * 1.25}rem` }}
                          >
                            {row.getIsExpanded() ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            {String(cell.getValue())}
                            <span className="text-xs text-muted-foreground font-normal">({row.subRows.length})</span>
                          </button>
                        ) : cell.getIsAggregated() ? (
                          flexRender(cell.column.columnDef.aggregatedCell, cell.getContext())
                        ) : row.getIsGrouped() || cell.getIsPlaceholder() ? null : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
