import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";

interface DeploymentBadgesProps {
  branches: string | null; // onDeploymentBranches (commit-detected)
  labelOnlyBranches?: string | null; // labelOnlyDeploymentBranches (label-detected)
  deployedBranches?: string | null; // deployedOnBranches (URL-confirmed)
}

export function DeploymentBadges({ branches, labelOnlyBranches, deployedBranches }: DeploymentBadgesProps) {
  const commitBranches = parseBranches(branches);
  const labelBranches = parseBranches(labelOnlyBranches);
  const deployed = parseBranches(deployedBranches);

  // Legacy mode: no URL tracking configured
  if (deployedBranches === undefined) {
    const allBranches = [...new Set([...commitBranches, ...labelBranches])];
    if (!allBranches.length) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {allBranches.map((branch) => (
          <Badge key={branch} variant="secondary" className="text-xs">
            {branch}
          </Badge>
        ))}
      </div>
    );
  }

  const allBranches = [...new Set([...commitBranches, ...labelBranches, ...deployed])];
  const visibleBranches = allBranches.filter((b) => commitBranches.includes(b) || labelBranches.includes(b));

  if (visibleBranches.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {visibleBranches.map((branch) => {
        const isMerged = commitBranches.includes(branch);
        const isDeployed = deployed.includes(branch);
        const isLabeled = labelBranches.includes(branch);

        return (
          <Badge
            key={branch}
            variant="secondary"
            className={[
              "text-xs inline-flex items-center gap-1",
              isLabeled
                ? "bg-muted text-purple-700 border border-purple-400 dark:text-purple-300 dark:border-purple-600"
                : "bg-muted text-muted-foreground",
            ].join(" ")}
          >
            {branch}
            {isMerged
              ? isDeployed
                ? <CheckCircle className="h-3 w-3 text-green-500" />
                : <Loader2 className="h-3 w-3 text-yellow-500 animate-spin" />
              : isLabeled && <XCircle className="h-3 w-3 text-red-500" />
            }
          </Badge>
        );
      })}
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
