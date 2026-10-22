import { describe, it, expect } from "bun:test";
import { readFilters, writeFilters } from "./taskFilters";

describe("readFilters", () => {
  it("uses the defaults on an empty URL", () => {
    expect(readFilters(new URLSearchParams())).toEqual({
      sprint: true,
      backlog: false,
      hideOnIce: true,
      hideParents: false,
      hideIdle: false,
      idleOnly: false,
      q: "",
      repo: null,
      saved: [],
    });
  });

  it("reads every param", () => {
    const f = readFilters(new URLSearchParams("q=tiptap&repo=3&sprint=0&backlog=1&hideOnIce=0&saved=a,b"));
    expect(f).toMatchObject({ q: "tiptap", repo: 3, sprint: false, backlog: true, hideOnIce: false, saved: ["a", "b"] });
  });

  it("ignores a bad repo id", () => {
    expect(readFilters(new URLSearchParams("repo=abc")).repo).toBeNull();
  });
});

describe("writeFilters", () => {
  it("writes only non-default values", () => {
    const p = writeFilters(new URLSearchParams(), { q: "bug", repo: 2, sprint: false, backlog: true, saved: ["x", "y"] });
    expect(p.toString()).toBe("q=bug&repo=2&sprint=0&backlog=1&saved=x%2Cy");
  });

  it("drops params set back to their default", () => {
    const p = writeFilters(new URLSearchParams("q=bug&repo=2&sprint=0&saved=x"), { q: "", repo: null, sprint: true, saved: [] });
    expect(p.toString()).toBe("");
  });

  it("round-trips through readFilters", () => {
    const f = readFilters(writeFilters(new URLSearchParams(), { q: "a | b", hideIdle: true, saved: ["s1"] }));
    expect(f).toMatchObject({ q: "a | b", hideIdle: true, saved: ["s1"] });
  });
});
