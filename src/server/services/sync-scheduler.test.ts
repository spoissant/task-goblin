import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import {
  SYNC_INTERVAL_MS,
  getNextSyncAt,
  restartSyncTimer,
  runAfterSyncSteps,
  startSyncScheduler,
  stopSyncScheduler,
} from "./sync-scheduler";

describe("sync scheduler", () => {
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

  it("restarts the countdown to a full interval, and stays stopped while stopped", () => {
    restartSyncTimer();
    expect(getNextSyncAt()).toBeNull();

    startSyncScheduler();
    const before = Date.now();
    restartSyncTimer();
    const next = Date.parse(getNextSyncAt() ?? "");
    expect(next - before).toBeGreaterThanOrEqual(SYNC_INTERVAL_MS);
    expect(next - Date.now()).toBeLessThanOrEqual(SYNC_INTERVAL_MS);
  });

  describe("after-sync steps", () => {
    beforeAll(() => {
      createTestTables(sqlite);
    });

    it("queues a run behind the one in progress and never rejects", async () => {
      const order: string[] = [];
      const first = runAfterSyncSteps().then(() => order.push("first"));
      const second = runAfterSyncSteps().then(() => order.push("second"));

      await Promise.all([first, second]);

      expect(order).toEqual(["first", "second"]);
    });
  });
});
