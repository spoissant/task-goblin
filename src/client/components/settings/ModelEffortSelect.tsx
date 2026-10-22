import type { ComponentProps } from "react";
import { SESSION_EFFORTS, SESSION_MODELS, type SessionEffort, type SessionModel } from "@/client/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

const MODEL_LABELS: Record<SessionModel, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  fable: "Fable",
  haiku: "Haiku",
};

const EFFORT_LABELS: Record<SessionEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** The value and its handler; id, className and aria-label go to the trigger. */
type ChoiceSelectProps<T extends string> = Pick<ComponentProps<typeof SelectTrigger>, "id" | "className" | "aria-label"> & {
  value: T;
  onValueChange: (value: T) => void;
};

function ChoiceSelect<T extends string>({
  options,
  labels,
  value,
  onValueChange,
  ...triggerProps
}: ChoiceSelectProps<T> & { options: readonly T[]; labels: Record<T, string> }) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as T)}>
      <SelectTrigger {...triggerProps}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {labels[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ModelSelect(props: ChoiceSelectProps<SessionModel>) {
  return <ChoiceSelect options={SESSION_MODELS} labels={MODEL_LABELS} {...props} />;
}

export function EffortSelect(props: ChoiceSelectProps<SessionEffort>) {
  return <ChoiceSelect options={SESSION_EFFORTS} labels={EFFORT_LABELS} {...props} />;
}
