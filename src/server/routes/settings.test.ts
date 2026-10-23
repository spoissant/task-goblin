import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { routeClient } from "../../test/request";
import { invalidateStatusConfigCache } from "../lib/task-status";
import { settingsRoutes } from "./settings";

const request = routeClient(settingsRoutes);

beforeAll(() => createTestTables(sqlite));

beforeEach(() => {
  sqlite.run("DELETE FROM settings");
  sqlite.run("DELETE FROM status_categories");
  invalidateStatusConfigCache();
});

describe("Settings key-value endpoints", () => {
  it("creates a setting with PUT, then overwrites it", async () => {
    const created = await request("PUT", "/api/v1/settings/test_key", { value: "first" });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ key: "test_key", value: "first" });

    await request("PUT", "/api/v1/settings/test_key", { value: "second" });
    const all = await (await request("GET", "/api/v1/settings")).json();
    expect(all).toEqual({ test_key: "second" });
  });

  it("clears a value with null", async () => {
    await request("PUT", "/api/v1/settings/test_key", { value: "first" });
    expect(await (await request("PUT", "/api/v1/settings/test_key", { value: null })).json()).toEqual({ key: "test_key", value: null });
    expect((await (await request("GET", "/api/v1/settings")).json()).test_key).toBeNull();
  });

  it("rejects a value that isn't a string or null", async () => {
    expect((await request("PUT", "/api/v1/settings/test_key", { value: 42 })).status).toBe(400);
  });
});

describe("Jira config", () => {
  it("lists every Jira key, null when unset", async () => {
    await request("PUT", "/api/v1/settings/jira_host", { value: "https://x.atlassian.net" });
    expect(await (await request("GET", "/api/v1/settings/jira/config")).json()).toEqual({
      jira_host: "https://x.atlassian.net",
      jira_email: null,
      jira_jql: null,
      jira_sprint_field: null,
    });
  });

  it("saves nothing when one value is invalid", async () => {
    const res = await request("PUT", "/api/v1/settings/jira/config", { jira_host: "https://x", jira_jql: 1 });
    expect(res.status).toBe(400);
    expect((await (await request("GET", "/api/v1/settings/jira/config")).json()).jira_host).toBeNull();
  });

  it("saves only the Jira keys the body sets", async () => {
    await request("PUT", "/api/v1/settings/jira_jql", { value: "project = EV" });
    const res = await request("PUT", "/api/v1/settings/jira/config", { jira_email: "me@x.com", other: "ignored" });
    expect(await res.json()).toMatchObject({ jira_email: "me@x.com", jira_jql: "project = EV" });
    expect((await (await request("GET", "/api/v1/settings")).json()).other).toBeUndefined();
  });
});

describe("Status categories", () => {
  const category = { name: " Review ", color: "bg-blue-500", done: false, displayOrder: 0, jiraMappings: ["Code Review"] };

  it("saves categories, readable from status-settings", async () => {
    const res = await request("PUT", "/api/v1/settings/status-categories", { categories: [category] });
    expect(res.status).toBe(200);
    expect((await res.json()).items).toMatchObject([{ name: "Review", jiraMappings: ["Code Review"] }]);

    const statusSettings = await (await request("GET", "/api/v1/settings/status-settings")).json();
    expect(statusSettings.categories).toMatchObject([{ name: "Review" }]);
  });

  it("rejects a malformed category", async () => {
    const res = await request("PUT", "/api/v1/settings/status-categories", { categories: [{ ...category, done: "no" }] });
    expect(res.status).toBe(400);
  });

  it("has no GET of its own", async () => {
    expect((await request("GET", "/api/v1/settings/status-categories")).status).toBe(405);
  });
});
