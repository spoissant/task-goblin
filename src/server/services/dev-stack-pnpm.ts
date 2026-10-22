/**
 * A front-monorepo boot that pnpm failed on a node_modules directory in its
 * way: the dev stack removes that directory and boots once more.
 */
import { rmSync } from "fs";
import { join, relative, resolve, sep } from "path";
import { runGit } from "../lib/git";
import { expandPath } from "../lib/path";

/**
 * pnpm can't symlink a dependency where a real directory sits (e.g. a
 * package's node_modules left by an older install). Its error names the
 * symlink path; the first node_modules directory on that path, inside the
 * checkout, is what blocks it. Null when the log has no such error.
 */
export function blockingNodeModules(checkout: string, log: string): string | null {
  if (!log.includes("ERR_PNPM_PACKAGE_MANAGER_SYMLINK_FAILED")) return null;
  // pnpm wraps long paths over indented, coloured lines.
  const text = log.replace(/\u001b\[[0-9;]*m/g, "").replace(/\n */g, "");
  const at = /Failed to create symlink at "([^"]+)"/.exec(text)?.[1];
  if (!at) return null;
  const root = resolve(expandPath(checkout));
  const parts = relative(root, resolve(root, at)).split(sep);
  const i = parts.indexOf("node_modules");
  if (parts[0] === ".." || i < 0) return null;
  return join(root, ...parts.slice(0, i + 1));
}

/** Remove the untracked node_modules directory pnpm's error in the boot log names; returns it, or null when none was removed. */
export async function clearBlockingNodeModules(checkout: string, log: string): Promise<string | null> {
  const dir = blockingNodeModules(checkout, log);
  if (!dir) return null;
  const tracked = await runGit(checkout, ["ls-files", "--", dir]);
  if (tracked.exitCode !== 0 || tracked.stdout.trim() !== "") return null;
  rmSync(dir, { recursive: true, force: true });
  return dir;
}
