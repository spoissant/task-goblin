// Merge gate vocabulary (merge-gate.ts). The gate stores only its verdict, tasks.merge_ready.

/** Why the gate holds a Ready to Merge PR (no Merge button). */
export type HoldReason =
  | "not-ready-to-merge"
  | "draft"
  | "changes-requested"
  | "awaiting-approval"
  | "checks-pending"
  | "checks-failing"
  | "conflicts"
  | "unresolved-comments"
  | "alumni-connect-branch" // hivetests PR whose branch an alumni_connect task has: it merges with that PR
  | "prerelease-pin";
