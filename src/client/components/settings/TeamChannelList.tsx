import { useState } from "react";
import {
  useTeamChannelsQuery,
  useCreateTeamChannel,
  useDeleteTeamChannel,
  useUpdateTeamChannel,
} from "@/client/lib/queries/team-channels";
import { Card, CardContent } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SaveOnBlurInput } from "./SaveOnBlurInput";

export function TeamChannelList() {
  const { data, isLoading } = useTeamChannelsQuery();
  const createTeamChannel = useCreateTeamChannel();
  const updateTeamChannel = useUpdateTeamChannel();
  const deleteTeamChannel = useDeleteTeamChannel();

  const [newSlug, setNewSlug] = useState("");
  const [newChannel, setNewChannel] = useState("");

  const handleCreate = () => {
    if (!newSlug.trim() || !newChannel.trim()) {
      toast.error("Both fields are required");
      return;
    }
    createTeamChannel.mutate(
      { githubTeamSlug: newSlug.trim(), slackChannel: newChannel.trim() },
      {
        onSuccess: () => {
          setNewSlug("");
          setNewChannel("");
          toast.success("Mapping added");
        },
        onError: () => toast.error("Failed to add mapping"),
      }
    );
  };

  const save = (id: number, update: { githubTeamSlug?: string; slackChannel?: string }) => {
    updateTeamChannel.mutate(
      { id, ...update },
      { onError: () => toast.error("Failed to update mapping") }
    );
  };

  const handleDelete = (id: number) => {
    deleteTeamChannel.mutate(id, {
      onError: () => toast.error("Failed to delete mapping"),
    });
  };

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <Card>
      <CardContent className="pt-6">
        {!data?.items.length ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            No team channel mappings configured
          </p>
        ) : (
          <Table className="mb-4">
            <TableHeader>
              <TableRow>
                <TableHead>GitHub Team Slug</TableHead>
                <TableHead>Slack Channel</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((tc) => (
                <TableRow key={tc.id}>
                  <TableCell>
                    <SaveOnBlurInput
                      className="h-7 text-sm font-mono w-48"
                      value={tc.githubTeamSlug}
                      onSave={(githubTeamSlug) => save(tc.id, { githubTeamSlug })}
                    />
                  </TableCell>
                  <TableCell>
                    <SaveOnBlurInput
                      className="h-7 text-sm font-mono w-48"
                      value={tc.slackChannel}
                      onSave={(slackChannel) => save(tc.id, { slackChannel })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(tc.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Add row */}
        <div className="flex items-center gap-2">
          <Input
            className="h-7 text-sm font-mono w-48"
            placeholder="team-backend"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          />
          <Input
            className="h-7 text-sm font-mono w-48"
            placeholder="#channel-name"
            value={newChannel}
            onChange={(e) => setNewChannel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          />
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!newSlug.trim() || !newChannel.trim() || createTeamChannel.isPending}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
