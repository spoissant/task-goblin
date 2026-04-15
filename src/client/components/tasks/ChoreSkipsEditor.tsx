import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { useUpdateTask } from "@/client/lib/queries";
import { toast } from "sonner";

const CHORE_LABELS: Record<string, string> = {
  "assign-jira-ticket": "Assign Jira Ticket",
  "fix-pr-checks": "Fix PR checks",
  "address-pr-comments": "Address PR Comments",
  "code-review-pr": "Code review my PR",
  "request-reviews": "Request Code Reviews",
  "fix-merge-conflicts": "Fix Merge Conflicts",
  "deploy-test-env": "Deploy to Test Env",
  "dev-qa-video": "Requires Dev QA Video",
};

interface ChoreSkipsEditorProps {
  taskId: number;
  choreSkips: string | null;
}

export function ChoreSkipsEditor({ taskId, choreSkips }: ChoreSkipsEditorProps) {
  const updateTask = useUpdateTask();
  const skips: Record<string, boolean> = choreSkips ? JSON.parse(choreSkips) : {};

  const handleToggle = (choreKey: string, checked: boolean) => {
    const updated = { ...skips };
    if (checked) {
      updated[choreKey] = true;
    } else {
      delete updated[choreKey];
    }
    const json = Object.keys(updated).length > 0 ? JSON.stringify(updated) : null;
    updateTask.mutate(
      { id: taskId, choreSkips: json ?? "" },
      {
        onError: () => toast.error("Failed to update chore skips"),
      }
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Skip Goblin Chores
      </p>
      <div className="flex flex-wrap gap-4">
        {Object.entries(CHORE_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-2">
            <Checkbox
              id={`chore-skip-${key}`}
              checked={!!skips[key]}
              onCheckedChange={(checked) => handleToggle(key, !!checked)}
              disabled={updateTask.isPending}
            />
            <Label htmlFor={`chore-skip-${key}`} className="text-sm cursor-pointer">
              {label}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
