import { SESSION_EFFORTS, SESSION_MODELS, type SessionEffort, type SessionModel } from "./types";
import { useSettingsQuery } from "./queries/settings";

export const CHORE_MODELS_KEY = "chore_models";

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

export interface ModelEffort {
  model: SessionModel;
  effort: SessionEffort;
}

export const FALLBACK_MODEL_EFFORT: ModelEffort = { model: "sonnet", effort: "high" };

export type ChoreModelDefaults = Record<string, Partial<ModelEffort>>;

function parseDefaults(value: string | null | undefined): ChoreModelDefaults {
  if (!value) return {};
  try {
    return JSON.parse(value) as ChoreModelDefaults;
  } catch {
    return {};
  }
}

/** Default model and effort per chore key, stored as JSON in the `chore_models` setting. */
export function useChoreModelDefaults() {
  const { data, isLoading } = useSettingsQuery();
  const stored = parseDefaults(data?.[CHORE_MODELS_KEY]);

  const getDefault = (choreKey: string | undefined): ModelEffort => {
    const entry = choreKey ? stored[choreKey] : undefined;
    return {
      model: entry?.model && SESSION_MODELS.includes(entry.model) ? entry.model : FALLBACK_MODEL_EFFORT.model,
      effort: entry?.effort && SESSION_EFFORTS.includes(entry.effort) ? entry.effort : FALLBACK_MODEL_EFFORT.effort,
    };
  };

  return { stored, getDefault, isLoading };
}
