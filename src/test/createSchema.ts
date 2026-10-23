/**
 * Creates the test tables with the DDL drizzle-kit generates from the Drizzle
 * schema, indexes and foreign keys included, so tests always run against the
 * app's real schema.
 */
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import * as schema from "../db/schema";

// drizzle-kit's API is async: build the DDL once, at import, so createTestTables stays synchronous.
const statements = await generateSQLiteMigration(
  await generateSQLiteDrizzleJson({}),
  await generateSQLiteDrizzleJson(schema),
);

// Test files share one in-memory DB, so creating the tables again must be a no-op.
const ddl = statements
  .map((statement) => statement.replace(/^CREATE (UNIQUE )?(TABLE|INDEX) /, "CREATE $1$2 IF NOT EXISTS "))
  .join("\n");

/** Creates every table and index of the schema that the database doesn't have yet. */
export function createTestTables(sqlite: { run: (sql: string) => unknown }): void {
  sqlite.run(ddl);
}
