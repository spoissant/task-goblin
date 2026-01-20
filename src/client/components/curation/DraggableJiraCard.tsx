import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Badge } from "@/client/components/ui/badge";
import { StatusBadge } from "@/client/components/tasks/StatusBadge";
import { GripVertical, ExternalLink } from "lucide-react";
import type { Task } from "@/client/lib/types";

interface Props {
  task: Task;
  isOrphan?: boolean;
  jiraHost?: string;
}

export function DraggableJiraCard({ task, isOrphan = false, jiraHost }: Props) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `jira-task-${task.id}`,
    data: { type: "jira", task },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `jira-drop-${task.id}`,
    data: { type: "jira-orphan", task },
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

  if (!task.jiraKey) return null;

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
      <StatusBadge status={task.status} className="flex-shrink-0 text-xs" />
      {jiraHost ? (
        <a
          href={`${jiraHost.replace(/\/$/, '')}/browse/${task.jiraKey}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 min-w-0 flex-1 hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          <Badge variant="outline" className="flex-shrink-0">
            {task.jiraKey}
          </Badge>
          <span className="truncate flex-1 min-w-0 text-muted-foreground">{task.title}</span>
          <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-50" />
        </a>
      ) : (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge variant="outline" className="flex-shrink-0">
            {task.jiraKey}
          </Badge>
          <span className="truncate flex-1 min-w-0 text-muted-foreground">{task.title}</span>
        </div>
      )}
    </div>
  );
}
