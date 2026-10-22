import { describe, it, expect } from "bun:test";
import { mapChecks, type GqlCheckRun, type GqlStatusContext } from "./github-graphql";

const run = (overrides: Partial<GqlCheckRun> = {}): GqlCheckRun => ({
  name: "lint",
  status: "COMPLETED",
  conclusion: "FAILURE",
  detailsUrl: null,
  startedAt: "2026-10-22T17:00:00Z",
  completedAt: "2026-10-22T17:05:00Z",
  databaseId: 1,
  isRequired: true,
  ...overrides,
});

const status = (overrides: Partial<GqlStatusContext> = {}): GqlStatusContext => ({
  context: "buildkite/alumni-connect",
  state: "FAILURE",
  targetUrl: null,
  createdAt: "2026-10-22T17:30:00Z",
  isRequired: true,
  ...overrides,
});

describe("mapChecks", () => {
  it("records when each check finished: a run's completion, a final status's post", () => {
    const { checksStatus, checksDetails } = mapChecks({
      checkRuns: [run()],
      statusContexts: [status(), status({ context: "hivetests-companion", state: "PENDING", createdAt: "2026-10-22T17:31:00Z" })],
    });

    expect(checksStatus).toBe("failing");
    const details: { name: string; completedAt: string | null }[] = JSON.parse(checksDetails!);
    expect(details.map((d) => [d.name, d.completedAt])).toEqual([
      ["buildkite/alumni-connect", "2026-10-22T17:30:00Z"],
      ["hivetests-companion", null],
      ["lint", "2026-10-22T17:05:00Z"],
    ]);
  });
});
