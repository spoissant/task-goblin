import { describe, it, expect, beforeAll } from "bun:test";
import { sqlite } from "../db";
import { createTestTables } from "./createSchema";

beforeAll(() => createTestTables(sqlite));

describe("createTestTables", () => {
  it("creates the schema's indexes and foreign keys", () => {
    const indexes = sqlite.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'claude_sessions'").all();
    expect(indexes).toContainEqual({ name: "idx_claude_sessions_task_id" });

    const foreignKeys = sqlite.query("SELECT \"table\", on_delete FROM pragma_foreign_key_list('task_worktrees')").all();
    expect(foreignKeys).toContainEqual({ table: "tasks", on_delete: "CASCADE" });
  });

  it("can run again on a database that has the tables", () => {
    expect(() => createTestTables(sqlite)).not.toThrow();
  });
});
