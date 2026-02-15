import { useState } from "react";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Textarea } from "@/client/components/ui/textarea";
import { useCreateAgent } from "@/client/lib/queries/agents";
import type { Worktree, Repository } from "@/client/lib/types";
import { toast } from "sonner";

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableWorktrees: (Worktree & { repository: Repository })[];
}

export function CreateAgentDialog({
  open,
  onOpenChange,
  availableWorktrees,
}: CreateAgentDialogProps) {
  const createAgent = useCreateAgent();
  const [name, setName] = useState("");
  const [worktreeId, setWorktreeId] = useState<string>("");
  const [model, setModel] = useState("sonnet");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [maxTurns, setMaxTurns] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !worktreeId) return;

    createAgent.mutate(
      {
        name: name.trim(),
        worktreeId: Number(worktreeId),
        model: model || null,
        systemPrompt: systemPrompt.trim() || null,
        maxTurns: maxTurns ? Number(maxTurns) : null,
        defaultBranch: defaultBranch.trim() || null,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setName("");
          setWorktreeId("");
          setModel("sonnet");
          setSystemPrompt("");
          setMaxTurns("");
          setDefaultBranch("");
        },
        onError: () => {
          toast.error("Failed to create agent");
        },
      }
    );
  };

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create Agent"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !worktreeId || createAgent.isPending}
          >
            Create
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 pb-4">
        <div className="space-y-2">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Agent"
          />
        </div>

        <div className="space-y-2">
          <Label>Worktree</Label>
          <Select value={worktreeId} onValueChange={setWorktreeId}>
            <SelectTrigger>
              <SelectValue placeholder="Select worktree" />
            </SelectTrigger>
            <SelectContent>
              {availableWorktrees.map((wt) => (
                <SelectItem key={wt.id} value={String(wt.id)}>
                  {wt.repository.owner}/{wt.repository.repo} — {wt.path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opus">Opus</SelectItem>
              <SelectItem value="sonnet">Sonnet</SelectItem>
              <SelectItem value="haiku">Haiku</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent-max-turns">Max Turns</Label>
          <Input
            id="agent-max-turns"
            type="number"
            value={maxTurns}
            onChange={(e) => setMaxTurns(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent-default-branch">Default Branch</Label>
          <Input
            id="agent-default-branch"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            placeholder="e.g. main"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent-system-prompt">System Prompt (appended)</Label>
          <Textarea
            id="agent-system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Optional additional instructions..."
            rows={3}
          />
        </div>
      </form>
    </ModalDialog>
  );
}
