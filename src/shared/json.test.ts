import { describe, expect, it } from "bun:test";
import { parseJson, parseStringList } from "./json";

describe("parseJson", () => {
  it("returns the fallback for empty or malformed values", () => {
    expect(parseJson(null, { a: 1 })).toEqual({ a: 1 });
    expect(parseJson(undefined, [])).toEqual([]);
    expect(parseJson("", 0)).toBe(0);
    expect(parseJson("{not json", "fallback")).toBe("fallback");
  });

  it("parses valid JSON", () => {
    expect(parseJson('{"fix-pr-checks":true}', {})).toEqual({ "fix-pr-checks": true });
  });
});

describe("parseStringList", () => {
  it("keeps the strings of an array", () => {
    expect(parseStringList('["alice", 3, "bob", null]')).toEqual(["alice", "bob"]);
  });

  it("reads anything else as empty", () => {
    expect(parseStringList(null)).toEqual([]);
    expect(parseStringList('{"a":1}')).toEqual([]);
    expect(parseStringList("not json")).toEqual([]);
  });
});
