import { describe, it, expect } from "bun:test";
import { extractBlockedBy } from "./jira-sync";

describe("extractBlockedBy", () => {
  it("keeps only the issues this one is blocked by", () => {
    const fields = {
      issuelinks: [
        { type: { name: "Blocks" }, inwardIssue: { key: "EV-1", fields: { status: { name: "In Progress" } } } },
        { type: { name: "Blocks" }, outwardIssue: { key: "EV-2", fields: { status: { name: "To Do" } } } },
        { type: { name: "Relates" }, inwardIssue: { key: "EV-3", fields: { status: { name: "Done" } } } },
      ],
    };

    expect(JSON.parse(extractBlockedBy(fields)!)).toEqual([{ key: "EV-1", status: "In Progress" }]);
  });

  it("is null without blocking links", () => {
    expect(extractBlockedBy({})).toBeNull();
    expect(extractBlockedBy({ issuelinks: [] })).toBeNull();
  });
});
