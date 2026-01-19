import { useState, useEffect } from "react";
import { useSettingsQuery, useUpdateSetting } from "@/client/lib/queries";
import { Card, CardContent } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Skeleton } from "@/client/components/ui/skeleton";
import { toast } from "sonner";

export function GitHubConfigForm() {
  const { data: settings, isLoading } = useSettingsQuery();
  const updateSetting = useUpdateSetting();

  const [username, setUsername] = useState("");

  useEffect(() => {
    if (settings?.github_username) {
      setUsername(settings.github_username);
    }
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSetting.mutate(
      { key: "github_username", value: username || null },
      {
        onSuccess: () => {
          toast.success("GitHub configuration saved");
        },
        onError: () => {
          toast.error("Failed to save configuration");
        },
      }
    );
  };

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="github_username">GitHub Username</Label>
            <Input
              id="github_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your-github-username"
            />
            <p className="text-xs text-muted-foreground">
              Your GitHub username. Used to filter PRs when syncing.
            </p>
          </div>

          <Button type="submit" disabled={updateSetting.isPending}>
            {updateSetting.isPending ? "Saving..." : "Save Configuration"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
