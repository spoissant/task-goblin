# Running the plan in Chrome through Haiku subagents

The planning model never clicks. It checks the browser once, while the stack boots (`tabs_context_mcp` after loading the Chrome tools; no browser connected: ask through AskUserQuestion to connect the extension), then delegates the clicking to Haiku and keeps the verdicts.

## Grouping

Group the plan items by who performs them (member, network admin, super admin), then order the groups to minimise sign-ins. One subagent per group, run strictly one after another: they share one Chrome profile, so a sign-in in one tab replaces the session of every other tab, and the stack has one database.

Right before each subagent starts, mint its sign-in with `dev_stack_login_link(taskId, as, id?)`. The link is single-use and expires after 10 minutes, so mint it at launch time, not up front. front-monorepo (Storybook) needs no sign-in.

## The subagent

`Agent` with `subagent_type: "general-purpose"`, `model: "haiku"`. It has only the brief, so the brief carries everything:

- The stack URL, the sign-in URL for this group and which role it signs in as.
- The group's plan items, numbered as in the plan, each with the expected outcome and the screens or flows involved.
- Rules: load the Chrome tools in one `ToolSearch` call, work in a new tab, open the sign-in URL first, never type a password, never trigger browser-native dialogs (alerts, confirms), and after 2–3 failed attempts at the same step give up on it and continue. Posting, uploading, saving and in-page consent prompts are fine: the local data is disposable. Read page text and console errors for every item. Close the tab when done.
- Chrome facts: console and network capture start at the first `read_console_messages` / `read_network_requests` call on a tab, so call both once the first page has loaded and reload before judging an item. `resize_window` does not change the viewport, so phone-width items load the page in a same-origin iframe of that width.
- Report format: for every item, a result (✅, ❌ or ⚠️) plus the evidence: what was on the screen, the console errors and failed requests (method, URL, status) seen, the exact steps taken. A ❌ states observed versus expected. A ⚠️ states why (missing role or data, email, third-party service, uncertain visual judgment, a browser tool that kept failing).

Wait for each report before launching the next group. A subagent that reports no browser connected ends the run.

## Keeping the verdict

The subagent reports evidence, the planning model decides. Downgrade a ✅ to ⚠️ when the evidence does not actually show the expected outcome (the item was skipped, the page described does not match the flow, or the report asserts success without saying what was seen). Keep a ❌ only when the evidence shows the mismatch; otherwise it becomes ⚠️ with the steps for a human. One re-run of a single item in a fresh subagent is fine when the first attempt looks like a tooling hiccup; more than that is looping. A few px of visual offset is not a failure: leave it out unless it hides content or breaks interaction.
