import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Textarea } from "@/client/components/ui/textarea";
import { X, Upload, MessageSquare, CircleAlert, PenLine } from "lucide-react";

interface BulkActionsBarProps {
  selectedCount: number;
  deploymentBranches: string[];
  targetBranch: string;
  onTargetBranchChange: (branch: string) => void;
  onDeploy: () => void;
  onClearSelection: () => void;
  isDeploying: boolean;
  onBulkPrompt: (template: string) => void;
  onCustomPrompt: (text: string) => void;
}

export function BulkActionsBar({
  selectedCount,
  deploymentBranches,
  targetBranch,
  onTargetBranchChange,
  onDeploy,
  onClearSelection,
  isDeploying,
  onBulkPrompt,
  onCustomPrompt,
}: BulkActionsBarProps) {
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  const handleCustomSubmit = () => {
    if (!customText.trim()) return;
    onCustomPrompt(customText.trim());
    setCustomText("");
    setCustomDialogOpen(false);
  };

  return (
    <>
      <div className="h-9 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="font-medium">{selectedCount} selected</span>
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBulkPrompt("/processing-pr-comments")}
          >
            <MessageSquare className="h-4 w-4 mr-1" />
            PR Comments
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBulkPrompt("/processing-pr-checks")}
          >
            <CircleAlert className="h-4 w-4 mr-1" />
            PR Checks
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCustomDialogOpen(true)}
          >
            <PenLine className="h-4 w-4 mr-1" />
            Custom Prompt...
          </Button>
          {deploymentBranches.length > 0 && (
            <>
              <Select value={targetBranch} onValueChange={onTargetBranchChange}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {deploymentBranches.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={onDeploy}
                disabled={!targetBranch || isDeploying}
              >
                <Upload className="h-4 w-4 mr-2" />
                {isDeploying
                  ? "Deploying..."
                  : targetBranch
                    ? `Deploy to ${targetBranch}`
                    : "Deploy"}
              </Button>
            </>
          )}
        </div>
      </div>

      <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Custom Prompt</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Enter prompt content..."
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            rows={6}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCustomSubmit} disabled={!customText.trim()}>
              Create Prompts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
