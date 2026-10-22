// The periodic passes (sync, runtime sweep) run a list of named steps, each on
// its own: one that throws is logged and the others still run.

export type Step = [name: string, run: () => Promise<unknown>];

export interface StepFailure {
  step: string;
  message: string;
}

/** Run every step in order; returns the ones that threw, logged under `[tag]`. */
export async function runSteps(tag: string, steps: Step[]): Promise<StepFailure[]> {
  const failures: StepFailure[] = [];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${tag}] ${name} failed`, message);
      failures.push({ step: name, message });
    }
  }
  return failures;
}
