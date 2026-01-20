import { useDroppable } from "@dnd-kit/core";
import { DraggableJiraCard } from "./DraggableJiraCard";
import { DraggablePRCard } from "./DraggablePRCard";
import type { Task, TaskWithRepository } from "@/client/lib/types";

interface Props {
  jiraOrphans: Task[];
  prOrphans: TaskWithRepository[];
  jiraHost?: string;
  getPrUrl: (task: TaskWithRepository) => string | undefined;
}

function OrphanDropZone({
  id,
  type,
  label,
  children,
  isEmpty,
}: {
  id: string;
  type: "jira" | "pr";
  children: React.ReactNode;
  label: string;
  isEmpty: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "orphan-pool", accepts: type },
  });

  return (
    <div className="flex-1 min-w-0">
      <h3 className="text-sm font-medium mb-2">{label}</h3>
      <div
        ref={setNodeRef}
        className={`min-h-[120px] p-3 rounded-lg border border-dashed transition-colors ${
          isOver ? "border-primary bg-primary/10" : "border-muted bg-muted/30"
        }`}
      >
        {isEmpty ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No orphaned {type === "jira" ? "Jira issues" : "pull requests"}
          </p>
        ) : (
          <div className="space-y-1">{children}</div>
        )}
      </div>
    </div>
  );
}

export function OrphansPool({ jiraOrphans, prOrphans, jiraHost, getPrUrl }: Props) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <h2 className="text-lg font-semibold mb-4">Orphaned Items</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Drag a Jira task onto a PR task (or vice versa) to merge them
      </p>
      <div className="flex gap-4">
        <OrphanDropZone
          id="orphan-jira-pool"
          type="jira"
          label={`Jira Issues (${jiraOrphans.length})`}
          isEmpty={jiraOrphans.length === 0}
        >
          {jiraOrphans.map((task) => (
            <DraggableJiraCard key={task.id} task={task} isOrphan jiraHost={jiraHost} />
          ))}
        </OrphanDropZone>

        <OrphanDropZone
          id="orphan-pr-pool"
          type="pr"
          label={`Pull Requests (${prOrphans.length})`}
          isEmpty={prOrphans.length === 0}
        >
          {prOrphans.map((task) => (
            <DraggablePRCard key={task.id} task={task} isOrphan prUrl={getPrUrl(task)} />
          ))}
        </OrphanDropZone>
      </div>
    </div>
  );
}
