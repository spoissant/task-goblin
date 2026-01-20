import { useNavigate } from "react-router";
import { Card, CardHeader, CardTitle, CardDescription } from "@/client/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import type { Task } from "@/client/lib/types";

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const navigate = useNavigate();

  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => navigate(`/tasks/${task.id}`)}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base line-clamp-2">{task.title}</CardTitle>
          <StatusBadge status={task.status} />
        </div>
        {task.description && (
          <CardDescription className="line-clamp-2">{task.description}</CardDescription>
        )}
      </CardHeader>
    </Card>
  );
}
