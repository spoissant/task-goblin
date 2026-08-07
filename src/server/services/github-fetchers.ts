/**
 * Deployment-environment probing over plain HTTP. Everything that talks to the
 * GitHub API now goes through github-graphql.ts in batched queries.
 */
export async function fetchDeployedVersions(
  deploymentUrls: Record<string, string>
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  await Promise.allSettled(
    Object.entries(deploymentUrls).map(async ([branch, url]) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, { method: "HEAD", signal: controller.signal });
        // Prefer full 40-char SHA from the link header's static asset URL
        // (e.g. https://static.hvbrt.com/v-<sha>/...) — GitHub's compare API
        // rejects abbreviated SHAs.
        const linkHeader = res.headers.get("link");
        const fullSha = linkHeader?.match(/\/v-([a-f0-9]{40})\//)?.[1];
        if (fullSha) {
          result.set(branch, fullSha);
        } else {
          const version = res.headers.get("x-app-version");
          const shortSha = version?.match(/-([a-f0-9]{7,40})\.\w+$/)?.[1];
          if (shortSha) result.set(branch, shortSha);
        }
      } catch {
        // Skip on error
      } finally {
        clearTimeout(timeout);
      }
    })
  );

  return result;
}
