import { Check } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { useStatusSettingsQuery } from "@/client/lib/queries/settings";
import { useUpdateTask } from "@/client/lib/queries/tasks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { cn } from "@/client/lib/utils";

interface InteractiveStatusBadgeProps {
  taskId: number;
  status: string;
  jiraKey: string | null;
  className?: string;
}

export function InteractiveStatusBadge({
  taskId,
  status,
  jiraKey,
  className,
}: InteractiveStatusBadgeProps) {
  const { data: statusSettings } = useStatusSettingsQuery();
  const updateTask = useUpdateTask();

  // Jira tasks: render plain StatusBadge (Jira manages status)
  if (jiraKey) {
    return <StatusBadge status={status} className={className} />;
  }

  const handleStatusChange = (newStatus: string) => {
    if (newStatus !== status) {
      updateTask.mutate({ id: taskId, status: newStatus });
    }
  };

  const categories = statusSettings?.categories ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className="cursor-pointer"
      >
        <StatusBadge status={status} className={cn("hover:opacity-80", className)} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {categories.map((category) => (
          <DropdownMenuItem
            key={category.id}
            onClick={() => handleStatusChange(category.name)}
            className="flex items-center gap-2"
          >
            <div
              className={cn("w-3 h-3 rounded-full", category.color)}
            />
            <span>{category.name}</span>
            {status === category.name && (
              <Check className="ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
