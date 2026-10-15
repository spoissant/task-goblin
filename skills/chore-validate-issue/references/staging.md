# Reproducing on a staging env

## Pick the env

Use the env the ticket or its comments name. Otherwise use `HIVEBRITE_DEFAULT_STAGING_ENV` from `~/.hivebrite/dev.env`, and failing that, ask once through AskUserQuestion.

Each env's branch has the env's name and holds `<base>` plus the feature branches squads deployed to it. In alumni_connect, `git fetch origin <env>` then `git log --oneline --merges origin/<base>..origin/<env>` lists those branches. Note any that touch the area of the claim: they can hide or cause the symptom on that env, and a fix that sits on the env but not on `<base>` does not count as fixed. front-monorepo code is reproduced through the alumni_connect screens that use it. The env runs the package version that its alumni_connect branch pins, so check that version before judging.

| Env | Front office | Back office |
| --- | --- | --- |
| staging | https://briseis.staging.hvbrt.com/ | https://staging.hvbrt.com/backoffice/networks |
| wip | https://andromache.wip.hvbrt.com/ | https://wip.hvbrt.com/backoffice/networks |
| barney | https://orpheus.barney.hvbrt.com/ | https://barney.hvbrt.com/backoffice/networks |
| integration | https://achilles.integration.hvbrt.com/ | https://integration.hvbrt.com/backoffice/networks |
| dea | https://hercules.dea.hvbrt.com/ | https://dea.hvbrt.com/backoffice/networks |
| mobile | https://parishive.mobile.hvbrt.com/ | https://mobile.hvbrt.com/backoffice/networks |
| qa | https://automation-playwright.qa.hvbrt.com/ | https://qa.hvbrt.com/backoffice/networks |

## Staging is shared

Other squads and QA use these envs, so its data is not disposable. Reproduce with existing data where you can. Create only what the reproduction needs, with titles prefixed `[validate <jiraKey>]`. Do not edit or delete content you did not create. Do not send emailing campaigns, push notifications or messages to members. Do not change network settings, roles or feature flags. When the reproduction needs one of those, ask through AskUserQuestion first.

## Sign-in

Staging has no login links, and passwords are never typed. The Chrome profile usually holds the user's sessions on these envs. Load the Chrome tools in one `ToolSearch` call and check the browser with `tabs_context_mcp`. If no browser is connected, ask through AskUserQuestion to connect the extension. Before the first subagent, open the env's front office and back office to see who is signed in. If a needed role is signed out or missing, ask the user through AskUserQuestion to sign in in that tab, then continue.

## The subagent

The planning session never clicks. It writes the reproduction steps, each tagged with the role that performs it, and the reported and expected outcome of each step. It then delegates them to `Agent` with `subagent_type: "general-purpose"` and `model: "haiku"`: one subagent per role, strictly one after another, because they share one Chrome profile. Each brief carries:

- the env URL, the role it acts as, and the numbered steps with their reported and expected outcomes;
- the shared-data rules above;
- the rules: load the Chrome tools in one `ToolSearch` call, work in a new tab, never trigger browser-native dialogs (alerts, confirms), and give up on a step after 2–3 failed attempts. Console and network capture start at the first `read_console_messages` / `read_network_requests` call on a tab, so call both once the first page has loaded, then reload before judging a step. Close the tab when done;
- the report: for every step, what was on screen, the console errors, the failed requests (method, URL, status), the exact actions taken, and whether the reported behaviour appeared.

The planning session decides from the evidence. It counts a step as reproduced only when the evidence shows the reported behaviour. If the first run does not reproduce it, one more attempt that matches the report more closely (network, role, data shape, browser width) is worth making. A run that looks like a tooling hiccup can be retried once in a fresh subagent. Anything beyond that is looping: report what differed instead.
