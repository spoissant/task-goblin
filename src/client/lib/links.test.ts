import { describe, it, expect } from "bun:test";
import { getJiraUrl, getPrUrl } from "./links";

describe("getJiraUrl", () => {
  it("links the key on the host, with or without scheme and trailing slash", () => {
    expect(getJiraUrl("EV-1", "hivebrite.atlassian.net")).toBe("https://hivebrite.atlassian.net/browse/EV-1");
    expect(getJiraUrl("EV-1", "https://hivebrite.atlassian.net//")).toBe("https://hivebrite.atlassian.net/browse/EV-1");
  });

  it("is null without a Jira host", () => {
    expect(getJiraUrl("EV-1", null)).toBeNull();
    expect(getJiraUrl("EV-1", "")).toBeNull();
  });
});

describe("getPrUrl", () => {
  it("links the PR on GitHub", () => {
    expect(getPrUrl({ owner: "Hivebrite", repo: "alumni_connect" }, 42)).toBe("https://github.com/Hivebrite/alumni_connect/pull/42");
  });

  it("is null without a repository or PR number", () => {
    expect(getPrUrl(null, 42)).toBeNull();
    expect(getPrUrl({ owner: "o", repo: "r" }, null)).toBeNull();
  });
});
