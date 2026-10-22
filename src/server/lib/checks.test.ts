import { describe, it, expect } from "bun:test";
import { checksFailedAt } from "./checks";

const check = (name: string, conclusion: string, completedAt: string | null, isRequired = true) => ({
  name,
  status: "completed",
  conclusion,
  url: null,
  isRequired,
  completedAt,
});

describe("checksFailedAt", () => {
  it("is when the latest failing check finished", () => {
    const details = [
      check("buildkite", "failure", "2026-10-22T17:30:00Z"),
      check("lint", "timed_out", "2026-10-22T17:05:00Z"),
      check("lint_title", "success", "2026-10-22T17:45:00Z"),
    ];

    expect(checksFailedAt(JSON.stringify(details))).toBe("2026-10-22T17:30:00Z");
  });

  it("ignores an advisory check failing beside required ones, and counts it when none is required", () => {
    const audit = check("audit", "failure", "2026-10-22T18:00:00Z", false);

    expect(checksFailedAt(JSON.stringify([check("buildkite", "failure", "2026-10-22T17:30:00Z"), audit]))).toBe(
      "2026-10-22T17:30:00Z",
    );
    expect(checksFailedAt(JSON.stringify([audit]))).toBe("2026-10-22T18:00:00Z");
  });

  it("is null without a failing check, a finish time or readable details", () => {
    expect(checksFailedAt(JSON.stringify([check("lint", "success", "2026-10-22T17:00:00Z")]))).toBeNull();
    expect(checksFailedAt(JSON.stringify([{ name: "old", status: "completed", conclusion: "failure", url: null }]))).toBeNull();
    expect(checksFailedAt(null)).toBeNull();
    expect(checksFailedAt("not json")).toBeNull();
  });
});
