import { useState } from "react";
import { useCreateRepository } from "@/client/lib/queries";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/client/components/ui/dialog";
import { Label } from "@/client/components/ui/label";
import { toast } from "sonner";
import { BadgeColorSelect } from "./BadgeColorSelect";
import type { BadgeColorName } from "@/client/components/tasks/RepoBadge";

interface AddRepositoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddRepositoryDialog({ open, onOpenChange }: AddRepositoryDialogProps) {
  const createRepo = useCreateRepository();
  const [newOwner, setNewOwner] = useState("");
  const [newRepo, setNewRepo] = useState("");
  const [newBadgeColor, setNewBadgeColor] = useState<BadgeColorName | "">("gray");

  const handleCreate = () => {
    if (!newOwner.trim() || !newRepo.trim()) {
      toast.error("Owner and repo name are required");
      return;
    }

    createRepo.mutate(
      { owner: newOwner.trim(), repo: newRepo.trim(), badgeColor: newBadgeColor || null },
      {
        onSuccess: () => {
          toast.success("Repository added");
          setNewOwner("");
          setNewRepo("");
          setNewBadgeColor("gray");
          onOpenChange(false);
        },
        onError: () => {
          toast.error("Failed to add repository");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <div className="space-y-2">
            <Label>Badge Color</Label>
            <BadgeColorSelect
              value={newBadgeColor || "gray"}
              onValueChange={(value) => setNewBadgeColor(value as BadgeColorName)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
  );
}
