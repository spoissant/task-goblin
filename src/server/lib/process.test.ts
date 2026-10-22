import { describe, it, expect, afterEach } from "bun:test";
import { resetCommandRunner, runShell, setCommandRunner, type CommandOptions } from "./process";

describe("runShell", () => {
  afterEach(() => resetCommandRunner());

  it("runs the line through a login zsh, with args as positional parameters", async () => {
    const calls: { cmd: string; args: string[]; opts: CommandOptions }[] = [];
    setCommandRunner(async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await runShell("/repo", "bin/dev dc stop", { timeoutMs: 5 });
    await runShell("/repo", 'command wt "$@"', { args: ["switch", "fix/EV-1 x"] });

    expect(calls).toEqual([
      { cmd: "/bin/zsh", args: ["-lc", "bin/dev dc stop"], opts: { cwd: "/repo", timeoutMs: 5 } },
      // "zsh" fills $0, so "$@" is exactly the args.
      { cmd: "/bin/zsh", args: ["-lc", 'command wt "$@"', "zsh", "switch", "fix/EV-1 x"], opts: { cwd: "/repo" } },
    ]);
  });
});
