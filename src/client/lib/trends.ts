/**
 * Trend math for the analytics page: one sample per session (or per task),
 * then a rolling median per series for every day of the viewed period; a
 * rolling average per day (daily totals, or sessions started); and a rolling
 * average of session and agent parallelism.
 *
 * Medians, not means: session cost is heavy-tailed and one big session would
 * swing a daily mean. Samples are dated by when the work ended, so a task's
 * cost lands on the day of its last session.
 */
import type { ConcurrencyDay, SessionAnalyticsRow } from "./types";

export type TrendMetric = "cost" | "active";
/** "day" samples per session too: the daily average sums them. */
export type TrendUnit = "session" | "task" | "day";
/** Dimensions a line can be split on. Tasks live in one repo, so per-task series only split on repo. */
export type TrendDimension = "model" | "effort" | "chore" | "repo";

export interface TrendSample {
  day: string; // YYYY-MM-DD, UTC
  series: string;
  value: number;
}

export interface TrendPoint {
  day: string;
  values: Record<string, number | null>; // null when the window holds no sample
}

export const ROLLING_DAYS = 7;
export const ALL_SERIES = "All";
export const OTHER_SERIES = "Other";
/** Lines beyond this fold into "Other": the series palette has 8 fixed slots and never cycles. */
export const MAX_SERIES = 8;
const DAY_MS = 86_400_000;

export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function daysAgo(days: number, now = Date.now()): string {
  return dayOf(new Date(now - days * DAY_MS).toISOString());
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sessionValue(row: SessionAnalyticsRow, metric: TrendMetric): number | null {
  return metric === "cost" ? row.costUsd : row.activeMs;
}

/** Sum of the known values; null when none is known. */
function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}


export function trendSamples(
  rows: SessionAnalyticsRow[],
  metric: TrendMetric,
  unit: TrendUnit,
  dimension: TrendDimension | null,
): TrendSample[] {
  if (unit !== "task") {
    return rows.flatMap((r) => {
      const value = sessionValue(r, metric);
      if (value === null) return [];
      return [{ day: dayOf(r.createdAt), series: dimension ? (r[dimension] ?? "—") : ALL_SERIES, value }];
    });
  }

  const byTask = new Map<string, SessionAnalyticsRow[]>();
  for (const r of rows) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r]);
  return [...byTask.values()].flatMap((sessions) => {
    const value = sumKnown(sessions.map((s) => sessionValue(s, metric)));
    if (value === null) return [];
    const last = sessions.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
    return [{ day: dayOf(last.createdAt), series: dimension === "repo" ? (last.repo ?? "—") : ALL_SERIES, value }];
  });
}

/** The series to draw, most sampled first; the tail beyond the palette folds into "Other". */
export function pickSeries(samples: TrendSample[]): { series: string[]; samples: TrendSample[] } {
  const counts = new Map<string, number>();
  for (const s of samples) counts.set(s.series, (counts.get(s.series) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  if (ranked.length <= MAX_SERIES) return { series: ranked, samples };
  const kept = new Set(ranked.slice(0, MAX_SERIES - 1));
  return {
    series: [...kept, OTHER_SERIES],
    samples: samples.map((s) => (kept.has(s.series) ? s : { ...s, series: OTHER_SERIES })),
  };
}

/** Rolling median per series for every day from `from` to `to` inclusive (both YYYY-MM-DD). */
export function rollingMedian(samples: TrendSample[], series: string[], from: string, to: string): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) {
    const day = dayOf(new Date(t).toISOString());
    const windowStart = dayOf(new Date(t - (ROLLING_DAYS - 1) * DAY_MS).toISOString());
    const values: Record<string, number | null> = {};
    for (const name of series) {
      values[name] = median(samples.filter((s) => s.series === name && s.day >= windowStart && s.day <= day).map((s) => s.value));
    }
    points.push({ day, values });
  }
  return points;
}

/** One sample per session started, for counting. */
export function countSamples(rows: SessionAnalyticsRow[], dimension: TrendDimension | null): TrendSample[] {
  return rows.map((r) => ({ day: dayOf(r.createdAt), series: dimension ? (r[dimension] ?? "—") : ALL_SERIES, value: 1 }));
}

/**
 * Daily total per series (a count when every sample is 1), averaged over the
 * trailing window. The window never reaches before `first` (the first
 * session's day), so the opening days aren't diluted by days with no data yet.
 */
export function rollingDailyAverage(samples: TrendSample[], series: string[], from: string, to: string, first: string): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) {
    const day = dayOf(new Date(t).toISOString());
    const windowStart = [first, dayOf(new Date(t - (ROLLING_DAYS - 1) * DAY_MS).toISOString())].sort().at(-1)!;
    const windowDays = (t - Date.parse(windowStart)) / DAY_MS + 1;
    const values: Record<string, number | null> = {};
    for (const name of series) {
      const inWindow = samples.filter((s) => s.series === name && s.day >= windowStart && s.day <= day);
      values[name] = inWindow.reduce((sum, s) => sum + s.value, 0) / windowDays;
    }
    points.push({ day, values });
  }
  return points;
}

export const CONCURRENCY_SERIES = ["Sessions", "Agents"] as const;

/**
 * Average sessions and agents working at once, over the trailing window: the
 * (slot, session) and (slot, agent) pairs divided by the active slots, so a
 * busy day weighs more than one with a single short session.
 */
export function rollingConcurrency(days: ConcurrencyDay[], from: string, to: string): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) {
    const day = dayOf(new Date(t).toISOString());
    const windowStart = dayOf(new Date(t - (ROLLING_DAYS - 1) * DAY_MS).toISOString());
    const inWindow = days.filter((d) => d.day >= windowStart && d.day <= day);
    const slots = inWindow.reduce((sum, d) => sum + d.slots, 0);
    const ratio = (key: "sessionSlots" | "agentSlots") => (slots === 0 ? null : inWindow.reduce((sum, d) => sum + d[key], 0) / slots);
    points.push({ day, values: { Sessions: ratio("sessionSlots"), Agents: ratio("agentSlots") } });
  }
  return points;
}
