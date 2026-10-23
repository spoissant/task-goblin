import { describe, it, expect } from "bun:test";
import { linkJiraKeys, renderSlackEmoji } from "./standup";

describe("linkJiraKeys", () => {
  it("links bare keys and leaves markdown links untouched", () => {
    const md = "- **EV-3910** see [#38495](https://github.com/hb/ac/pull/38495) and [PS-1](https://x/PS-1), then PS-18754.";
    expect(linkJiraKeys(md, "hivebrite.atlassian.net/")).toBe(
      "- **[EV-3910](https://hivebrite.atlassian.net/browse/EV-3910)** see [#38495](https://github.com/hb/ac/pull/38495) and [PS-1](https://x/PS-1), then [PS-18754](https://hivebrite.atlassian.net/browse/PS-18754).",
    );
  });

  it("keeps the markdown as is without a Jira host", () => {
    expect(linkJiraKeys("EV-1", null)).toBe("EV-1");
  });
});

describe("renderSlackEmoji", () => {
  it("shows known shortcodes as Unicode and leaves the rest and URLs alone", () => {
    expect(renderSlackEmoji("- :white_check_mark: Done - [a](https://x/PS-1) :nerd_face: :rotating_light: :party_parrot: 10:00:00")).toBe(
      "- ✅ Done - [a](https://x/PS-1) 🤓 🚨 :party_parrot: 10:00:00",
    );
  });
});
