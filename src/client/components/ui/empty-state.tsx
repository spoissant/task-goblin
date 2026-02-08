import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  message: string;
  icon?: LucideIcon;
}

export function EmptyState({ message, icon: Icon }: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      {Icon && <Icon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />}
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
