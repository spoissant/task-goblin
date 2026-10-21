import { CHORE_MODELS_KEY, parseChoreModelDefaults, type ChoreModelDefaults } from "@/shared/chore-models";
import { getSetting } from "./settings";

/** The per-chore model and effort defaults the Settings page stores. */
export async function getChoreModelDefaults(): Promise<ChoreModelDefaults> {
  return parseChoreModelDefaults(await getSetting(CHORE_MODELS_KEY));
}
