import { describe, expect, it } from "bun:test";
import { AppError } from "./errors";
import { GitHubError, toGitHubError } from "./github-client";

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

describe("toGitHubError", () => {
  it("answers a refused token with 401", () => {
    expect(toGitHubError(apiError(401, "Bad credentials"), "failed")).toMatchObject({
      statusCode: 401,
      code: "GITHUB_AUTH_FAILED",
      message: "GitHub authentication failed. Check your GITHUB_TOKEN.",
    });
  });

  it("answers a 404 with 404, naming what is missing when told", () => {
    expect(toGitHubError(apiError(404, "Not Found"), "failed", "PR #3 not found")).toMatchObject({ statusCode: 404, message: "PR #3 not found" });
    expect(toGitHubError(apiError(404, "Not Found"), "failed")).toMatchObject({ statusCode: 404, message: "Not Found" });
  });

  it("answers anything else with 502 and GitHub's message, or the fallback", () => {
    expect(toGitHubError(apiError(403, "API rate limit exceeded"), "failed")).toMatchObject({ statusCode: 502, message: "API rate limit exceeded" });
    expect(toGitHubError("boom", "failed")).toMatchObject({ statusCode: 502, message: "failed" });
  });

  it("passes an error already classified through", () => {
    const err = new GitHubError("GITHUB_TOKEN environment variable not set.", 400, "GITHUB_NOT_CONFIGURED");
    expect(toGitHubError(err, "failed")).toBe(err);
    expect(err).toBeInstanceOf(AppError);
  });
});
