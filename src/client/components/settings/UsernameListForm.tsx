import { useEffect, useState } from "react";
import { useSettingsQuery, useUpdateSetting } from "@/client/lib/queries/settings";
import { Card, CardContent } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { TagInput } from "./TagInput";
import { toast } from "sonner";

function parseMembers(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

interface UsernameListFormProps {
  /** Settings key holding the JSON array of GitHub usernames. */
  settingKey: string;
  /** Plural noun used in the save toasts, e.g. "team members". */
  label: string;
}

export function UsernameListForm({ settingKey, label }: UsernameListFormProps) {
  const { data, isLoading } = useSettingsQuery();
  const updateSetting = useUpdateSetting();

  const stored = parseMembers(data?.[settingKey]);
  const [members, setMembers] = useState<string[]>(stored);

  useEffect(() => {
    setMembers(parseMembers(data?.[settingKey]));
  }, [data?.[settingKey]]);

  const dirty = JSON.stringify(members) !== JSON.stringify(stored);

  const handleSave = () => {
    updateSetting.mutate(
      { key: settingKey, value: JSON.stringify(members) },
      {
        onSuccess: () => toast.success(`${label[0].toUpperCase()}${label.slice(1)} saved`),
        onError: () => toast.error(`Failed to save ${label}`),
      },
    );
  };

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <TagInput
          tags={members}
          onChange={setMembers}
          placeholder="Add GitHub username and press Enter..."
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={!dirty || updateSetting.isPending}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
