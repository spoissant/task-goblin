import { ChevronDown } from "lucide-react";
import { useChoreDefinitionsQuery } from "@/client/lib/queries/chores";
import { Card } from "@/client/components/ui/card";
import { useLocalStorage } from "@/client/lib/useLocalStorage";
import { cn } from "@/client/lib/utils";

export function ChoreLegend() {
  const { data } = useChoreDefinitionsQuery();
  const chores = data?.items ?? [];
  const [minimized, setMinimized] = useLocalStorage("chore-legend-minimized", false);

  if (chores.length === 0) return null;

  return (
    <Card className="fixed bottom-4 right-4 z-50 gap-2 py-3 px-4 text-xs shadow-md max-h-[60vh] overflow-y-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
          Chores
        </div>
        <button
          type="button"
          onClick={() => setMinimized((prev) => !prev)}
          aria-label={minimized ? "Expand chore legend" : "Minimize chore legend"}
          aria-expanded={!minimized}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-200",
              minimized ? "rotate-180" : "rotate-0",
            )}
          />
        </button>
      </div>
      {!minimized && (
        <ul className="flex flex-col gap-1">
          {chores.map((c) => (
            <li key={c.key}>
              <span className="text-muted-foreground">#{c.number}</span> {c.name}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
