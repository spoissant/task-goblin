import { describe, expect, test } from "bun:test";
import type { SessionAnalyticsRow } from "../../shared/types";
import { ALL_SERIES, OTHER_SERIES, pickSeries, rollingConcurrency, rollingMedian, trendSamples } from "./trends";

function row(over: Partial<SessionAnalyticsRow>): SessionAnalyticsRow {
  return {
    id: 1,
    taskId: 1,
    task: "PS-1",
    taskTitle: null,
    chore: "Start task",
    repo: "ac",
    model: "opus-5-5",
    effort: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    costUsd: 1,
    activeMs: 60_000,
    turnCount: 1,
    subagentCount: 0,
    ...over,
  };
}

describe("trendSamples", () => {
  test("per session: one sample per priced session, split on the dimension", () => {
    const rows = [row({ costUsd: 2, chore: "A" }), row({ costUsd: null, chore: "A" }), row({ costUsd: 5, chore: "B" })];
    expect(trendSamples(rows, "cost", "session", "chore")).toEqual([
      { day: "2026-10-01", series: "A", value: 2 },
      { day: "2026-10-01", series: "B", value: 5 },
    ]);
    expect(trendSamples(rows, "cost", "session", null).map((s) => s.series)).toEqual([ALL_SERIES, ALL_SERIES]);
  });

  test("per task: cost sums the task's sessions and lands on the last session's day", () => {
    const rows = [
      row({ task: "PS-1", costUsd: 2, createdAt: "2026-10-01T10:00:00.000Z" }),
      row({ task: "PS-1", costUsd: 3, createdAt: "2026-10-03T10:00:00.000Z" }),
      row({ task: "PS-2", costUsd: 7, createdAt: "2026-10-02T10:00:00.000Z" }),
    ];
    expect(trendSamples(rows, "cost", "task", "chore")).toEqual([
      { day: "2026-10-03", series: ALL_SERIES, value: 5 },
      { day: "2026-10-02", series: ALL_SERIES, value: 7 },
    ]);
  });
});

describe("rollingConcurrency", () => {
  test("weights days by their active slots and leaves empty windows null", () => {
    const days = [
      { day: "2026-10-01", slots: 10, sessionSlots: 10, agentSlots: 10 }, // one session alone
      { day: "2026-10-02", slots: 30, sessionSlots: 90, agentSlots: 120 }, // three sessions, four agents
    ];
    const points = rollingConcurrency(days, "2026-10-01", "2026-10-09");
    expect(points[0].values).toEqual({ Sessions: 1, Agents: 1 });
    expect(points[1].values).toEqual({ Sessions: 2.5, Agents: 3.25 });
    expect(points[7].values).toEqual({ Sessions: 3, Agents: 4 }); // Oct 8 only sees Oct 2
    expect(points[8].values).toEqual({ Sessions: null, Agents: null });
  });
});

describe("pickSeries", () => {
  test("folds series past the palette into Other, keeping the most sampled", () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({ day: "2026-10-01", series: `s${i}`, value: 1 }));
    samples.push({ day: "2026-10-01", series: "s9", value: 1 });
    const picked = pickSeries(samples);
    expect(picked.series).toHaveLength(8);
    expect(picked.series[0]).toBe("s9");
    expect(picked.series.at(-1)).toBe(OTHER_SERIES);
    expect(picked.samples.filter((s) => s.series === OTHER_SERIES)).toHaveLength(3);
  });
});

describe("rollingMedian", () => {
  test("medians the trailing 7 days per series and leaves gaps null", () => {
    const samples = [
      { day: "2026-10-01", series: "A", value: 1 },
      { day: "2026-10-02", series: "A", value: 9 },
      { day: "2026-10-02", series: "A", value: 5 },
    ];
    const points = rollingMedian(samples, ["A", "B"], "2026-10-01", "2026-10-09");
    expect(points.map((p) => p.day)).toEqual([
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
    ]);
    expect(points[0].values).toEqual({ A: 1, B: null });
    expect(points[1].values.A).toBe(5);
    expect(points[6].values.A).toBe(5); // Oct 7 still sees Oct 1 and 2
    expect(points[7].values.A).toBe(7); // Oct 8 only sees Oct 2
    expect(points[8].values.A).toBeNull();
  });
});
