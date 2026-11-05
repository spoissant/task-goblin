import { describe, it, expect } from "bun:test";
import { openBlockerKeys, parseBlockers } from "./blockers";

const done = new Set(["done", "ready to prod"]);

describe("parseBlockers", () => {
  it("reads empty and malformed values as no blockers", () => {
    expect(parseBlockers(null)).toEqual([]);
    expect(parseBlockers("nope")).toEqual([]);
    expect(parseBlockers('{"key":"A-1"}')).toEqual([]);
    expect(parseBlockers('[{"key":"A-1"},{"key":"A-2","status":"Done"}]')).toEqual([{ key: "A-2", status: "Done" }]);
  });
});

describe("openBlockerKeys", () => {
  it("keeps blockers whose status is not done, case-insensitively", () => {
    const value = JSON.stringify([
      { key: "A-1", status: "In Progress" },
      { key: "A-2", status: "Ready to Prod" },
      { key: "A-3", status: "DONE" },
    ]);
    expect(openBlockerKeys(value, done)).toEqual(["A-1"]);
  });

  it("is empty without blockers", () => {
    expect(openBlockerKeys(null, done)).toEqual([]);
  });
});
