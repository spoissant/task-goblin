import { Play } from "lucide-react";
import { toast } from "sonner";
import type { Task } from "@/shared/types";
import { DEV_QA_CATEGORY, READY_FOR_TEST, isDevQaReady } from "@/shared/dev-qa";
import { parseStringList } from "@/shared/json";
import { findStatusCategory } from "@/client/lib/utils";
import { useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { useMoveToReadyForTest } from "@/client/lib/queries/tasks";
import { Button } from "@/client/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";

/**
 * Shown while a Code Review task waits on the user's dev QA (clean PR, served
 * on every env it went to): moves its ticket to Ready for Test.
 */
export function DevQaButton({ task }: { task: Task }) {
  const { data: statusSettings } = useStatusSettingsQuery();
  const move = useMoveToReadyForTest();
  const category = findStatusCategory(task.status, statusSettings?.categories ?? []);
  if (category?.name !== DEV_QA_CATEGORY || !isDevQaReady(task)) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          className="h-6 px-2 text-xs gap-1 bg-green-600 text-white hover:bg-green-700"
          disabled={move.isPending}
          onClick={(e) => {
            e.stopPropagation();
            move.mutate(task.id, {
              onSuccess: () => toast.success(`Moved ${task.jiraKey ?? `task ${task.id}`} to ${READY_FOR_TEST}`),
              onError: (err) => toast.error(err.message),
            });
          }}
        >
          <Play className="h-3 w-3" />
          Dev QA
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Live on {parseStringList(task.deployedOnBranches).join(", ")} · click once QA'd to move to {READY_FOR_TEST}
      </TooltipContent>
    </Tooltip>
  );
}
