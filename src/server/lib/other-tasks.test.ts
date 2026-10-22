import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { loadOtherTasks } from "./other-tasks";

describe("loadOtherTasks", () => {
  beforeAll(() => createTestTables(sqlite));

  beforeEach(() => {
    for (const t of ["tasks", "repositories"]) sqlite.exec(`DELETE FROM ${t}`);
    sqlite.exec(`INSERT INTO repositories (id, owner, repo, enabled) VALUES (1, 'hb', 'alumni_connect', 1), (2, 'hb', 'front-monorepo', 1)`);
    const ts = "'2026-01-01T00:00:00.000Z'";
    sqlite.exec(`INSERT INTO tasks (id, title, status, created_at, updated_at, repository_id)
      VALUES (1, 'a', 'In Progress', ${ts}, ${ts}, 1), (2, 'b', 'In Progress', ${ts}, ${ts}, 1), (3, 'c', 'In Progress', ${ts}, ${ts}, 2)`);
  });

  it("loads each other task once, without the run's own", async () => {
    const others = await loadOtherTasks([2, 1, 2, 3], 1);
    expect(others.map((t) => [t.id, t.repository?.repo])).toEqual([
      [2, "alumni_connect"],
      [3, "front-monorepo"],
    ]);
    expect(await loadOtherTasks(undefined, 1)).toEqual([]);
    expect(await loadOtherTasks(null, null)).toEqual([]);
  });

  it("takes only arrays of positive integer IDs", async () => {
    for (const ids of ["2", [0], [-2], [1.5], ["2"], [2, null], { 0: 2 }]) {
      await expect(loadOtherTasks(ids, 1)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("refuses a missing task, and one in another repository when the run needs one", async () => {
    await expect(loadOtherTasks([9], 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(loadOtherTasks([2, 3], 1, 1)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Task 3 is in another repository",
    });
  });
});
