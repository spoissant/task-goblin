import { Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { useBootDevStack, useDevStackOverviewQuery, useStopDevStack } from "@/client/lib/queries/dev-stack";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import type { Task } from "@/client/lib/types";

interface DevStackToggleProps {
  task: Pick<Task, "id" | "repositoryId" | "headBranch">;
}

/**
 * Play/stop for the single local dev stack, shown next to the repo badge.
 * Play detaches the main checkout at the task branch and runs the stack;
 * stop tears it down and returns to the base branch. Hidden for repositories
 * without dev stack support (see server/services/dev-stack.ts).
 */
export function DevStackToggle({ task }: DevStackToggleProps) {
  const { data } = useDevStackOverviewQuery();
  const boot = useBootDevStack();
  const stop = useStopDevStack();

  if (!data || task.repositoryId === null || !task.headBranch) return null;
  if (!data.supportedRepositoryIds.includes(task.repositoryId)) return null;

  const stack = data.stack;
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : "Dev stack request failed");
  const pending = boot.isPending || stop.isPending;

  let icon: React.ReactNode;
  let tooltip: string;
  let onClick: (() => void) | undefined;

  if (!stack) {
    icon = <Play className="h-3.5 w-3.5" />;
    tooltip = `Boot ${task.headBranch} in the main checkout`;
    onClick = () => boot.mutate(task.id, { onError });
  } else if (stack.taskId !== task.id) {
    icon = <Play className="h-3.5 w-3.5 opacity-30" />;
    tooltip = `Dev stack is up for ${stack.branch}`;
  } else if (stack.state === "starting" || stack.state === "stopping") {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-500" />;
    tooltip = stack.state === "starting" ? "Booting…" : "Stopping…";
  } else if (stack.state === "failed") {
    icon = <Square className="h-3.5 w-3.5 text-red-500" />;
    tooltip = `Failed: ${stack.error ?? "unknown error"}\nClick to reset (stops the stack, switches back)`;
    onClick = () => stop.mutate(task.id, { onError });
  } else if (!stack.alive) {
    icon = <Square className="h-3.5 w-3.5 text-red-500" />;
    tooltip = "Boot process exited (see logs/dev-stack.log)\nClick to clean up";
    onClick = () => stop.mutate(task.id, { onError });
  } else {
    icon = <Square className="h-3.5 w-3.5 text-green-600 fill-current" />;
    tooltip = `Running at ${stack.url}\nClick to stop and switch back`;
    onClick = () => stop.mutate(task.id, { onError });
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick || pending}
          className={cn(
            "inline-flex items-center justify-center rounded p-0.5 text-muted-foreground",
            onClick && "hover:text-foreground hover:bg-muted",
            !onClick && "cursor-default",
          )}
          aria-label={tooltip}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-line">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
