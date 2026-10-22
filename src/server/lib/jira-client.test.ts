import { describe, expect, it } from "bun:test";
import { JiraError, toJiraError } from "./jira-client";

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

describe("toJiraError", () => {
  it("answers refused credentials (401 or 403) with 401", () => {
    for (const status of [401, 403]) {
      expect(toJiraError(apiError(status, "Unauthorized"), "failed")).toMatchObject({ statusCode: 401, code: "JIRA_AUTH_FAILED" });
    }
  });

  it("answers a missing issue with 404", () => {
    expect(toJiraError(apiError(404, "Issue does not exist"), "failed", "Issue EV-1 not found in Jira")).toMatchObject({
      statusCode: 404,
      message: "Issue EV-1 not found in Jira",
    });
  });

  it("answers anything else with 502 and Jira's message, or the fallback", () => {
    expect(toJiraError(apiError(500, "Jira is down"), "failed")).toMatchObject({ statusCode: 502, message: "Jira is down" });
    expect(toJiraError(null, "failed")).toMatchObject({ statusCode: 502, message: "failed" });
  });

  it("passes an error already classified through", () => {
    const err = new JiraError("Jira host not configured.", 400, "JIRA_NOT_CONFIGURED");
    expect(toJiraError(err, "failed")).toBe(err);
  });
});
