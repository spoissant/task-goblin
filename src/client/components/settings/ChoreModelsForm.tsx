import { toast } from "sonner";
import { SESSION_EFFORTS, SESSION_MODELS, type SessionEffort, type SessionModel } from "@/client/lib/types";
import { useChoreDefinitionsQuery } from "@/client/lib/queries/chores";
import { useUpdateSetting } from "@/client/lib/queries/settings";
import {
  CHORE_MODELS_KEY,
  EFFORT_LABELS,
  MODEL_LABELS,
  useChoreModelDefaults,
  type ChoreModelDefaults,
} from "@/client/lib/chore-models";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
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
                <Select value={current.model} onValueChange={(v) => save(chore.key, { model: v as SessionModel })}>
                  <SelectTrigger className="w-32" aria-label={`${chore.name} model`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {MODEL_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select value={current.effort} onValueChange={(v) => save(chore.key, { effort: v as SessionEffort })}>
                  <SelectTrigger className="w-32" aria-label={`${chore.name} effort`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_EFFORTS.map((e) => (
                      <SelectItem key={e} value={e}>
                        {EFFORT_LABELS[e]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
