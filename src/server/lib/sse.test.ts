import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { addClient, removeClient, autoBroadcast } from "./sse";

const sent: string[] = [];
const controller = {
  enqueue: (chunk: Uint8Array) => sent.push(new TextDecoder().decode(chunk)),
} as unknown as ReadableStreamDefaultController;
let client: ReturnType<typeof addClient>;

beforeAll(() => {
  client = addClient(controller);
});

afterAll(() => removeClient(client));

/** The entity a successful mutation of `pathname` broadcasts, or null when it broadcasts nothing. */
function entityFor(pathname: string): string | null {
  sent.length = 0;
  autoBroadcast(pathname);
  return sent.length === 0 ? null : JSON.parse(sent[0].replace(/^data: /, "")).entity;
}

describe("autoBroadcast", () => {
  it("refreshes tasks after a full sync or a single-task sync", () => {
    expect(entityFor("/api/v1/sync")).toBe("task");
    expect(entityFor("/api/v1/tasks/12/sync")).toBe("task");
  });

  it("maps the other mutations to the entity the client invalidates", () => {
    expect(entityFor("/api/v1/tasks/12")).toBe("task");
    expect(entityFor("/api/v1/settings/jira/config")).toBe("setting");
    expect(entityFor("/api/v1/tasks/12/sessions")).toBe("session");
    expect(entityFor("/api/v1/tasks/12/dev-stack")).toBe("dev-stack");
    expect(entityFor("/api/v1/tasks/12/worktree/push")).toBe("worktree");
  });

  it("broadcasts nothing for routes whose page refetches itself", () => {
    expect(entityFor("/api/v1/repositories/3")).toBeNull();
    expect(entityFor("/api/v1/team-channels")).toBeNull();
  });
});
