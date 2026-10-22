import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { resetCommandRunner, setCommandRunner } from "../lib/process";
import { blockingNodeModules, clearBlockingNodeModules } from "./dev-stack-pnpm";

const MAIN = process.cwd();

// pnpm's error as it lands in the log: coloured, with long paths wrapped over indented lines.
const symlinkFailure = (path: string) =>
  "\u001b[31m ERR_PNPM_PACKAGE_MANAGER_SYMLINK_FAILED\u001b[0m\n\n  × installing dependencies\n" +
  `  ╰─▶ Failed to symlink "@types/node": Failed to create symlink at "${path.slice(0, 30)}\n\u001b[31m      \u001b[0m${path.slice(30)}" to "/elsewhere": Directory not empty (os error 66)\n`;

describe("pnpm's blocking node_modules", () => {
  const dir = `${MAIN}/logs/dev-stack-pnpm-test/node_modules`;

  afterEach(() => {
    resetCommandRunner();
    rmSync(`${MAIN}/logs/dev-stack-pnpm-test`, { recursive: true, force: true });
  });

  it("finds the node_modules directory that blocked pnpm's symlink, only inside the checkout", () => {
    const blocked = `${MAIN}/packages/tooling/tsconfig/node_modules/@types/node`;
    expect(blockingNodeModules(MAIN, symlinkFailure(blocked))).toBe(`${MAIN}/packages/tooling/tsconfig/node_modules`);
    expect(blockingNodeModules(MAIN, symlinkFailure("/tmp/other/node_modules/@types/node"))).toBeNull();
    expect(blockingNodeModules(MAIN, symlinkFailure(`${MAIN}/packages/tooling/tsconfig/src`))).toBeNull();
    expect(blockingNodeModules(MAIN, "ERR_PNPM_FROZEN_LOCKFILE")).toBeNull();
  });

  it("removes it only when git doesn't track it", async () => {
    mkdirSync(`${dir}/@types/node`, { recursive: true });
    let tracked = "logs/dev-stack-pnpm-test/node_modules/x.js";
    setCommandRunner(async () => ({ stdout: tracked, stderr: "", exitCode: 0 }));

    expect(await clearBlockingNodeModules(MAIN, symlinkFailure(`${dir}/@types/node`))).toBeNull();
    expect(existsSync(dir)).toBe(true);

    tracked = "";
    expect(await clearBlockingNodeModules(MAIN, symlinkFailure(`${dir}/@types/node`))).toBe(dir);
    expect(existsSync(dir)).toBe(false);
    expect(await clearBlockingNodeModules(MAIN, "no pnpm error")).toBeNull();
  });
});
