import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import type { Task, TaskWithRepository, AutoMatchResult } from "@/client/lib/types";

interface AutoMatchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: AutoMatchResult["matches"];
  jiraOrphans: Task[];
  prOrphans: TaskWithRepository[];
  jiraHost?: string;
  onMerge: (matches: Array<{ targetId: number; sourceId: number }>) => void;
  isMerging: boolean;
}

export function AutoMatchModal({
  open,
  onOpenChange,
  matches,
  jiraOrphans,
  prOrphans,
  jiraHost,
  onMerge,
  isMerging,
}: AutoMatchModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(matches.map((_, i) => i))
  );

  // Reset selection when matches change
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setSelectedIds(new Set(matches.map((_, i) => i)));
    }
    onOpenChange(open);
  };

  const toggleMatch = (index: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === matches.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(matches.map((_, i) => i)));
    }
  };

  const handleMerge = () => {
    const toMerge = matches
      .filter((_, i) => selectedIds.has(i))
      .map((m) => ({ targetId: m.jiraTaskId, sourceId: m.prTaskId }));
    onMerge(toMerge);
  };

  const jiraMap = new Map(jiraOrphans.map((t) => [t.id, t]));
  const prMap = new Map(prOrphans.map((t) => [t.id, t]));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Auto-Match Results</DialogTitle>
          <DialogDescription>
            Found {matches.length} potential match{matches.length !== 1 ? "es" : ""} based on Jira keys in PR branches/titles.
            Select which ones to merge.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[400px] overflow-y-auto">
          <div className="space-y-2">
            <label className="flex items-center gap-2 py-2 border-b cursor-pointer">
              <Checkbox
                checked={selectedIds.size === matches.length}
                onCheckedChange={toggleAll}
              />
              <span className="text-sm font-medium">Select All</span>
            </label>

            {matches.map((match, index) => {
              const jiraTask = jiraMap.get(match.jiraTaskId);
              const prTask = prMap.get(match.prTaskId);
              const prRepo = prTask?.repository;

              return (
                <label
                  key={index}
                  className="flex items-start gap-3 p-3 rounded-md border hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedIds.has(index)}
                    onCheckedChange={() => toggleMatch(index)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono font-medium text-blue-600">
                        {jiraHost ? (
                          <a
                            href={`https://${jiraHost}/browse/${match.jiraKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {match.jiraKey}
                          </a>
                        ) : (
                          match.jiraKey
                        )}
                      </span>
                      <span className="text-muted-foreground">+</span>
                      <span className="font-mono text-green-600">
                        {prRepo ? (
                          <a
                            href={`https://github.com/${prRepo.owner}/${prRepo.repo}/pull/${prTask?.prNumber}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            PR #{prTask?.prNumber}
                          </a>
                        ) : (
                          `PR #${prTask?.prNumber || "?"}`
                        )}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {jiraTask?.title || prTask?.title}
                    </div>
                    {prTask?.headBranch && (
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {prTask.headBranch}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMerging}>
            Cancel
          </Button>
          <Button
            onClick={handleMerge}
            disabled={selectedIds.size === 0 || isMerging}
          >
            {isMerging
              ? "Merging..."
              : `Merge ${selectedIds.size} Match${selectedIds.size !== 1 ? "es" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
