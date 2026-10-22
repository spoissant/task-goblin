import { describe, it, expect } from "bun:test";
import { isAutoPaused, parseChoreSkips, setChoreSkip, toggleAutoPause } from "./chore-skips";

describe("chore skips", () => {
  it("reads empty or malformed JSON as nothing skipped", () => {
    expect(parseChoreSkips('{"ai-qa":true}')).toEqual({ "ai-qa": true });
    expect(parseChoreSkips(null)).toEqual({});
    expect(parseChoreSkips("")).toEqual({});
    expect(parseChoreSkips("{oops")).toEqual({});
  });

  it("skips a chore and clears the column once nothing is skipped", () => {
    const skipped = setChoreSkip(null, "ai-qa", true);
    expect(skipped).toBe('{"ai-qa":true}');
    expect(setChoreSkip(skipped, "fix-pr-checks", true)).toBe('{"ai-qa":true,"fix-pr-checks":true}');
    expect(setChoreSkip(skipped, "ai-qa", false)).toBe("");
  });

  it("pauses and resumes auto-starts, keeping the other skips", () => {
    const paused = toggleAutoPause('{"ai-qa":true}');
    expect(isAutoPaused(paused)).toBe(true);
    expect(parseChoreSkips(paused)["ai-qa"]).toBe(true);
    expect(toggleAutoPause(paused)).toBe('{"ai-qa":true}');
    expect(isAutoPaused("{oops")).toBe(false);
    expect(toggleAutoPause(toggleAutoPause(null))).toBe("");
  });
});
