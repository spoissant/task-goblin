/**
 * Status of the alumni_connect environments QA validates on, from Buildkite
 * alone. Two signals per environment, read independently:
 * - deploy: is the head of the env branch running there? The alumni-connect
 *   pipeline posts a "Finalizing Sentry release for version : <tag>" build once
 *   Kargo has promoted a version, so the newest one names what is deployed.
 *   Test steps fail on env branches without blocking the deploy; only the
 *   production image steps matter.
 * - gate: the newest finished Playwright run in hivetests "after <env> promotion",
 *   red only when it found failures that weren't already red before.
 */
import { AppError } from "../lib/errors";
import type { EnvironmentStatus, EnvSignal } from "@/shared/types";

export const ENVIRONMENTS = ["staging", "barney"];

const API = "https://api.buildkite.com/v2/organizations/hivebrite/pipelines";
const SENTRY_PREFIX = "Finalizing Sentry release for version";
const IMAGE_STEPS = new Set(["build_production_images", "build_arm_production_images", "create_multiarch_images", "tag_production_images"]);
const RUNNING_STATES = new Set(["creating", "scheduled", "running", "blocked", "canceling", "failing"]);
export const STUCK_AFTER_MS = 60 * 60_000;

export interface BuildkiteBuild {
  number: number;
  state: string;
  commit: string;
  message: string;
  created_at: string;
  web_url: string;
  meta_data?: Record<string, string> | null;
  jobs?: { step_key?: string | null; state?: string | null }[];
}

interface FailureOrigin {
  build: number;
  suspects?: { author: string }[];
}

const signal = (level: EnvSignal["level"], label: string, detail: string | null = null, url: string | null = null): EnvSignal => ({
  level,
  label,
  detail,
  url,
});

const firstLine = (message: string) => message.split("\n")[0];
const shortSha = (sha: string) => sha.slice(0, 7);

/** The commit a version tag like `13.1.1-pre-605b2d5.staging` was built from. */
export function tagSha(tag: string | undefined): string | null {
  return tag?.match(/-pre-([0-9a-f]{7,40})\./)?.[1] ?? null;
}

/** The short sha deployed on the env, from the newest Sentry finalize build (newest first). */
export function deployedSha(builds: BuildkiteBuild[]): string | null {
  const finalize = builds.find((b) => b.message.startsWith(SENTRY_PREFIX));
  return finalize ? tagSha(finalize.message) : null;
}

/** builds: the env branch's builds, newest first; head: the newest non-finalize one, with jobs. */
export function deploySignal(builds: BuildkiteBuild[], head: BuildkiteBuild | null, now: number): EnvSignal {
  if (!head) return signal("unknown", "No builds");
  const sha = deployedSha(builds);
  const detail = `${shortSha(head.commit)} · ${firstLine(head.message)}`;
  if (sha && head.commit.startsWith(sha)) return signal("ok", "Deployed", detail, head.web_url);

  const imageJobs = (head.jobs ?? []).filter((j) => j.step_key && IMAGE_STEPS.has(j.step_key));
  const imageBuilt = imageJobs.length > 0 && imageJobs.every((j) => j.state === "passed");
  if (!RUNNING_STATES.has(head.state) && !imageBuilt) return signal("broken", "Image build failed", detail, head.web_url);
  if (now - Date.parse(head.created_at) > STUCK_AFTER_MS) {
    return signal("broken", "Not deployed after 60 min", `${detail} · deployed: ${sha ?? "unknown"}`, head.web_url);
  }
  return signal("pending", "Deploying", detail, head.web_url);
}

/** gateRuns: hivetests builds, newest first, any env. Runs without a verdict (CI broke before testing) are skipped. */
export function gateSignal(env: string, gateRuns: BuildkiteBuild[], deployed: string | null): EnvSignal {
  const run = gateRuns.find(
    (b) => b.message.includes(`after ${env} promotion`) && !RUNNING_STATES.has(b.state) && b.meta_data?.playwright_passed != null,
  );
  if (!run) return signal("unknown", "No gate run");
  const meta = run.meta_data ?? {};
  const tested = tagSha(meta.playwright_deployed_tag);
  const on = tested ? `on ${tested}${deployed && tested !== deployed ? ` (deployed: ${deployed})` : ""}` : null;
  const url = meta.playwright_build_url ?? run.web_url;

  if (meta.playwright_passed === "true" && run.state === "passed") return signal("ok", "Tests passed", on, url);
  const failed = (meta.playwright_failed_tests ?? "").split("\n").filter(Boolean);
  if (meta.playwright_passed !== "false" || failed.length === 0) return signal("unknown", "Inconclusive", on, url);

  const origins = Object.values(parseOrigins(meta.playwright_failure_origins));
  const fresh = origins.filter((o) => o.build === run.number);
  if (fresh.length === 0) return signal("warn", `${failed.length} failing, none new`, on, url);
  const suspects = [...new Set(fresh.flatMap((o) => o.suspects ?? []).map((s) => s.author))];
  const blame = suspects.length > 0 ? `suspects: ${suspects.join(", ")}` : null;
  return signal("broken", `${fresh.length} new failing`, [on, blame].filter(Boolean).join(" · "), url);
}

function parseOrigins(raw: string | undefined): Record<string, FailureOrigin> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, FailureOrigin>) : {};
  } catch {
    return {};
  }
}

async function buildkite<T>(path: string): Promise<T> {
  const token = process.env.BUILDKITE_API_TOKEN;
  if (!token) throw new AppError("BUILDKITE_API_TOKEN environment variable not set.", 400, "BUILDKITE_NOT_CONFIGURED");
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new AppError("Buildkite refused BUILDKITE_API_TOKEN (expired?).", 401, "BUILDKITE_AUTH_FAILED");
  if (!res.ok) throw new AppError(`Buildkite answered ${res.status} for ${path}`, 502, "BUILDKITE_API_ERROR");
  return (await res.json()) as T;
}

async function environmentStatus(env: string, gateRuns: BuildkiteBuild[]): Promise<EnvironmentStatus> {
  const builds = await buildkite<BuildkiteBuild[]>(`/alumni-connect/builds?branch=${env}&per_page=30&exclude_jobs=true`);
  const latest = builds.find((b) => !b.message.startsWith(SENTRY_PREFIX));
  const head = latest ? await buildkite<BuildkiteBuild>(`/alumni-connect/builds/${latest.number}`) : null;
  return {
    name: env,
    deploy: deploySignal(builds, head, Date.now()),
    gate: gateSignal(env, gateRuns, deployedSha(builds)),
  };
}

export async function getEnvironmentStatuses(): Promise<EnvironmentStatus[]> {
  const gateRuns = await buildkite<BuildkiteBuild[]>("/hivetests/builds?per_page=100&exclude_jobs=true");
  return Promise.all(ENVIRONMENTS.map((env) => environmentStatus(env, gateRuns)));
}
