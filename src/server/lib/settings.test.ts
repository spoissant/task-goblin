import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { getAllSettings, getBoolSetting, getSetting, setSetting } from "./settings";

beforeAll(() => createTestTables(sqlite));

beforeEach(() => sqlite.exec("DELETE FROM settings"));

describe("settings accessors", () => {
  it("reads null for an unset key, then what was last set", async () => {
    expect(await getSetting("k")).toBeNull();
    await setSetting("k", "one");
    await setSetting("k", "two");
    expect(await getSetting("k")).toBe("two");
  });

  it("clears a value with null", async () => {
    await setSetting("k", "one");
    await setSetting("k", null);
    expect(await getSetting("k")).toBeNull();
  });

  it("lists every setting by key", async () => {
    await setSetting("a", "1");
    await setSetting("b", null);
    expect(await getAllSettings()).toEqual({ a: "1", b: null });
  });

  it("reads booleans, falling back for anything else", async () => {
    expect(await getBoolSetting("flag", true)).toBe(true);
    await setSetting("flag", "false");
    expect(await getBoolSetting("flag", true)).toBe(false);
    await setSetting("flag", "yes");
    expect(await getBoolSetting("flag", false)).toBe(false);
  });
});
