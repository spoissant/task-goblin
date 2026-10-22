import { parseJson } from "./json";
import { SESSION_EFFORTS, SESSION_MODELS, type SessionEffort, type SessionModel } from "./types";

/** Settings key holding the default model and effort per chore, as JSON. */
export const CHORE_MODELS_KEY = "chore_models";

export interface ModelEffort {
  model: SessionModel;
  effort: SessionEffort;
}

const FALLBACK_MODEL_EFFORT: ModelEffort = { model: "sonnet", effort: "high" };

export type ChoreModelDefaults = Record<string, Partial<ModelEffort>>;

export function parseChoreModelDefaults(value: string | null | undefined): ChoreModelDefaults {
  return parseJson<ChoreModelDefaults>(value, {});
}

/** The model and effort a chore runs with: its stored entry, else the fallback. */
export function resolveChoreModel(defaults: ChoreModelDefaults, choreKey: string | undefined): ModelEffort {
  const entry = choreKey ? defaults[choreKey] : undefined;
  return {
    model: entry?.model && SESSION_MODELS.includes(entry.model) ? entry.model : FALLBACK_MODEL_EFFORT.model,
    effort: entry?.effort && SESSION_EFFORTS.includes(entry.effort) ? entry.effort : FALLBACK_MODEL_EFFORT.effort,
  };
}
