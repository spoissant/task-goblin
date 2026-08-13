// Keys into the settings table that both sides touch: the server reads them,
// the Settings UI writes them. Kept in shared/ so a rename can't leave one side
// reading a key the other stopped writing.

/** JSON array of GitHub team slugs the Reviews page's Code Owners column tracks. */
export const CODEOWNER_TEAMS_SETTING = "codeowner_team_slugs";
