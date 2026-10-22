// Keys into the settings table that both sides touch: the server reads them,
// the Settings UI writes them. Kept in shared/ so a rename can't leave one side
// reading a key the other stopped writing.

/** JSON array of GitHub team slugs the Reviews page's Code Owners column tracks. */
export const CODEOWNER_TEAMS_SETTING = "codeowner_team_slugs";

/** "false" stops the chore scheduler from starting chores on its own (the Tasks page's play/stop toggle). */
export const AUTO_CHORES_SETTING = "auto_chores_enabled";

/** Whose PRs sync as tasks and whose review requests the Reviews page lists. */
export const GITHUB_USERNAME_SETTING = "github_username";

/** JSON arrays of GitHub logins the Reviews page groups review requests by. */
export const TEAM_MEMBERS_SETTING = "team_members";
export const VIP_MEMBERS_SETTING = "vip_members";
export const IGNORED_MEMBERS_SETTING = "ignored_members";

/** JSON array of the Reviews page's PR keys flagged high priority. */
export const HIGH_PRIORITY_PRS_SETTING = "high_priority_prs";
