import { describe, expect, test } from "bun:test";
import { bucketFilesByCategory, parseChangesByCategory } from "./file-categories";

describe("bucketFilesByCategory", () => {
  test("splits files into FE / BE / other", () => {
    const buckets = bucketFilesByCategory([
      { filename: "app/javascript/a.tsx", additions: 3, deletions: 1 },
      { filename: "app/models/user.rb", additions: 5, deletions: 2 },
      { filename: "README.md", additions: 1, deletions: 0 },
    ]);
    expect(buckets).toEqual({
      frontend: { files: 1, additions: 3, deletions: 1 },
      backend: { files: 1, additions: 5, deletions: 2 },
      other: { files: 1, additions: 1, deletions: 0 },
    });
  });
});

describe("parseChangesByCategory", () => {
  test("round-trips stored JSON", () => {
    const buckets = bucketFilesByCategory([{ filename: "x.rb", additions: 1, deletions: 1 }]);
    expect(parseChangesByCategory(JSON.stringify(buckets))).toEqual(buckets);
  });

  test("absent or malformed is unknown", () => {
    expect(parseChangesByCategory(null)).toBeNull();
    expect(parseChangesByCategory("{")).toBeNull();
    expect(parseChangesByCategory("{}")).toBeNull();
  });
});
