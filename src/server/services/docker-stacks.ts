/**
 * Docker Compose stacks of task worktrees. Stacks start lazily through the
 * repo tooling (`bin/dev dcx`); Task Goblin only stops idle ones and caps how
 * many run at once so the Docker VM keeps headroom for the main dev stack.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { claudeSessions, tasks, taskWorktrees } from "../../db/schema";
import { expandPath } from "../lib/path";
import { runCommand } from "../lib/process";

export const MAX_TASK_STACKS = 3;
const IDLE_MS = 15 * 60 * 1000;
const STOP_TIMEOUT_MS = 120_000;

export interface RunningStack {
  project: string;
  workingDir: string;
}

export interface TaskStack extends RunningStack {
  taskId: number;
}

/** Running Compose projects with their working directories; [] when Docker is down. */
export async function listRunningStacks(): Promise<RunningStack[]> {
  const result = await runCommand(
    "docker",
    ["ps", "--format", '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}'],
    { cwd: process.cwd(), timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) return [];
  const seen = new Map<string, RunningStack>();
  for (const line of result.stdout.split("\n")) {
    const [project, workingDir] = line.split("\t");
    if (project && workingDir && !seen.has(project)) seen.set(project, { project, workingDir });
  }
  return [...seen.values()];
}

/** Running stacks that belong to a task worktree (the main checkout never matches). */
export async function listRunningTaskStacks(): Promise<TaskStack[]> {
  const stacks = await listRunningStacks();
  if (stacks.length === 0) return [];
  const rows = await db.select({ taskId: taskWorktrees.taskId, path: taskWorktrees.path }).from(taskWorktrees);
  const byDir = new Map(rows.map((r) => [expandPath(r.path), r.taskId]));
  return stacks.flatMap((s) => {
    const taskId = byDir.get(s.workingDir);
    return taskId === undefined ? [] : [{ ...s, taskId }];
  });
}

/** Volumes of a Compose project (named `<project>_<volume>`); null when Docker is down. */
export async function listProjectVolumes(project: string): Promise<string[] | null> {
  const result = await runCommand("docker", ["volume", "ls", "--format", "{{.Name}}", "--filter", `name=${project}_`], {
    cwd: process.cwd(),
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) return null;
  // The name filter matches anywhere in the name: keep only this project's prefix.
  return result.stdout.split("\n").filter((name) => name.startsWith(`${project}_`));
}

export async function stopStack(project: string): Promise<boolean> {
  const result = await runCommand("docker", ["compose", "-p", project, "stop"], {
    cwd: process.cwd(),
    timeoutMs: STOP_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) console.warn(`[docker] failed to stop ${project}: ${result.stderr}`);
  return result.exitCode === 0;
}

interface Activity {
  working: boolean;
  lastActivityMs: number; // 0 when the task never had a session
}

/**
 * The tasks whose sessions count toward each stack task's activity: the task
 * itself and its sub-tasks, whose sessions may run against the parent's stack
 * (hivetests hermetic specs run in the alumni_connect parent's worktree).
 */
async function stackTasksBySession(taskIds: number[]): Promise<Map<number, number[]>> {
  const owners = new Map<number, number[]>(taskIds.map((id) => [id, [id]]));
  const parents = await db.select({ id: tasks.id, jiraKey: tasks.jiraKey }).from(tasks).where(inArray(tasks.id, taskIds));
  const parentByKey = new Map(parents.flatMap((p) => (p.jiraKey ? [[p.jiraKey, p.id] as const] : [])));
  if (parentByKey.size === 0) return owners;
  const children = await db
    .select({ id: tasks.id, parentKey: tasks.parentKey })
    .from(tasks)
    .where(inArray(tasks.parentKey, [...parentByKey.keys()]));
  for (const child of children) {
    const parentId = child.parentKey ? parentByKey.get(child.parentKey) : undefined;
    if (parentId !== undefined) owners.set(child.id, [...(owners.get(child.id) ?? []), parentId]);
  }
  return owners;
}

async function activityByTask(taskIds: number[]): Promise<Map<number, Activity>> {
  const map = new Map<number, Activity>();
  if (taskIds.length === 0) return map;
  const owners = await stackTasksBySession(taskIds);
  const rows = await db
    .select({
      taskId: claudeSessions.taskId,
      state: claudeSessions.state,
      updatedAt: claudeSessions.updatedAt,
      claudeUpdatedAt: claudeSessions.claudeUpdatedAt,
    })
    .from(claudeSessions)
    .where(inArray(claudeSessions.taskId, [...owners.keys()]));
  for (const row of rows) {
    if (row.taskId === null) continue; // unreachable: filtered by taskIds; narrows the type
    const ts = Math.max(Date.parse(row.updatedAt), row.claudeUpdatedAt ? Date.parse(row.claudeUpdatedAt) : 0);
    for (const owner of owners.get(row.taskId) ?? []) {
      const current = map.get(owner) ?? { working: false, lastActivityMs: 0 };
      map.set(owner, {
        working: current.working || row.state === "working",
        lastActivityMs: Math.max(current.lastActivityMs, Number.isNaN(ts) ? 0 : ts),
      });
    }
  }
  return map;
}

/** Stop task stacks with no working session and no activity for 15 minutes. */
export async function sweepIdleStacks(): Promise<string[]> {
  const stacks = await listRunningTaskStacks();
  if (stacks.length === 0) return [];
  const activity = await activityByTask(stacks.map((s) => s.taskId));
  const cutoff = Date.now() - IDLE_MS;
  const stopped: string[] = [];
  for (const stack of stacks) {
    const a = activity.get(stack.taskId) ?? { working: false, lastActivityMs: 0 };
    if (a.working || a.lastActivityMs > cutoff) continue;
    if (await stopStack(stack.project)) stopped.push(stack.project);
  }
  return stopped;
}

/**
 * Before spawning a session in `cwd`: keep at most MAX_TASK_STACKS task
 * stacks running. Evicts the least recently active stack that has no working
 * session; returns "queued" when every running stack is busy.
 */
export async function ensureStackCapacity(cwd: string): Promise<"ok" | "queued"> {
  const stacks = await listRunningTaskStacks();
  const target = expandPath(cwd);
  if (stacks.length < MAX_TASK_STACKS || stacks.some((s) => s.workingDir === target)) return "ok";

  const activity = await activityByTask(stacks.map((s) => s.taskId));
  const evictable = stacks
    .filter((s) => !(activity.get(s.taskId)?.working ?? false))
    .sort((a, b) => (activity.get(a.taskId)?.lastActivityMs ?? 0) - (activity.get(b.taskId)?.lastActivityMs ?? 0));
  if (evictable.length === 0) return "queued";
  await stopStack(evictable[0].project);
  return "ok";
}

/** Whether any session of the task is currently working (used by tests and the UI). */
export async function hasWorkingSession(taskId: number): Promise<boolean> {
  const rows = await db
    .select({ id: claudeSessions.id })
    .from(claudeSessions)
    .where(and(eq(claudeSessions.taskId, taskId), eq(claudeSessions.state, "working")))
    .limit(1);
  return rows.length > 0;
}
