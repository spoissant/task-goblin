import { useState } from "react";
import {
  useRepositoriesQuery,
  useCreateRepository,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/client/components/ui/dialog";
import { Label } from "@/client/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function RepositoryList() {
  const { data, isLoading } = useRepositoriesQuery();
  const createRepo = useCreateRepository();
  const updateRepo = useUpdateRepository();
  const deleteRepo = useDeleteRepository();

  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const [newRepo, setNewRepo] = useState("");

  const handleCreate = () => {
    if (!newOwner.trim() || !newRepo.trim()) {
      toast.error("Owner and repo name are required");
      return;
    }

    createRepo.mutate(
      { owner: newOwner.trim(), repo: newRepo.trim() },
      {
        onSuccess: () => {
          toast.success("Repository added");
          setNewOwner("");
          setNewRepo("");
          setIsAddingRepo(false);
        },
        onError: () => {
          toast.error("Failed to add repository");
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

      <Dialog open={isAddingRepo} onOpenChange={setIsAddingRepo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Repository</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="owner">Owner</Label>
              <Input
                id="owner"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                placeholder="organization or username"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repo">Repository Name</Label>
              <Input
                id="repo"
                value={newRepo}
                onChange={(e) => setNewRepo(e.target.value)}
                placeholder="repository-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingRepo(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newOwner.trim() || !newRepo.trim() || createRepo.isPending}
            >
              {createRepo.isPending ? "Adding..." : "Add Repository"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
