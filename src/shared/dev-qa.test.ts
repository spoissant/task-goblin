import { describe, it, expect } from "bun:test";
import { isDevQaReady } from "./dev-qa";

const ready = {
  prState: "open",
  isDraft: 0,
  checksStatus: "passing",
  unresolvedCommentCount: 0,
  hasConflicts: 0,
  onDeploymentBranches: '["staging"]',
  labelOnlyDeploymentBranches: '["staging"]',
  deployedOnBranches: '["staging"]',
};

describe("isDevQaReady", () => {
  it("is ready once a clean PR is served on its env, whatever its reviews", () => {
    expect(isDevQaReady(ready)).toBe(true);
    expect(isDevQaReady({ ...ready, labelOnlyDeploymentBranches: null, unresolvedCommentCount: null })).toBe(true);
  });

  it("is not ready until the PR is clean", () => {
    expect(isDevQaReady({ ...ready, prState: "merged" })).toBe(false);
    expect(isDevQaReady({ ...ready, isDraft: 1 })).toBe(false);
    expect(isDevQaReady({ ...ready, checksStatus: "pending" })).toBe(false);
    expect(isDevQaReady({ ...ready, unresolvedCommentCount: 2 })).toBe(false);
    expect(isDevQaReady({ ...ready, hasConflicts: 1 })).toBe(false);
  });

  it("is not ready on no env", () => {
    expect(isDevQaReady({ ...ready, onDeploymentBranches: null, labelOnlyDeploymentBranches: null, deployedOnBranches: null })).toBe(false);
  });

  it("is not ready while an env still rolls the PR out", () => {
    expect(isDevQaReady({ ...ready, deployedOnBranches: "[]" })).toBe(false);
    expect(isDevQaReady({ ...ready, onDeploymentBranches: '["staging","wip"]', labelOnlyDeploymentBranches: null })).toBe(false);
  });

  it("is not ready while an env is behind the PR", () => {
    expect(isDevQaReady({ ...ready, labelOnlyDeploymentBranches: '["staging","wip"]' })).toBe(false);
    expect(isDevQaReady({ ...ready, onDeploymentBranches: "[]", deployedOnBranches: "[]" })).toBe(false);
  });
});
