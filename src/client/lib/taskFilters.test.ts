import { describe, it, expect } from "bun:test";
import { cycleRepo, readFilters, writeFilters } from "./taskFilters";

describe("readFilters", () => {
  it("uses the defaults on an empty URL", () => {
    expect(readFilters(new URLSearchParams())).toEqual({
      sprint: true,
      backlog: false,
      hideOnIce: true,
      showBlocked: false,
      hideParents: false,
      hideIdle: false,
      idleOnly: false,
      q: "",
      repo: [],
      notRepo: [],
      saved: [],
    });
  });

  it("reads every param", () => {
    const f = readFilters(new URLSearchParams("q=tiptap&repo=3,4&notRepo=5&sprint=0&backlog=1&hideOnIce=0&saved=a,b"));
    expect(f).toMatchObject({ q: "tiptap", repo: [3, 4], notRepo: [5], sprint: false, backlog: true, hideOnIce: false, saved: ["a", "b"] });
  });

  it("ignores bad repo ids", () => {
    expect(readFilters(new URLSearchParams("repo=abc,2,-1")).repo).toEqual([2]);
  });
});

describe("writeFilters", () => {
  it("writes only non-default values", () => {
    const p = writeFilters(new URLSearchParams(), { q: "bug", repo: [2], notRepo: [3, 4], sprint: false, backlog: true, saved: ["x", "y"] });
    expect(p.toString()).toBe("q=bug&repo=2&notRepo=3%2C4&sprint=0&backlog=1&saved=x%2Cy");
  });

  it("drops params set back to their default", () => {
    const p = writeFilters(new URLSearchParams("q=bug&repo=2&notRepo=3&sprint=0&saved=x"), {
      q: "",
      repo: [],
      notRepo: [],
      sprint: true,
      saved: [],
    });
    expect(p.toString()).toBe("");
  });

  it("turns off the other filter of an exclusive pair", () => {
    expect(writeFilters(new URLSearchParams("sprint=0&backlog=1"), { sprint: true }).toString()).toBe("");
    expect(writeFilters(new URLSearchParams(), { backlog: true }).toString()).toBe("backlog=1&sprint=0");
    expect(writeFilters(new URLSearchParams("hideIdle=1"), { idleOnly: true }).toString()).toBe("idleOnly=1");
    expect(writeFilters(new URLSearchParams("idleOnly=1"), { hideIdle: true }).toString()).toBe("hideIdle=1");
  });

  it("leaves the pair alone when a filter is turned off", () => {
    expect(writeFilters(new URLSearchParams("hideIdle=1"), { idleOnly: false }).toString()).toBe("hideIdle=1");
  });

  it("round-trips through readFilters", () => {
    const f = readFilters(writeFilters(new URLSearchParams(), { q: "a | b", hideIdle: true, saved: ["s1"] }));
    expect(f).toMatchObject({ q: "a | b", hideIdle: true, saved: ["s1"] });
  });
});

describe("cycleRepo", () => {
  it("cycles a repo off → include → exclude → off", () => {
    const include = cycleRepo({ repo: [], notRepo: [] }, 1);
    expect(include).toEqual({ repo: [1], notRepo: [] });
    const exclude = cycleRepo(include, 1);
    expect(exclude).toEqual({ repo: [], notRepo: [1] });
    expect(cycleRepo(exclude, 1)).toEqual({ repo: [], notRepo: [] });
  });

  it("leaves the other repos alone", () => {
    expect(cycleRepo({ repo: [2], notRepo: [3] }, 1)).toEqual({ repo: [2, 1], notRepo: [3] });
  });
});
