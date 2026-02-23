import { useState, useEffect } from "react";
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
import { TagInput } from "@/client/components/settings/TagInput";
import { useUpdateAgent } from "@/client/lib/queries/agents";
import type { AgentWithWorktree } from "@/client/lib/types";
import { DEFAULT_ALLOWED_TOOLS } from "@/shared/constants";
import { toast } from "sonner";

interface EditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentWithWorktree;
}

export function EditAgentDialog({
  open,
  onOpenChange,
  agent,
}: EditAgentDialogProps) {
  const updateAgent = useUpdateAgent();
  const [name, setName] = useState(agent.name);
  const [model, setModel] = useState(agent.model || "sonnet");
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt || "");
  const [maxTurns, setMaxTurns] = useState(
    agent.maxTurns ? String(agent.maxTurns) : ""
  );
  const [defaultBranch, setDefaultBranch] = useState(
    agent.defaultBranch || ""
  );
  const [allowedTools, setAllowedTools] = useState<string[]>(
    agent.allowedTools ? JSON.parse(agent.allowedTools) : []
  );

  useEffect(() => {
    setName(agent.name);
    setModel(agent.model || "sonnet");
    setSystemPrompt(agent.systemPrompt || "");
    setMaxTurns(agent.maxTurns ? String(agent.maxTurns) : "");
    setDefaultBranch(agent.defaultBranch || "");
    setAllowedTools(agent.allowedTools ? JSON.parse(agent.allowedTools) : []);
  }, [agent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    updateAgent.mutate(
      {
        id: agent.id,
        name: name.trim(),
        model: model || null,
        systemPrompt: systemPrompt.trim() || null,
        maxTurns: maxTurns ? Number(maxTurns) : null,
        defaultBranch: defaultBranch.trim() || null,
        allowedTools: allowedTools.length > 0 ? allowedTools : null,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: () => {
          toast.error("Failed to update agent");
        },
      }
    );
  };

  return (
    <ModalDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Agent"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || updateAgent.isPending}
          >
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 pb-4">
        <div className="space-y-2">
          <Label htmlFor="edit-agent-name">Name</Label>
          <Input
            id="edit-agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Worktree</Label>
          <Input
            value={`${agent.worktree.repository.owner}/${agent.worktree.repository.repo} — ${agent.worktree.path}`}
            disabled
          />
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
          <Label htmlFor="edit-agent-max-turns">Max Turns</Label>
          <Input
            id="edit-agent-max-turns"
            type="number"
            value={maxTurns}
            onChange={(e) => setMaxTurns(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-agent-default-branch">Default Branch</Label>
          <Input
            id="edit-agent-default-branch"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            placeholder="e.g. main"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="edit-agent-system-prompt">
            System Prompt (appended)
          </Label>
          <Textarea
            id="edit-agent-system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Optional additional instructions..."
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label>Additional Allowed Tools</Label>
          <p className="text-xs text-muted-foreground">
            Default: {DEFAULT_ALLOWED_TOOLS.join(", ")}
          </p>
          <TagInput
            tags={allowedTools}
            onChange={setAllowedTools}
            placeholder='e.g. Bash(bun:*)'
          />
        </div>
      </form>
    </ModalDialog>
  );
}
