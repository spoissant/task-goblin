import { useCallback, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Wand2 } from "lucide-react";
import { RefreshButton } from "@/client/components/tasks/RefreshButton";
import {
  useTasksWithRelationsQuery,
  useOrphanJiraTasksQuery,
  useOrphanPrTasksQuery,
  useMergeTasks,
  useAutoMatchOrphans,
  useBatchMergeTasks,
} from "@/client/lib/queries";
import { useSettingsQuery } from "@/client/lib/queries/settings";
import { useRepositoriesQuery } from "@/client/lib/queries/repositories";
import { OrphansPool } from "@/client/components/curation/OrphansPool";
import { TaskRow } from "@/client/components/curation/TaskRow";
import { DraggableJiraCard } from "@/client/components/curation/DraggableJiraCard";
import { DraggablePRCard } from "@/client/components/curation/DraggablePRCard";
import { AutoMatchModal } from "@/client/components/curation/AutoMatchModal";
import type { Task, TaskWithRepository, AutoMatchResult } from "@/client/lib/types";

export function CurationPage() {
  const { data: linkedTasks, isLoading: tasksLoading, refetch: refetchLinked } = useTasksWithRelationsQuery();
  const { data: jiraOrphans, isLoading: jiraLoading, refetch: refetchJira } = useOrphanJiraTasksQuery();
  const { data: prOrphans, isLoading: prLoading, refetch: refetchPr } = useOrphanPrTasksQuery();
  const { data: settings } = useSettingsQuery();
  const { data: repos } = useRepositoriesQuery();

  const mergeTasks = useMergeTasks();
  const autoMatch = useAutoMatchOrphans();
  const batchMerge = useBatchMergeTasks();

  const [activeDrag, setActiveDrag] = useState<{
    type: "jira" | "pr";
    task: Task | TaskWithRepository;
  } | null>(null);

  const [autoMatchState, setAutoMatchState] = useState<{
    open: boolean;
    matches: AutoMatchResult["matches"];
  }>({ open: false, matches: [] });

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  const jiraHost = settings?.jira_host || undefined;

  // Build repo lookup for PR URLs
  const repoMap = new Map(repos?.items.map((r) => [r.id, r]) || []);

  const getPrUrl = useCallback(
    (task: TaskWithRepository): string | undefined => {
      if (!task.prNumber || !task.repositoryId) return undefined;
      const repo = task.repository || repoMap.get(task.repositoryId);
      if (!repo) return undefined;
      return `https://github.com/${repo.owner}/${repo.repo}/pull/${task.prNumber}`;
    },
    [repoMap]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current;
    if (data?.type === "jira" || data?.type === "pr") {
      setActiveDrag({ type: data.type, task: data.task });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDrag(null);

    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (!activeData || !overData) return;

    // Check if dropping Jira on PR orphan or PR on Jira orphan
    const isJiraToPr = activeData.type === "jira" && overData.type === "pr-orphan";
    const isPrToJira = activeData.type === "pr" && overData.type === "jira-orphan";

    if (isJiraToPr || isPrToJira) {
      const jiraTask = isJiraToPr ? activeData.task : overData.task;
      const prTask = isJiraToPr ? overData.task : activeData.task;

      // Merge: target is the Jira task, source is the PR task
      mergeTasks.mutate(
        { targetId: jiraTask.id, sourceId: prTask.id },
        {
          onSuccess: () => {
            toast.success(`Merged ${jiraTask.jiraKey} with PR #${prTask.prNumber}`);
          },
          onError: () => {
            toast.error("Failed to merge tasks");
          },
        }
      );
    }
  };

  const handleAutoMatch = () => {
    autoMatch.mutate(undefined, {
      onSuccess: (result) => {
        if (result.total === 0) {
          toast.info("No auto-matches found");
        } else {
          setAutoMatchState({ open: true, matches: result.matches });
        }
      },
      onError: () => toast.error("Auto-match failed"),
    });
  };

  const handleBatchMerge = (pairs: Array<{ targetId: number; sourceId: number }>) => {
    batchMerge.mutate(pairs, {
      onSuccess: (results) => {
        setAutoMatchState({ open: false, matches: [] });
        toast.success(`Merged ${results.length} task${results.length !== 1 ? "s" : ""}`);
        refetchLinked();
        refetchJira();
        refetchPr();
      },
      onError: () => toast.error("Batch merge failed"),
    });
  };

  const isLoading = tasksLoading || jiraLoading || prLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const linkedTasksList = linkedTasks?.items || [];
  const jiraOrphansList = jiraOrphans?.items || [];
  const prOrphansList = prOrphans?.items || [];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Task Curation</h1>
            <p className="text-muted-foreground">
              Merge orphan Jira issues with PRs by dragging one onto the other
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleAutoMatch}
              disabled={autoMatch.isPending}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Auto-match
            </Button>
            <RefreshButton />
          </div>
        </div>

        {/* Linked Tasks (manual + merged) */}
        <div className="border rounded-lg p-4 bg-card">
          <h2 className="text-lg font-semibold mb-4">
            Linked Tasks ({linkedTasksList.length})
          </h2>
          {linkedTasksList.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No linked tasks yet. Create manual tasks or merge orphan items below.
            </p>
          ) : (
            <div className="space-y-2">
              {linkedTasksList.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  jiraHost={jiraHost}
                  getPrUrl={getPrUrl}
                />
              ))}
            </div>
          )}
        </div>

        {/* Orphan Pools */}
        <OrphansPool
          jiraOrphans={jiraOrphansList}
          prOrphans={prOrphansList}
          jiraHost={jiraHost}
          getPrUrl={getPrUrl}
        />
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeDrag?.type === "jira" && (
          <DraggableJiraCard task={activeDrag.task} jiraHost={jiraHost} />
        )}
        {activeDrag?.type === "pr" && (
          <DraggablePRCard task={activeDrag.task as TaskWithRepository} prUrl={getPrUrl(activeDrag.task as TaskWithRepository)} />
        )}
      </DragOverlay>

      {/* Auto-Match Modal */}
      <AutoMatchModal
        open={autoMatchState.open}
        onOpenChange={(open) => setAutoMatchState((s) => ({ ...s, open }))}
        matches={autoMatchState.matches}
        jiraOrphans={jiraOrphansList}
        prOrphans={prOrphansList}
        jiraHost={jiraHost}
        onMerge={handleBatchMerge}
        isMerging={batchMerge.isPending}
      />
    </DndContext>
  );
}
