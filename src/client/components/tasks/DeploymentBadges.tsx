import { Badge } from "@/client/components/ui/badge";

interface DeploymentBadgesProps {
  branches: string | null;
}

export function DeploymentBadges({ branches }: DeploymentBadgesProps) {
  if (!branches) return <span className="text-muted-foreground">—</span>;

  try {
    const parsed: string[] = JSON.parse(branches);
    if (!parsed.length) return <span className="text-muted-foreground">—</span>;

    return (
      <div className="flex flex-wrap gap-1">
        {parsed.map((branch) => (
          <Badge key={branch} variant="secondary" className="text-xs">
            {branch}
          </Badge>
        ))}
      </div>
    );
  } catch {
    return <span className="text-muted-foreground">—</span>;
  }
}
