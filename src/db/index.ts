import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import * as relations from "./relations";

const dbPath = process.env.DATABASE_URL ?? "task-goblin.db";
const sqlite = new Database(dbPath);

if (dbPath !== ":memory:") {
  sqlite.exec("PRAGMA journal_mode = WAL;");
}

export const db = drizzle(sqlite, { schema: { ...schema, ...relations } });
export { schema, sqlite };
