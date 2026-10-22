import { useSettingsQuery } from "./queries/settings";
import {
  CHORE_MODELS_KEY,
  parseChoreModelDefaults,
  resolveChoreModel,
  type ModelEffort,
} from "@/shared/chore-models";

/** Default model and effort per chore key, stored as JSON in the `chore_models` setting. */
export function useChoreModelDefaults() {
  const { data } = useSettingsQuery();
  const stored = parseChoreModelDefaults(data?.[CHORE_MODELS_KEY]);

  const getDefault = (choreKey: string | undefined): ModelEffort => resolveChoreModel(stored, choreKey);

  return { stored, getDefault };
}
