import { describe, expect, it } from "bun:test";
import { findStatusCategory } from "./utils";
import type { StatusCategory } from "@/shared/types";

const category = (id: number, name: string, jiraMappings: string[] = []): StatusCategory => ({
  id,
  name,
  color: "bg-slate-500",
  done: false,
  displayOrder: id,
  jiraMappings,
});

describe("findStatusCategory", () => {
  const categories = [category(1, "To Do"), category(2, "QA", ["Ready for Test", "In QA"])];

  it("matches a category's own name, ignoring case", () => {
    expect(findStatusCategory("to do", categories)?.id).toBe(1);
  });

  it("matches a Jira mapping, ignoring case", () => {
    expect(findStatusCategory("READY FOR TEST", categories)?.id).toBe(2);
  });

  it("finds nothing for an unmapped status", () => {
    expect(findStatusCategory("Blocked", categories)).toBeUndefined();
  });
});
