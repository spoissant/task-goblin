import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { sqlite } from "../../db";
import { createTestTables } from "../../test/createSchema";
import { routeClient } from "../../test/request";
import { teamChannelRoutes } from "./team-channels";

const request = routeClient(teamChannelRoutes);

beforeAll(() => createTestTables(sqlite));

beforeEach(() => sqlite.exec("DELETE FROM team_channels"));

async function createMapping() {
  const res = await request("POST", "/api/v1/team-channels", { githubTeamSlug: " team-backend ", slackChannel: " #backend-prs " });
  expect(res.status).toBe(201);
  return res.json();
}

describe("Team channel endpoints", () => {
  it("creates a trimmed mapping", async () => {
    expect(await createMapping()).toMatchObject({ githubTeamSlug: "team-backend", slackChannel: "#backend-prs" });
  });

  it("requires both fields on create", async () => {
    expect((await request("POST", "/api/v1/team-channels", { githubTeamSlug: "team-backend" })).status).toBe(400);
  });

  it("updates one field, trimmed", async () => {
    const { id } = await createMapping();
    const res = await request("PATCH", `/api/v1/team-channels/${id}`, { slackChannel: " #new " });
    expect(await res.json()).toMatchObject({ githubTeamSlug: "team-backend", slackChannel: "#new" });
  });

  it("rejects blanking a field", async () => {
    const { id } = await createMapping();
    expect((await request("PATCH", `/api/v1/team-channels/${id}`, { githubTeamSlug: "  " })).status).toBe(400);
    expect((await request("PATCH", `/api/v1/team-channels/${id}`, { slackChannel: null })).status).toBe(400);
  });

  it("deletes a mapping, and answers 404 once it's gone", async () => {
    const { id } = await createMapping();
    expect((await request("DELETE", `/api/v1/team-channels/${id}`)).status).toBe(204);
    expect((await request("DELETE", `/api/v1/team-channels/${id}`)).status).toBe(404);
  });
});
