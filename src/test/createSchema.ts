/**
 * Generates CREATE TABLE SQL from Drizzle schema definitions.
 * This ensures tests always use the same schema as the actual app.
 */
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";

interface ColumnConfig {
  name: string;
  primary: boolean;
  autoIncrement?: boolean;
  notNull: boolean;
  hasDefault: boolean;
  default?: unknown;
  isUnique: boolean;
  getSQLType: () => string;
}

function generateCreateTable(table: SQLiteTable): string {
  const config = getTableConfig(table);
  const columns: string[] = [];

  for (const col of config.columns) {
    const c = col as unknown as ColumnConfig;
    let colDef = `${c.name} ${c.getSQLType()}`;

    if (c.primary) {
      colDef += " PRIMARY KEY";
      if (c.autoIncrement) {
        colDef += " AUTOINCREMENT";
      }
    }

    if (c.notNull && !c.primary) {
      colDef += " NOT NULL";
    }

    if (c.hasDefault && c.default !== undefined) {
      const defaultVal = c.default;
      if (typeof defaultVal === "string") {
        colDef += ` DEFAULT '${defaultVal}'`;
      } else {
        colDef += ` DEFAULT ${defaultVal}`;
      }
    }

    if (c.isUnique) {
      colDef += " UNIQUE";
    }

    columns.push(colDef);
  }

  return `CREATE TABLE IF NOT EXISTS ${config.name} (\n  ${columns.join(",\n  ")}\n);`;
}

/**
 * Generates all CREATE TABLE statements for the test database.
 * Tables are ordered to handle foreign key dependencies.
 */
export function generateTestSchema(): string {
  const tables: SQLiteTable[] = [
    // Order matters for foreign key references
    schema.settings,
    schema.repositories,
    schema.tasks,
    schema.todos,
    schema.blockedBy,
    schema.logs,
  ];

  return tables.map((table) => generateCreateTable(table)).join("\n\n");
}

/**
 * Creates all tables in the given SQLite database.
 */
export function createTestTables(sqlite: { exec: (sql: string) => void }): void {
  sqlite.exec(generateTestSchema());
}
