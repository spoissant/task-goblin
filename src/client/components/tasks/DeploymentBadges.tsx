import { Badge } from "@/client/components/ui/badge";

interface DeploymentBadgesProps {
  branches: string | null; // onDeploymentBranches
  deployedBranches?: string | null; // deployedOnBranches
}

export function DeploymentBadges({ branches, deployedBranches }: DeploymentBadgesProps) {
  const onBranches = parseBranches(branches);
  const deployed = parseBranches(deployedBranches);

  // If no deployment URL tracking, show onDeploymentBranches as solid (old behavior)
  if (deployed.length === 0 && deployedBranches === undefined) {
    if (!onBranches.length) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {onBranches.map((branch) => (
          <Badge key={branch} variant="secondary" className="text-xs">
            {branch}
          </Badge>
        ))}
      </div>
    );
  }

  // With URL tracking: solid = deployed, muted outline = merged-but-not-deployed
  const mergedOnly = onBranches.filter((b) => !deployed.includes(b));

  if (!deployed.length && !mergedOnly.length) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {deployed.map((branch) => (
        <Badge key={branch} variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
          {branch}
        </Badge>
      ))}
      {mergedOnly.map((branch) => (
        <Badge key={branch} variant="outline" className="text-xs text-muted-foreground">
          {branch}
        </Badge>
      ))}
    </div>
  );
}

function parseBranches(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
