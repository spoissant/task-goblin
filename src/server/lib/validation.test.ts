import { describe, expect, it } from "bun:test";
import { parsePrUrl } from "./validation";

describe("parsePrUrl", () => {
  it("splits a PR URL", () => {
    expect(parsePrUrl(" https://github.com/Hivebrite/alumni_connect/pull/38165 ")).toEqual({
      url: "https://github.com/Hivebrite/alumni_connect/pull/38165",
      owner: "Hivebrite",
      repo: "alumni_connect",
      number: 38165,
    });
  });

  it("takes the URL of one of the PR's pages as the PR's", () => {
    for (const page of ["/", "/files", "/files?w=1", "#discussion_r1", "?notification_referrer_id=x"]) {
      expect(parsePrUrl(`https://github.com/hb/hivetests/pull/377${page}`).url).toBe("https://github.com/hb/hivetests/pull/377");
    }
  });

  it("rejects anything else", () => {
    for (const value of ["https://github.com/hb/hivetests/issues/377", "https://github.com/hb/hivetests/pull/377x", "hb/hivetests#377", ""]) {
      expect(() => parsePrUrl(value)).toThrow(/GitHub pull request URL/);
    }
  });
});
