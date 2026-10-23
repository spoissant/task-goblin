# Setting the test env up for the demo

## The demo network

| Env | Front office | Back office | Admin MCP |
| --- | --- | --- | --- |
| staging | https://briseis.staging.hvbrt.com/ | https://staging.hvbrt.com/backoffice/networks | `mcp__claude_ai_Hivebrite_MCP_Admin_Staging__*` |
| barney | https://orpheus.barney.hvbrt.com/ | https://barney.hvbrt.com/backoffice/networks | `mcp__claude_ai_Hivebrite_Admin_Mcp_barney_env__*` |

Use the network the ticket names, otherwise the env's default network above. Call `get-mcp-context` on the env's Admin MCP first and check `environment` matches the env. The staging connection is global super admin, so it can address another network when the ticket needs one. The barney connection may still need its one-time OAuth: call its `authenticate` tool, give the user the URL, and continue once they say it is done.

## Data

Reuse what exists when it fits the demo (a populated group, an event with attendees): `list-*` with filters, one page at a time. Create only what is missing, through the Admin MCP (prefer the `bulk-*` tools for several records of one kind). Titles and names start with `[dev-qa <jiraKey>]` so QA and other squads recognise them. Content created for a previous run of this task is reused, not duplicated: search for the prefix first.

Shape the data to the demo: the state that triggered the bug, the edge case the fix covers, enough items to show a list or pagination. Members needed for a member-side flow: use an existing test member the user can sign in as, or create one and say its email; never set or type passwords.

## Chrome, for what the API cannot reach

Some setup only exists in the UI (a back-office setting, a page layout, a draft in a specific state). Load the Chrome tools in one `ToolSearch` call and check the browser with `tabs_context_mcp`; no browser connected: ask through AskUserQuestion to connect the extension. The profile usually holds the user's sessions on these envs; when the needed role is signed out, ask the user to sign in in that tab. Never type a password, never trigger browser-native dialogs.

## Shared env

Other squads and QA use these envs. Do not edit or delete content you did not create. Do not send emailing campaigns, push notifications or messages to members (`send-emailing-campaign`, `notify-user`, `create-push-notification`). Do not change network settings, roles or feature flags: when the demo needs one of those, ask through AskUserQuestion first and list the change in the script's "Created on <env>" section so it can be reverted.
