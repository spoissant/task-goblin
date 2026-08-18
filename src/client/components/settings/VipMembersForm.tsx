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

export function VipMembersForm() {
  const { data, isLoading } = useSettingsQuery();
  const updateSetting = useUpdateSetting();

  const stored = parseMembers(data?.vip_members);
  const [members, setMembers] = useState<string[]>(stored);

  useEffect(() => {
    setMembers(parseMembers(data?.vip_members));
  }, [data?.vip_members]);

  const dirty = JSON.stringify(members) !== JSON.stringify(stored);

  const handleSave = () => {
    updateSetting.mutate(
      { key: "vip_members", value: JSON.stringify(members) },
      {
        onSuccess: () => toast.success("VIPs saved"),
        onError: () => toast.error("Failed to save VIPs"),
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
