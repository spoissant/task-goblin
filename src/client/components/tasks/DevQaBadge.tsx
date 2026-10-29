import type { Task } from "@/shared/types";
import { DEV_QA_CATEGORY, READY_FOR_TEST, isDevQaReady } from "@/shared/dev-qa";
import { parseStringList } from "@/shared/json";
import { findStatusCategory } from "@/client/lib/utils";
import { useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { Badge } from "@/client/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";

/**
 * Shown while a Code Review task waits on the user's dev QA (clean PR, served
 * on every env it went to), before its ticket moves to Ready for Test.
 */
export function DevQaBadge({ task }: { task: Task }) {
  const { data: statusSettings } = useStatusSettingsQuery();
  const category = findStatusCategory(task.status, statusSettings?.categories ?? []);
  if (category?.name !== DEV_QA_CATEGORY || !isDevQaReady(task)) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="secondary"
          className="text-xs whitespace-nowrap bg-muted text-blue-700 border border-blue-600 dark:text-blue-300 dark:border-blue-500"
        >
          Dev QA
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        Live on {parseStringList(task.deployedOnBranches).join(", ")} · move to {READY_FOR_TEST} once QA'd
      </TooltipContent>
    </Tooltip>
  );
}
