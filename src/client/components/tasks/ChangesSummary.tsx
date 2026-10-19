import { Badge } from "@/client/components/ui/badge";
import type { ChangesByCategory } from "@/client/lib/types";

const CATEGORY_LABELS = { frontend: "FE", backend: "BE", other: "OT" } as const;

interface ChangesSummaryProps {
  changedFiles: number | null;
  additions: number | null;
  deletions: number | null;
  changesByCategory: ChangesByCategory | null;
}

/** A PR's diff size, split FE / BE / other when the file list is known, else totals. */
export function ChangesSummary({ changedFiles, additions, deletions, changesByCategory }: ChangesSummaryProps) {
  if (changesByCategory) {
    return (
      <div className="flex flex-col gap-0.5 text-xs font-mono">
        {(["frontend", "backend", "other"] as const).map((cat) => {
          const c = changesByCategory[cat];
          if (c.files === 0) return null;
          return (
            <div key={cat} className="flex items-center gap-1">
              <span className="text-muted-foreground w-5">{CATEGORY_LABELS[cat]}</span>
              <Badge variant="outline" className="text-xs px-1 py-0">{c.files}</Badge>
              <span className="text-green-600">+{c.additions}</span>
              <span className="text-red-600">-{c.deletions}</span>
            </div>
          );
        })}
      </div>
    );
  }
  if (changedFiles == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center gap-1.5 text-xs font-mono">
      <Badge variant="outline" className="text-xs px-1.5">{changedFiles}</Badge>
      <div className="flex flex-col leading-tight text-right">
        <span className="text-green-600">+{additions ?? 0}</span>
        <span className="text-red-600">-{deletions ?? 0}</span>
      </div>
    </div>
  );
}
