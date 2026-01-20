import { useTasksQuery } from "@/client/lib/queries";
import { TaskCard } from "./TaskCard";
import { Skeleton } from "@/client/components/ui/skeleton";

interface TaskListProps {
  statusFilter?: string;
}

export function TaskList({ statusFilter }: TaskListProps) {
  const { data, isLoading, error } = useTasksQuery({ status: statusFilter });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Failed to load tasks
      </div>
    );
  }

  if (!data?.items.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No tasks found
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data.items.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  );
}
