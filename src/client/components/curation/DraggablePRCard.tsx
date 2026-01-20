import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Badge } from "@/client/components/ui/badge";
import { GripVertical, GitPullRequest, ExternalLink } from "lucide-react";
import type { Task, TaskWithRepository } from "@/client/lib/types";

interface Props {
  task: Task | TaskWithRepository;
  isOrphan?: boolean;
  prUrl?: string;
}

export function DraggablePRCard({ task, isOrphan = false, prUrl }: Props) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `pr-task-${task.id}`,
    data: { type: "pr", task },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `pr-drop-${task.id}`,
    data: { type: "pr-orphan", task },
    disabled: !isOrphan,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  // Combine refs
  const setNodeRef = (node: HTMLElement | null) => {
    setDragRef(node);
    if (isOrphan) setDropRef(node);
  };

  if (!task.prNumber) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-2 py-1.5 bg-background border rounded-md text-sm ${
        isDragging ? "opacity-50 shadow-lg z-50" : ""
      } ${isOver ? "ring-2 ring-primary" : ""}`}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground flex-shrink-0 cursor-grab" />
      <GitPullRequest className="h-3 w-3 text-muted-foreground flex-shrink-0" />
      <Badge variant="outline" className="flex-shrink-0">
        #{task.prNumber}
      </Badge>
      {prUrl ? (
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <p className="truncate text-muted-foreground">{task.title || task.headBranch}</p>
            <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-50" />
          </div>
          {task.title && task.headBranch && task.title !== task.headBranch && (
            <p className="truncate text-xs text-muted-foreground/70">{task.headBranch}</p>
          )}
        </a>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-muted-foreground">{task.title || task.headBranch}</p>
          {task.title && task.headBranch && task.title !== task.headBranch && (
            <p className="truncate text-xs text-muted-foreground/70">{task.headBranch}</p>
          )}
        </div>
      )}
    </div>
  );
}
