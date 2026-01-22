import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { X, Upload } from "lucide-react";

interface BulkDeployBarProps {
  selectedCount: number;
  deploymentBranches: string[];
  targetBranch: string;
  onTargetBranchChange: (branch: string) => void;
  onDeploy: () => void;
  onClearSelection: () => void;
  isDeploying: boolean;
}

export function BulkDeployBar({
  selectedCount,
  deploymentBranches,
  targetBranch,
  onTargetBranchChange,
  onDeploy,
  onClearSelection,
  isDeploying,
}: BulkDeployBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t shadow-lg">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="font-medium">{selectedCount} selected</span>
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {deploymentBranches.length > 0 ? (
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
          ) : (
            <span className="text-sm text-muted-foreground">
              No deployment branches configured
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
