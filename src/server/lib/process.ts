import { expandPath } from "./path";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts: CommandOptions,
) => Promise<CommandResult>;

async function spawnRunner(cmd: string, args: string[], opts: CommandOptions): Promise<CommandResult> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: expandPath(opts.cwd),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  });

  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, opts.timeoutMs)
    : null;

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      stdout: stdout.trim(),
      stderr: timedOut ? `${stderr.trim()}\n[timed out after ${opts.timeoutMs}ms]`.trim() : stderr.trim(),
      exitCode: timedOut ? -1 : exitCode,
    };
  } catch (err) {
    return { stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: -1 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let runner: CommandRunner = spawnRunner;

/** Test seam: replace the process runner with a fake. */
export function setCommandRunner(fn: CommandRunner): void {
  runner = fn;
}

export function resetCommandRunner(): void {
  runner = spawnRunner;
}

/** Run an executable with arguments. Never throws; check exitCode. */
export function runCommand(cmd: string, args: string[], opts: CommandOptions): Promise<CommandResult> {
  return runner(cmd, args, opts);
}

/**
 * Run a shell command line through a login zsh so user tooling (yarn, pnpm,
 * bin/dev, docker) resolves via the same PATH as an interactive terminal.
 */
export function runShell(cwd: string, commandLine: string, opts: Omit<CommandOptions, "cwd"> = {}): Promise<CommandResult> {
  return runner("/bin/zsh", ["-lc", commandLine], { cwd, ...opts });
}

/** Keep the last `max` characters of combined command output for logs. */
export function tailOutput(result: CommandResult, max = 4000): string {
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return combined.length > max ? combined.slice(-max) : combined;
}
