import { useState } from "react";
import { Link } from "react-router";
import { useBootDevStack, useDevStackQuery, useStopDevStack } from "@/client/lib/queries/dev-stack";
import { Button } from "@/client/components/ui/button";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { ExternalLink, Loader2, Power, ScrollText, Square } from "lucide-react";
import { toast } from "sonner";

interface DevStackButtonProps {
  taskId: number;
  branch: string | null;
}

/**
 * Boot / stop the single local dev stack from this task's branch. Hidden for
 * repositories without dev stack support (see server/services/dev-stack.ts).
 */
export function DevStackButton({ taskId, branch }: DevStackButtonProps) {
  const { data } = useDevStackQuery(taskId);
  const boot = useBootDevStack();
  const stop = useStopDevStack();
  const [logOpen, setLogOpen] = useState(false);

  if (!data?.supported) return null;
  const stack = data.stack;
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : "Dev stack request failed");

  // Another task owns the stack: point there instead of offering a boot.
  if (stack && stack.taskId !== taskId) {
    return (
      <Button variant="outline" size="sm" asChild title={`Dev stack is up for ${stack.branch}`}>
        <Link to={`/tasks/${stack.taskId}`}>
          <Power className="h-4 w-4 mr-2 text-amber-500" />
          Stack busy: {stack.branch}
        </Link>
      </Button>
    );
  }

  if (!stack) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => boot.mutate(taskId, { onError })}
        disabled={boot.isPending}
        title={`Detach the main checkout at ${branch} and run hbup there`}
      >
        <Power className="h-4 w-4 mr-2" />
        Boot {branch}
      </Button>
    );
  }

  const busy = stack.state === "starting" || stack.state === "stopping";
  const label =
    stack.state === "starting" ? "Booting…"
    : stack.state === "stopping" ? "Stopping…"
    : stack.state === "failed" ? "Reset stack"
    : stack.alive ? "Stop stack" : "Clean up stack";
  const status =
    stack.state === "failed" ? stack.error
    : stack.state === "up" && !stack.alive ? "Boot process exited; see log"
    : null;

  return (
    <>
      {status && (
        <span className="text-xs text-red-500 self-center truncate max-w-xs" title={status}>
          {status}
        </span>
      )}
      {stack.state === "up" && stack.alive && (
        <Button variant="ghost" size="sm" asChild title={stack.url}>
          <a href={stack.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open
          </a>
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setLogOpen(true)} title="Show boot log">
        <ScrollText className="h-4 w-4" />
      </Button>
      <Button
        variant={stack.state === "failed" ? "destructive" : "outline"}
        size="sm"
        onClick={() => stop.mutate(taskId, { onError })}
        disabled={busy || stop.isPending}
        title="Stop the stack and switch the main checkout back to its base branch"
      >
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Square className="h-4 w-4 mr-2" />}
        {label}
      </Button>

      <ModalDialog open={logOpen} onOpenChange={setLogOpen} title={`Dev stack log · ${stack.branch}`} size="xl">
        <pre className="text-xs font-mono bg-muted rounded p-3 max-h-[60vh] overflow-auto whitespace-pre-wrap">
          {stack.logTail || "(empty)"}
        </pre>
      </ModalDialog>
    </>
  );
}
