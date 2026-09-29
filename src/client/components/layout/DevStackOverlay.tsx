import { Link } from "react-router";
import { useDevStackOverviewQuery } from "@/client/lib/queries/dev-stack";
import { useTaskQuery } from "@/client/lib/queries/tasks";
import { DevStackButtons } from "@/client/components/tasks/DevStackToggle";
import { getPrUrl } from "@/client/components/tasks/columns/cells";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import type { DevStack, DevStackOwner } from "@/client/lib/types";

/**
 * Bottom-right controls for the running dev stack, on every page, so it can be
 * stopped even after its task or review request drops out of the lists.
 */
export function DevStackOverlay() {
  const { data } = useDevStackOverviewQuery();
  const stack = data?.stack;
  if (!stack) return null;

  const owner: DevStackOwner = stack.taskId !== null ? { taskId: stack.taskId } : { prUrl: stack.prUrl! };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm shadow-lg">
        <StackIdentity stack={stack} />
        <DevStackButtons owner={owner} label={stack.branch} stack={stack} />
      </div>
    </TooltipProvider>
  );
}

const linkClass = "font-medium hover:underline";

function StackIdentity({ stack }: { stack: DevStack }) {
  const { data: task } = useTaskQuery(stack.taskId ?? 0);

  if (stack.taskId === null) {
    return (
      <a href={stack.prUrl!} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {stack.branch}
      </a>
    );
  }

  const prUrl = task ? getPrUrl(task.repository, task.prNumber) : null;
  return (
    <>
      <Link to={`/tasks/${stack.taskId}`} className={linkClass}>
        {task?.jiraKey ?? `Task ${stack.taskId}`}
      </Link>
      {prUrl && (
        <a href={prUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
          #{task!.prNumber}
        </a>
      )}
    </>
  );
}
