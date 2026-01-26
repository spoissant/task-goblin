import { useState } from "react";
import {
  useRepositoriesQuery,
  useUpdateRepository,
  useDeleteRepository,
} from "@/client/lib/queries";
import { Card, CardContent } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Badge } from "@/client/components/ui/badge";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { BadgeColorSelect } from "./BadgeColorSelect";
import { AddRepositoryDialog } from "./AddRepositoryDialog";

export function RepositoryList() {
  const { data, isLoading } = useRepositoriesQuery();
  const updateRepo = useUpdateRepository();
  const deleteRepo = useDeleteRepository();

  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const [branchInputs, setBranchInputs] = useState<Record<number, string>>({});
  const [localPathInputs, setLocalPathInputs] = useState<Record<number, string>>({});

  const handleBadgeColorChange = (id: number, color: string) => {
    updateRepo.mutate(
      { id, badgeColor: color || null },
      {
        onError: () => {
          toast.error("Failed to update badge color");
        },
      }
    );
  };

  const handleToggleEnabled = (id: number, enabled: boolean) => {
    updateRepo.mutate(
      { id, enabled: !enabled },
      {
        onError: () => {
          toast.error("Failed to update repository");
        },
      }
    );
  };

  const parseDeploymentBranches = (json: string | null): string[] => {
    if (!json) return [];
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  };

  const handleAddDeploymentBranch = (id: number, currentBranches: string[]) => {
    const newBranch = branchInputs[id]?.trim();
    if (!newBranch) return;
    if (currentBranches.includes(newBranch)) {
      toast.error("Branch already exists");
      return;
    }
    updateRepo.mutate(
      { id, deploymentBranches: [...currentBranches, newBranch] },
      {
        onSuccess: () => {
          setBranchInputs((prev) => ({ ...prev, [id]: "" }));
        },
        onError: () => {
          toast.error("Failed to add deployment branch");
        },
      }
    );
  };

  const handleRemoveDeploymentBranch = (id: number, currentBranches: string[], branchToRemove: string) => {
    updateRepo.mutate(
      { id, deploymentBranches: currentBranches.filter((b) => b !== branchToRemove) },
      {
        onError: () => {
          toast.error("Failed to remove deployment branch");
        },
      }
    );
  };

  const handleLocalPathChange = (id: number, path: string) => {
    updateRepo.mutate(
      { id, localPath: path.trim() || null },
      {
        onSuccess: () => {
          setLocalPathInputs((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        },
        onError: () => {
          toast.error("Failed to update local path");
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this repository?")) {
      deleteRepo.mutate(id, {
        onSuccess: () => {
          toast.success("Repository deleted");
        },
        onError: () => {
          toast.error("Failed to delete repository");
        },
      });
    }
  };

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setIsAddingRepo(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Repository
            </Button>
          </div>

          {!data?.items.length ? (
            <p className="text-muted-foreground text-sm text-center py-4">
              No repositories configured
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead>Badge Color</TableHead>
                  <TableHead>Local Path</TableHead>
                  <TableHead>Deployment Branches</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((repo) => (
                  <TableRow key={repo.id}>
                    <TableCell className="font-mono">
                      {repo.owner}/{repo.repo}
                    </TableCell>
                    <TableCell>
                      <BadgeColorSelect
                        value={repo.badgeColor || "gray"}
                        onValueChange={(value) => handleBadgeColorChange(repo.id, value)}
                        triggerClassName="w-28"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-56 text-xs font-mono"
                        placeholder="/path/to/repo"
                        value={localPathInputs[repo.id] ?? repo.localPath ?? ""}
                        onChange={(e) => setLocalPathInputs((prev) => ({ ...prev, [repo.id]: e.target.value }))}
                        onBlur={() => {
                          const value = localPathInputs[repo.id];
                          if (value !== undefined && value !== (repo.localPath ?? "")) {
                            handleLocalPathChange(repo.id, value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const value = localPathInputs[repo.id];
                            if (value !== undefined && value !== (repo.localPath ?? "")) {
                              handleLocalPathChange(repo.id, value);
                            }
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const branches = parseDeploymentBranches(repo.deploymentBranches);
                        return (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {branches.map((branch) => (
                              <Badge
                                key={branch}
                                variant="secondary"
                                className="gap-1 pr-1"
                              >
                                {branch}
                                <button
                                  type="button"
                                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                                  onClick={() => handleRemoveDeploymentBranch(repo.id, branches, branch)}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                            <Input
                              className="h-6 w-20 text-xs"
                              placeholder="staging"
                              value={branchInputs[repo.id] || ""}
                              onChange={(e) => setBranchInputs((prev) => ({ ...prev, [repo.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAddDeploymentBranch(repo.id, branches);
                                }
                              }}
                            />
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={repo.enabled === 1}
                        onCheckedChange={() => handleToggleEnabled(repo.id, repo.enabled === 1)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(repo.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddRepositoryDialog
        open={isAddingRepo}
        onOpenChange={setIsAddingRepo}
      />
    </>
  );
}
