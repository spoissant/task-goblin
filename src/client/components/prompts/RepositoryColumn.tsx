import { useState } from "react";
import { usePromptsQuery, useCreatePrompt } from "@/client/lib/queries/prompts";
import { PromptCard } from "./PromptCard";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Plus } from "lucide-react";
import type { Repository } from "@/client/lib/types";
import { toast } from "sonner";

interface RepositoryColumnProps {
  repository: Repository;
}

export function RepositoryColumn({ repository }: RepositoryColumnProps) {
  const { data } = usePromptsQuery(repository.id);
  const createPrompt = useCreatePrompt();
  const [showInput, setShowInput] = useState(false);
  const [content, setContent] = useState("");
  const [permissionMode, setPermissionMode] = useState("default");

  const prompts = data?.items ?? [];

  const handleCreate = () => {
    if (!content.trim()) return;
    createPrompt.mutate(
      {
        repositoryId: repository.id,
        content: content.trim(),
        permissionMode: permissionMode !== "default" ? permissionMode : undefined,
      },
      {
        onSuccess: () => {
          setContent("");
          setPermissionMode("default");
          setShowInput(false);
        },
        onError: () => toast.error("Failed to create prompt"),
      }
    );
  };

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <span className="font-medium text-sm truncate">
          {repository.owner}/{repository.repo}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setShowInput(!showInput)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* New prompt input */}
      {showInput && (
        <div className="p-2 border-b space-y-2">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter prompt content..."
            rows={2}
            className="text-sm"
          />
          <div className="flex items-center gap-2">
            <Select value={permissionMode} onValueChange={setPermissionMode}>
              <SelectTrigger className="h-7 text-xs w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="plan">Plan</SelectItem>
                <SelectItem value="acceptEdits">Accept Edits</SelectItem>
                <SelectItem value="bypassPermissions">Bypass Permissions</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => setShowInput(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!content.trim() || createPrompt.isPending}
            >
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Prompt list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
        {prompts.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No prompts in queue
          </p>
        ) : (
          prompts.map((prompt, index) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              isFirst={index === 0}
              isLast={index === prompts.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}
