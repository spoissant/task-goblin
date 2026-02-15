import { useState, useMemo } from "react";
import { useAgentsQuery } from "@/client/lib/queries/agents";
import { useRepositoriesQuery } from "@/client/lib/queries/repositories";
import { AgentColumn } from "@/client/components/agents/AgentColumn";
import { CreateAgentDialog } from "@/client/components/agents/CreateAgentDialog";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { EmptyState } from "@/client/components/ui/empty-state";
import { Plus } from "lucide-react";
import type { Worktree, Repository } from "@/client/lib/types";

export function AgentsPage() {
  const { data: agentsData, isLoading: agentsLoading } = useAgentsQuery();
  const { data: reposData } = useRepositoriesQuery();
  const [createOpen, setCreateOpen] = useState(false);

  // Worktrees not yet assigned to an agent
  const availableWorktrees = useMemo(() => {
    if (!reposData?.items || !agentsData?.items) return [];
    const assignedWorktreeIds = new Set(
      agentsData.items.map((a) => a.worktreeId)
    );
    const result: (Worktree & { repository: Repository })[] = [];
    for (const repo of reposData.items) {
      for (const wt of repo.worktrees || []) {
        if (!assignedWorktreeIds.has(wt.id)) {
          result.push({ ...wt, repository: repo });
        }
      }
    }
    return result;
  }, [reposData, agentsData]);

  if (agentsLoading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Agents</h1>
        <div className="flex gap-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-96 flex-1" />
          ))}
        </div>
      </div>
    );
  }

  const agents = agentsData?.items ?? [];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Agents</h1>
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={availableWorktrees.length === 0}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Agent
        </Button>
      </div>

      {agents.length === 0 ? (
        <EmptyState message="No agents configured. Add a worktree to a repository first, then create an agent." />
      ) : (
        <div className="flex-1 flex gap-4 min-h-0" style={{ height: "calc(100vh - 10rem)" }}>
          {agents.map((agent) => (
            <div key={agent.id} className="flex-1 min-w-0">
              <AgentColumn agent={agent} />
            </div>
          ))}
        </div>
      )}

      <CreateAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        availableWorktrees={availableWorktrees}
      />
    </div>
  );
}
