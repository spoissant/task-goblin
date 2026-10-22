import { toast } from "sonner";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { useSettingsQuery, useUpdateSetting } from "@/client/lib/queries/settings";
import { AUTO_CHORES_SETTING } from "@/shared/settings-keys";

/** The chore scheduler's switch; unset means enabled. */
export function AutoChoresForm() {
  const { data } = useSettingsQuery();
  const update = useUpdateSetting();
  const enabled = data?.[AUTO_CHORES_SETTING] !== "false";

  const toggle = (checked: boolean) =>
    update.mutate(
      { key: AUTO_CHORES_SETTING, value: checked ? "true" : "false" },
      { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save") },
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox id="auto-chores" checked={enabled} onCheckedChange={(c) => toggle(!!c)} disabled={!data || update.isPending} />
        <Label htmlFor="auto-chores" className="cursor-pointer text-sm">
          Start matching chores automatically
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Also toggled by the play/stop button on the Tasks page. Start New Task always stays manual.
      </p>
    </div>
  );
}
