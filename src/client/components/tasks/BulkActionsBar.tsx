import { Button } from "@/client/components/ui/button";
import { X, Clipboard } from "lucide-react";

interface BulkActionsBarProps {
  selectedCount: number;
  onCopyDeployPrompt: () => void;
  onClearSelection: () => void;
}

export function BulkActionsBar({
  selectedCount,
  onCopyDeployPrompt,
  onClearSelection,
}: BulkActionsBarProps) {
  return (
    <div className="h-9 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="font-medium">{selectedCount} selected</span>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onCopyDeployPrompt}>
          <Clipboard className="h-4 w-4 mr-2" />
          Copy deploy prompt
        </Button>
      </div>
    </div>
  );
}
