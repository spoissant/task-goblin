import { useState } from "react";
import {
  useRepositoriesQuery,
  useUpdateRepository,
  useDeleteRepository,
  type RepositoryUpdate,
} from "@/client/lib/queries/repositories";
import type { Repository } from "@/shared/types";
import { parseJson, parseStringList } from "@/shared/json";
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
import { ColorSelect, BADGE_COLOR_OPTIONS } from "./ColorSelect";
import { SaveOnBlurInput } from "./SaveOnBlurInput";
import { AddRepositoryDialog } from "./AddRepositoryDialog";

type TextField = "alias" | "localPath" | "slackChannel" | "setupCommand" | "teardownCommand" | "defaultBaseBranch";

export function RepositoryList() {
  const { data, isLoading } = useRepositoriesQuery();
  const [isAddingRepo, setIsAddingRepo] = useState(false);

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
                  <TableHead>Alias</TableHead>
                  <TableHead>Badge Color</TableHead>
                  <TableHead>Local Checkout Path</TableHead>
                  <TableHead>Deployment Branches</TableHead>
                  <TableHead>Slack Channel</TableHead>
                  <TableHead>Task Worktrees</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((repo) => (
                  <RepositoryRow key={repo.id} repo={repo} />
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

/** Saves one change to a repository, with a toast when it fails. */
function useSaveRepository(id: number) {
  const updateRepo = useUpdateRepository();
  return (data: RepositoryUpdate, onSuccess?: () => void) =>
    updateRepo.mutate({ id, ...data }, { onSuccess, onError: () => toast.error("Failed to update repository") });
}

function RepositoryRow({ repo }: { repo: Repository }) {
  const save = useSaveRepository(repo.id);
  const deleteRepo = useDeleteRepository();

  // An emptied field clears the column.
  const textField = (field: TextField, placeholder: string, width: string) => (
    <SaveOnBlurInput
      className={`h-6 ${width} text-xs font-mono`}
      placeholder={placeholder}
      value={repo[field] ?? ""}
      onSave={(value) => save({ [field]: value || null })}
    />
  );

  const handleDelete = () => {
    if (!confirm("Are you sure you want to delete this repository?")) return;
    deleteRepo.mutate(repo.id, {
      onSuccess: () => toast.success("Repository deleted"),
      onError: () => toast.error("Failed to delete repository"),
    });
  };

  return (
    <TableRow>
      <TableCell className="font-mono">
        {repo.owner}/{repo.repo}
      </TableCell>
      <TableCell>{textField("alias", "short name", "w-24")}</TableCell>
      <TableCell>
        <ColorSelect
          options={BADGE_COLOR_OPTIONS}
          value={repo.badgeColor || "gray"}
          onValueChange={(value) => save({ badgeColor: value || null })}
          triggerClassName="w-28"
        />
      </TableCell>
      <TableCell>{textField("localPath", `~/Code/${repo.repo}`, "w-56")}</TableCell>
      <TableCell>
        <DeploymentBranches repo={repo} />
      </TableCell>
      <TableCell>{textField("slackChannel", "#channel-name", "w-36")}</TableCell>
      <TableCell>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-14 shrink-0">Base</span>
            {textField("defaultBaseBranch", "main", "w-24")}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-14 shrink-0">Setup</span>
            {textField("setupCommand", "yarn install", "w-64")}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-14 shrink-0">Teardown</span>
            {textField("teardownCommand", "bin/dev worktree-cleanup {{composeProject}}", "w-64")}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Checkbox
          checked={repo.enabled === 1}
          onCheckedChange={() => save({ enabled: repo.enabled !== 1 })}
        />
      </TableCell>
      <TableCell>
        <Button size="icon" variant="ghost" onClick={handleDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** The repository's deployment branches, each with its environment URL, and an input to add one. */
function DeploymentBranches({ repo }: { repo: Repository }) {
  const save = useSaveRepository(repo.id);
  const [newBranch, setNewBranch] = useState("");
  const branches = parseStringList(repo.deploymentBranches);
  const urls = parseJson<Record<string, string>>(repo.deploymentUrls, {});

  const saveUrl = (branch: string, url: string) => {
    const updated = { ...urls };
    if (url) {
      updated[branch] = url;
    } else {
      delete updated[branch];
    }
    save({ deploymentUrls: updated });
  };

  const addBranch = () => {
    const branch = newBranch.trim();
    if (!branch) return;
    if (branches.includes(branch)) {
      toast.error("Branch already exists");
      return;
    }
    save({ deploymentBranches: [...branches, branch] }, () => setNewBranch(""));
  };

  return (
    <div className="space-y-1.5">
      {branches.map((branch) => (
        <div key={branch} className="flex items-center gap-1.5">
          <Badge variant="secondary" className="gap-1 pr-1 shrink-0">
            {branch}
            <button
              type="button"
              className="rounded-full hover:bg-muted-foreground/20 p-0.5"
              onClick={() => save({ deploymentBranches: branches.filter((b) => b !== branch) })}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
          <SaveOnBlurInput
            className="h-6 w-48 text-xs font-mono"
            placeholder="https://..."
            value={urls[branch] ?? ""}
            onSave={(url) => saveUrl(branch, url)}
          />
        </div>
      ))}
      <Input
        className="h-6 w-20 text-xs"
        placeholder="staging"
        value={newBranch}
        onChange={(e) => setNewBranch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addBranch();
          }
        }}
      />
    </div>
  );
}
