import { describe, expect, it } from "bun:test";
import { deployedSha, deploySignal, gateSignal, STUCK_AFTER_MS, tagSha, type BuildkiteBuild } from "./environments";

const NOW = Date.parse("2026-10-30T15:00:00Z");
const HEAD_SHA = "605b2d5488191c320db9ef81f173eb79252c5890";

const build = (over: Partial<BuildkiteBuild>): BuildkiteBuild => ({
  number: 1,
  state: "passed",
  commit: HEAD_SHA,
  message: "Merge feat/EV-4045 into staging",
  created_at: new Date(NOW - 10 * 60_000).toISOString(),
  web_url: "https://buildkite.com/hivebrite/alumni-connect/builds/1",
  ...over,
});

const finalize = (tag: string) => build({ message: `Finalizing Sentry release for version : ${tag}` });
const imageJobs = (state: string) =>
  ["build_production_images", "build_arm_production_images", "create_multiarch_images", "tag_production_images"].map((step_key) => ({ step_key, state }));

describe("tagSha", () => {
  it("reads the commit out of a version tag", () => {
    expect(tagSha("13.1.1-pre-605b2d5.staging")).toBe("605b2d5");
    expect(tagSha("Finalizing Sentry release for version : 13.2.0-pre-1349536.barney")).toBe("1349536");
    expect(tagSha("3.1.43-pre.20261030T141545.gc98184a")).toBeNull();
    expect(tagSha(undefined)).toBeNull();
  });
});

describe("deployedSha", () => {
  it("takes the newest finalize build, whatever its state", () => {
    const builds = [build({}), { ...finalize("13.1.1-pre-605b2d5.staging"), state: "failed" }, finalize("13.1.1-pre-d30b994.staging")];
    expect(deployedSha(builds)).toBe("605b2d5");
    expect(deployedSha([build({})])).toBeNull();
  });
});

describe("deploySignal", () => {
  const deployedOld = [finalize("13.1.1-pre-d30b994.staging")];

  it("is ok when the head commit is the deployed one, even on a red test build", () => {
    const head = build({ state: "failed", jobs: imageJobs("passed") });
    expect(deploySignal([finalize("13.1.1-pre-605b2d5.staging")], head, NOW)).toMatchObject({
      level: "ok",
      label: "Deployed",
      detail: "605b2d5 · Merge feat/EV-4045 into staging",
    });
  });

  it("is pending while the head build runs or the image is built and Kargo hasn't promoted yet", () => {
    expect(deploySignal(deployedOld, build({ state: "running", jobs: [] }), NOW).level).toBe("pending");
    expect(deploySignal(deployedOld, build({ state: "failed", jobs: imageJobs("passed") }), NOW).level).toBe("pending");
  });

  it("is broken when a finished head build didn't produce the image", () => {
    const signal = deploySignal(deployedOld, build({ state: "failed", jobs: [...imageJobs("passed").slice(1), { step_key: "build_production_images", state: "failed" }] }), NOW);
    expect(signal).toMatchObject({ level: "broken", label: "Image build failed" });
    expect(deploySignal(deployedOld, build({ state: "failed", jobs: [] }), NOW).label).toBe("Image build failed");
  });

  it("is broken when the head isn't deployed an hour after its build started", () => {
    const head = build({ state: "running", jobs: imageJobs("passed"), created_at: new Date(NOW - STUCK_AFTER_MS - 1).toISOString() });
    expect(deploySignal(deployedOld, head, NOW)).toMatchObject({ level: "broken", label: "Not deployed after 60 min" });
    expect(deploySignal([], head, NOW).detail).toContain("deployed: unknown");
  });

  it("is unknown without a head build", () => {
    expect(deploySignal([], null, NOW)).toMatchObject({ level: "unknown", label: "No builds" });
  });
});

describe("gateSignal", () => {
  const run = (over: Partial<BuildkiteBuild>, meta: Record<string, string>) =>
    build({ number: 16241, message: ":playwright: Running hivetests after staging promotion", meta_data: meta, ...over });
  const origins = (entries: Record<string, number>) =>
    JSON.stringify(Object.fromEntries(Object.entries(entries).map(([id, b]) => [id, { build: b, suspects: [{ author: "Americo Savinon" }] }])));

  it("skips other envs and running runs", () => {
    const runs = [
      build({ message: ":playwright: Running hivetests after barney promotion" }),
      run({ state: "running" }, {}),
      run({}, { playwright_passed: "true", playwright_deployed_tag: "13.1.1-pre-605b2d5.staging" }),
    ];
    expect(gateSignal("staging", runs, "605b2d5")).toMatchObject({ level: "ok", label: "Tests passed", detail: "on 605b2d5" });
    expect(gateSignal("wip", runs, null)).toMatchObject({ level: "unknown", label: "No gate run" });
  });

  it("is broken on failures first seen in this run, naming the suspects once", () => {
    const meta = {
      playwright_passed: "false",
      playwright_failed_tests: "64044\n63079\n60987\n",
      playwright_failure_origins: origins({ 64044: 16169, 63079: 16241, 60987: 16241 }),
      playwright_deployed_tag: "13.1.1-pre-7239665.staging",
    };
    expect(gateSignal("staging", [run({ state: "failed" }, meta)], "605b2d5")).toMatchObject({
      level: "broken",
      label: "2 new failing",
      detail: "on 7239665 (deployed: 605b2d5) · suspects: Americo Savinon",
    });
  });

  it("only warns when every failure was already red", () => {
    const meta = { playwright_passed: "false", playwright_failed_tests: "64044", playwright_failure_origins: origins({ 64044: 16169 }) };
    expect(gateSignal("staging", [run({ state: "failed" }, meta)], null)).toMatchObject({ level: "warn", label: "1 failing, none new", detail: null });
  });

  it("skips runs that published no verdict, and has none when a red run lists no failures", () => {
    const passed = run({ number: 16240 }, { playwright_passed: "true" });
    expect(gateSignal("staging", [run({ state: "failed" }, {}), run({ state: "failed", meta_data: null }, {}), passed], null).label).toBe("Tests passed");
    expect(gateSignal("staging", [run({ state: "failed" }, {})], null).label).toBe("No gate run");
    expect(gateSignal("staging", [run({ state: "failed" }, { playwright_passed: "false" })], null)).toMatchObject({ level: "unknown", label: "Inconclusive" });
    const badOrigins = { playwright_passed: "false", playwright_failed_tests: "1", playwright_failure_origins: "{" };
    expect(gateSignal("staging", [run({ state: "failed" }, badOrigins)], null).level).toBe("warn");
  });
});
