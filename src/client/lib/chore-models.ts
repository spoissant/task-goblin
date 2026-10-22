import type { SessionEffort, SessionModel } from "./types";
import { useSettingsQuery } from "./queries/settings";
import {
  CHORE_MODELS_KEY,
  parseChoreModelDefaults,
  resolveChoreModel,
  type ModelEffort,
} from "@/shared/chore-models";

export { CHORE_MODELS_KEY, type ChoreModelDefaults } from "@/shared/chore-models";

export const MODEL_LABELS: Record<SessionModel, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  fable: "Fable",
  haiku: "Haiku",
};

export const EFFORT_LABELS: Record<SessionEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** Default model and effort per chore key, stored as JSON in the `chore_models` setting. */
export function useChoreModelDefaults() {
  const { data } = useSettingsQuery();
  const stored = parseChoreModelDefaults(data?.[CHORE_MODELS_KEY]);

  const getDefault = (choreKey: string | undefined): ModelEffort => resolveChoreModel(stored, choreKey);

  return { stored, getDefault };
}
