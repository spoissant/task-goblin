import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { useUpdateTask } from "@/client/lib/queries";
import { useChoreDefinitionsQuery } from "@/client/lib/queries/chores";
import { toast } from "sonner";

interface ChoreSkipsEditorProps {
  taskId: number;
  choreSkips: string | null;
}

export function ChoreSkipsEditor({ taskId, choreSkips }: ChoreSkipsEditorProps) {
  const updateTask = useUpdateTask();
  const { data } = useChoreDefinitionsQuery();
  const skips: Record<string, boolean> = choreSkips ? JSON.parse(choreSkips) : {};

  const handleToggle = (choreKey: string, checked: boolean) => {
    const updated = { ...skips };
    if (checked) {
      updated[choreKey] = true;
    } else {
      delete updated[choreKey];
    }
    const json = Object.keys(updated).length > 0 ? JSON.stringify(updated) : null;
    updateTask.mutate(
      { id: taskId, choreSkips: json ?? "" },
      {
        onError: () => toast.error("Failed to update chore skips"),
      }
    );
  };

  const definitions = data?.items ? [...data.items].sort((a, b) => a.number - b.number) : [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Skip Goblin Chores
      </p>
      <div className="flex flex-wrap gap-4">
        {definitions.map((def) => (
          <div key={def.key} className="flex items-center gap-2">
            <Checkbox
              id={`chore-skip-${def.key}`}
              checked={!!skips[def.key]}
              onCheckedChange={(checked) => handleToggle(def.key, !!checked)}
              disabled={updateTask.isPending}
            />
            <Label htmlFor={`chore-skip-${def.key}`} className="text-sm cursor-pointer">
              #{def.number} - {def.name}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}
