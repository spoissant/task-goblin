import { toast } from "sonner";
import type { SessionEffort, SessionModel } from "@/shared/types";
import { useChoreDefinitionsQuery } from "@/client/lib/queries/chores";
import { useUpdateSetting } from "@/client/lib/queries/settings";
import { useChoreModelDefaults } from "@/client/lib/chore-models";
import { CHORE_MODELS_KEY, type ChoreModelDefaults } from "@/shared/chore-models";
import { EffortSelect, ModelSelect } from "./ModelEffortSelect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";

export function ChoreModelsForm() {
  const { data } = useChoreDefinitionsQuery();
  const { stored, getDefault } = useChoreModelDefaults();
  const update = useUpdateSetting();

  const save = (choreKey: string, patch: { model?: SessionModel; effort?: SessionEffort }) => {
    const next: ChoreModelDefaults = { ...stored, [choreKey]: { ...getDefault(choreKey), ...patch } };
    update.mutate(
      { key: CHORE_MODELS_KEY, value: JSON.stringify(next) },
      { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save") },
    );
  };

  // Reviewing a colleague's PR from the Reviews page and custom prompts are not numbered chores.
  const rows = [
    ...(data?.items ?? []).map((chore) => ({ key: chore.key, name: chore.name, label: `#${chore.number} ${chore.name}` })),
    { key: "review-pr", name: "Code review", label: "Code review (colleague PR)" },
    { key: "custom", name: "Custom prompt", label: "Custom prompt" },
  ];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-full">Chore</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Effort</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((chore) => {
          const current = getDefault(chore.key);
          return (
            <TableRow key={chore.key}>
              <TableCell>{chore.label}</TableCell>
              <TableCell>
                <ModelSelect
                  value={current.model}
                  onValueChange={(model) => save(chore.key, { model })}
                  className="w-32"
                  aria-label={`${chore.name} model`}
                />
              </TableCell>
              <TableCell>
                <EffortSelect
                  value={current.effort}
                  onValueChange={(effort) => save(chore.key, { effort })}
                  className="w-32"
                  aria-label={`${chore.name} effort`}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
