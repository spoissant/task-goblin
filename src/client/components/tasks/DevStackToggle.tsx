import { CirclePlay, CircleStop, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useBootDevStack, useDevStackOverviewQuery, useRefreshDevStack, useStopDevStack } from "@/client/lib/queries/dev-stack";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import type { DevStack, DevStackOwner } from "@/client/lib/types";

interface DevStackToggleProps {
  owner: DevStackOwner;
  repositoryId: number | null;
  /** Branch (or PR) shown in tooltips; null hides the toggle. */
  label: string | null;
}

function isOwner(stack: DevStack, owner: DevStackOwner): boolean {
  return "taskId" in owner ? stack.taskId === owner.taskId : stack.prUrl === owner.prUrl;
}

/**
 * Play/stop for the single local dev stack, shown next to the repo badge.
 * Play detaches the main checkout at the task branch (or a PR's head) and runs the stack;
 * stop tears it down and returns to the base branch. While up, refresh moves
 * the detached checkout to the branch's latest commit. Hidden for repositories
 * without dev stack support (see server/services/dev-stack.ts).
 */
export function DevStackToggle({ owner, repositoryId, label }: DevStackToggleProps) {
  const { data } = useDevStackOverviewQuery();

  if (!data || repositoryId === null || !label) return null;
  if (!data.supportedRepositoryIds.includes(repositoryId)) return null;

  return <DevStackButtons owner={owner} label={label} stack={data.stack} />;
}

interface DevStackButtonsProps {
  owner: DevStackOwner;
  label: string;
  stack: DevStack | null;
}

/** The play/stop and refresh buttons, without the repository support check. */
export function DevStackButtons({ owner, label, stack }: DevStackButtonsProps) {
  const boot = useBootDevStack();
  const stop = useStopDevStack();
  const refresh = useRefreshDevStack();

  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : "Dev stack request failed");
  const pending = boot.isPending || stop.isPending || refresh.isPending;

  let icon: React.ReactNode;
  let tooltip: string;
  let onClick: (() => void) | undefined;
  let canRefresh = false;

  if (!stack) {
    icon = <CirclePlay className="h-6 w-6" />;
    tooltip = `Boot ${label} in the main checkout`;
    onClick = () => boot.mutate(owner, { onError });
  } else if (!isOwner(stack, owner)) {
    icon = <CirclePlay className="h-6 w-6 opacity-30" />;
    tooltip = `Dev stack is up for ${stack.branch}`;
  } else if (stack.state === "starting" || stack.state === "stopping") {
    icon = <Loader2 className="h-6 w-6 animate-spin text-yellow-500" />;
    tooltip = `${stack.state === "starting" ? "Booting…" : "Stopping…"}\n${stack.detail ?? ""}`.trimEnd();
  } else if (stack.state === "failed") {
    icon = <CircleStop className="h-6 w-6 text-red-500" />;
    tooltip = `Failed: ${stack.error ?? "unknown error"}\nClick to reset (stops the stack, switches back)`;
    onClick = () => stop.mutate(owner, { onError });
  } else if (!stack.alive) {
    icon = <CircleStop className="h-6 w-6 text-red-500" />;
    tooltip = "Boot process exited (see logs/dev-stack.log)\nClick to clean up";
    onClick = () => stop.mutate(owner, { onError });
  } else {
    icon = <CircleStop className="h-6 w-6 text-green-600" />;
    tooltip = `Running at ${stack.url}\nClick to stop and switch back`;
    onClick = () => stop.mutate(owner, { onError });
    canRefresh = true;
  }

  const onRefresh = () =>
    refresh.mutate(owner, {
      onError,
      onSuccess: ({ from, to }) =>
        toast.success(from === to ? `Already at the latest commit (${to})` : `Dev stack moved ${from} → ${to}`),
    });

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            disabled={!onClick || pending}
            className={cn(
              "inline-flex items-center justify-center rounded p-0.5 text-muted-foreground",
              onClick && "cursor-pointer hover:text-foreground hover:bg-muted",
              !onClick && "cursor-default",
            )}
            aria-label={tooltip}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-line">{tooltip}</TooltipContent>
      </Tooltip>
      {canRefresh && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onRefresh}
              disabled={pending}
              className="inline-flex cursor-pointer items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Refresh to the latest commit"
            >
              <RefreshCw className={cn("h-5 w-5", refresh.isPending && "animate-spin")} />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-line">
            {"Move the checkout to the latest commit of the branch\nKeeps the stack running; new migrations are not run"}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
