import { eq } from "drizzle-orm";
import { db } from "../../db";
import { settings } from "../../db/schema";

export async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** A "true"/"false" setting; anything unset or unrecognised is the fallback. */
export async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  const value = await getSetting(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}
