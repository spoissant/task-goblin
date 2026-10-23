import { Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { AUTO_CHORES_SETTING } from "@/shared/settings-keys";
import { useSettingsQuery, useUpdateSetting } from "@/client/lib/queries/settings";

/** Play/stop for the periodic sync pass and the chore scheduler's auto starts. */
export function AutoChoresToggle() {
  const { data } = useSettingsQuery();
  const update = useUpdateSetting();
  const enabled = data?.[AUTO_CHORES_SETTING] !== "false";

  const toggle = () =>
    update.mutate(
      { key: AUTO_CHORES_SETTING, value: enabled ? "false" : "true" },
      { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save") },
    );

  return (
    <Button
      variant="outline"
      size="icon"
      disabled={!data || update.isPending}
      onClick={toggle}
      title={enabled ? "Auto sync and chores running. Click to stop" : "Auto sync and chores stopped. Click to start"}
      aria-label={enabled ? "Stop auto chores" : "Start auto chores"}
    >
      {enabled ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </Button>
  );
}
