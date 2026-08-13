import { useEffect, useState } from "react";
import { useGitHubTeamsQuery } from "@/client/lib/queries/github-teams";
import { useSettingsQuery, useUpdateSetting } from "@/client/lib/queries/settings";
import { Card, CardContent } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Skeleton } from "@/client/components/ui/skeleton";
import { EmptyState } from "@/client/components/ui/empty-state";
import { toast } from "sonner";
import type { GitHubTeam } from "@/client/lib/types";

const SETTING_KEY = "codeowner_team_slugs";

/**
 * No stored value means every team counts, so the column works unconfigured.
 * Returns null for that case rather than a full list, so the meaning survives
 * teams being added or removed on GitHub later.
 */
function parseSelection(value: string | null | undefined): Set<string> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return null;
  }
}

function serialize(selection: Set<string>): string {
  return JSON.stringify([...selection].sort());
}

export function CodeownerTeamsForm() {
  const { data: teamsData, isLoading: teamsLoading, error } = useGitHubTeamsQuery();
  const { data: settings, isLoading: settingsLoading } = useSettingsQuery();
  const updateSetting = useUpdateSetting();

  const teams: GitHubTeam[] = teamsData?.items ?? [];
  const stored = parseSelection(settings?.[SETTING_KEY]);

  // An unset setting shows as everything checked — that's what it does.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    const fromSettings = parseSelection(settings?.[SETTING_KEY]);
    setSelected(fromSettings ?? new Set(teams.map((t) => t.slug)));
  }, [settings?.[SETTING_KEY], teamsData]);

  const dirty = serialize(selected) !== serialize(stored ?? new Set(teams.map((t) => t.slug)));

  const toggle = (slug: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(slug);
    else next.delete(slug);
    setSelected(next);
  };

  const handleSave = () => {
    updateSetting.mutate(
      { key: SETTING_KEY, value: serialize(selected) },
      {
        onSuccess: () => toast.success("Code owner teams saved"),
        onError: () => toast.error("Failed to save code owner teams"),
      },
    );
  };

  if (teamsLoading || settingsLoading) return <Skeleton className="h-24 w-full" />;

  if (error) {
    return (
      <EmptyState message="Could not read your GitHub teams — the token needs the read:org scope." />
    );
  }

  if (!teams.length) {
    return (
      <EmptyState message="No GitHub teams found for this token. It may be missing the read:org scope." />
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="space-y-2">
          {teams.map((team) => (
            <label
              key={`${team.org}/${team.slug}`}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <Checkbox
                checked={selected.has(team.slug)}
                onCheckedChange={(checked) => toggle(team.slug, !!checked)}
              />
              <span className="font-mono text-xs text-muted-foreground">{team.org}/</span>
              <span>{team.slug}</span>
            </label>
          ))}
        </div>

        {!selected.size && (
          <p className="text-sm text-amber-600 dark:text-amber-500">
            No teams selected — the Code Owners column will stay empty.
          </p>
        )}

        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={!dirty || updateSetting.isPending}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
