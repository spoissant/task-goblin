import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { SYNC_INTERVAL_MS, getNextSyncAt, startSyncScheduler, stopSyncScheduler, syncNow } from "./sync-scheduler";

describe("sync scheduler", () => {
  // Jira and GitHub stay unconfigured, so a pass never leaves the machine.
  const githubToken = process.env.GITHUB_TOKEN;

  beforeAll(() => {
    createTestTables(sqlite);
    delete process.env.GITHUB_TOKEN;
  });

  afterAll(() => {
    if (githubToken !== undefined) process.env.GITHUB_TOKEN = githubToken;
  });

  beforeEach(() => {
    for (const t of ["tasks", "settings"]) sqlite.exec(`DELETE FROM ${t}`);
  });

  afterEach(() => stopSyncScheduler());

  it("has no next sync while stopped", () => {
    expect(getNextSyncAt()).toBeNull();
  });

  it("schedules the first pass 30s after start and clears it on stop", () => {
    const before = Date.now();
    startSyncScheduler();
    const next = Date.parse(getNextSyncAt() ?? "");
    expect(next - before).toBeGreaterThanOrEqual(30_000);
    expect(next - Date.now()).toBeLessThanOrEqual(30_000);

    stopSyncScheduler();
    expect(getNextSyncAt()).toBeNull();
  });

  it("runs every step of a pass and reports the ones that failed, without throwing", async () => {
    const result = await syncNow();

    expect(result.jira).toBeNull();
    expect(result.github).toBeNull();
    expect(result.errors).toEqual([
      { step: "jira", message: "Jira host not configured. Set jira_host in settings." },
      { step: "github", message: "GitHub username not configured. Set github_username in settings." },
    ]);
  });

  it("shares the pass already running, then starts a new one", async () => {
    const [first, second] = await Promise.all([syncNow(), syncNow()]);
    expect(second).toBe(first);

    expect(await syncNow()).not.toBe(first);
  });

  it("restarts the countdown to a full interval after a pass, and stays stopped while stopped", async () => {
    await syncNow();
    expect(getNextSyncAt()).toBeNull();

    startSyncScheduler();
    const before = Date.now();
    await syncNow();
    const next = Date.parse(getNextSyncAt() ?? "");
    expect(next - before).toBeGreaterThanOrEqual(SYNC_INTERVAL_MS);
    expect(next - Date.now()).toBeLessThanOrEqual(SYNC_INTERVAL_MS);
  });
});
