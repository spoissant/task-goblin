/**
 * Each repository's dev stack: how it boots (STACKS), and its record, kept in
 * a settings row so it survives server restarts, next to its boot log.
 *
 * HARDCODED per repository: alumni_connect mirrors the `hbup` zsh alias and
 * the repo's bin/dev tooling; front-monorepo runs Storybook.
 */
import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getSetting, setSetting } from "../lib/settings";
import { broadcast } from "../lib/sse";
import { parsePrUrl } from "../lib/validation";
import { parseJson } from "@/shared/json";
import type { DevStackOwner, DevStackState } from "../../shared/types";

export interface StackConfig {
  /** Stays in the foreground while the stack runs. */
  boot: string;
  /** Run on stop before waiting for the boot process; null kills the process tree right away. */
  stop: string | null;
  url: string;
  /** Log line printed once the first build is served. */
  ready: RegExp;
  bootDetail: string;
  /** Runs a Docker Compose project from the main checkout; its containers are watched. */
  compose: boolean;
  fallbackBaseBranch: string;
  settingKey: string;
  logPath: string;
}

const LOG_PATH = process.env.DEV_STACK_LOG ?? "logs/dev-stack.log";

export const STACKS: Record<string, StackConfig> = {
  alumni_connect: {
    // Same chain as the `hbup` alias; `bin/dev start` stays in the foreground while the host bundler runs.
    boot: "bin/dev update-dependencies && bin/dev migration && bin/dev routes-typescript && bin/dev start",
    // Killing the bundler makes `bin/dev start` return and its EXIT trap stop the stack; `dc stop` covers the rest.
    stop: "bin/dev stop-dev-server; bin/dev dc stop",
    url: "http://localhost.hvbrt.com",
    ready: /Compiled successfully/, // Rspack dev server
    bootDetail: "Running hbup",
    compose: true,
    fallbackBaseBranch: "sprint",
    settingKey: "dev_stack",
    logPath: LOG_PATH,
  },
  "front-monorepo": {
    // No TTY, so pnpm can't ask before purging an incompatible node_modules.
    boot: "pnpm install --frozen-lockfile --config.confirmModulesPurge=false && pnpm nx run storybook:dev",
    stop: null,
    url: "http://localhost:4400",
    ready: /Storybook ready!/,
    bootDetail: "Installing packages and starting Storybook",
    compose: false,
    fallbackBaseBranch: "main",
    settingKey: "dev_stack:front-monorepo",
    logPath: LOG_PATH.replace(/(\.log)?$/, "-storybook.log"),
  },
};

export function configFor(repository: { repo: string } | null): StackConfig | null {
  return repository && Object.hasOwn(STACKS, repository.repo) ? STACKS[repository.repo] : null;
}

export interface MergedTask {
  taskId: number;
  branch: string;
}

export interface StoredStack {
  taskId: number | null;
  prUrl: string | null; // set instead of taskId for a PR
  branch: string; // task branch, or "repo#N" for a PR
  merged?: MergedTask[]; // other tasks whose branches are merged on top of the owner's
  state: DevStackState;
  pid: number | null;
  detail: string | null;
  error: string | null;
  startedAt: string;
}

export async function loadStack(cfg: StackConfig): Promise<StoredStack | null> {
  return parseJson<StoredStack | null>(await getSetting(cfg.settingKey), null);
}

/** Store the stack's record; null clears it (an empty value). */
export async function saveStack(cfg: StackConfig, stack: StoredStack | null): Promise<void> {
  await setSetting(cfg.settingKey, stack ? JSON.stringify(stack) : "");
  broadcast("dev-stack");
}

export async function readLog(cfg: StackConfig): Promise<string> {
  try {
    return await Bun.file(cfg.logPath).text();
  } catch {
    return "";
  }
}

export function appendLog(cfg: StackConfig, text: string): void {
  try {
    mkdirSync(dirname(cfg.logPath), { recursive: true });
    appendFileSync(cfg.logPath, text.endsWith("\n") ? text : `${text}\n`);
  } catch {
    // logging only
  }
}

export function ownerOf(stored: StoredStack): DevStackOwner {
  return stored.prUrl ? { prUrl: stored.prUrl } : { taskId: stored.taskId! };
}

/** The stack's owner, or one of the tasks merged on top, which count as owners too. */
export function owns(stored: StoredStack, owner: DevStackOwner): boolean {
  if ("prUrl" in owner) return stored.prUrl === parsePrUrl(owner.prUrl).url;
  return stored.taskId === owner.taskId || (stored.merged ?? []).some((m) => m.taskId === owner.taskId);
}

/** The owner's branch, plus how many more are merged on top. */
export function label(stored: StoredStack): string {
  const more = stored.merged?.length ?? 0;
  return more > 0 ? `${stored.branch} + ${more} more` : stored.branch;
}

export function sameMerged(stored: StoredStack, merged: MergedTask[]): boolean {
  const key = (list: MergedTask[]) => list.map((m) => m.taskId).sort((a, b) => a - b).join(",");
  return key(stored.merged ?? []) === key(merged);
}
