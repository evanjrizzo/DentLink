import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { D1DatabaseLike, D1PreparedStatement, D1Result } from "./d1-storage";
import type { ExecFileSyncOptions } from "node:child_process";

type Primitive = string | number | null;

export class SqliteD1TestDatabase implements D1DatabaseLike {
  readonly path: string;
  private readonly directory: string;

  constructor(schemaPath: string | string[]) {
    this.directory = mkdtempSync(join(tmpdir(), "dentlink-d1-"));
    this.path = join(this.directory, "test.db");
    for (const path of Array.isArray(schemaPath) ? schemaPath : [schemaPath]) {
      execFileSync("sqlite3", [this.path, `.read ${path}`], sqliteOptions());
    }
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqliteD1PreparedStatement(this.path, sql);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>> {
    const results: Array<D1Result<T>> = [];
    for (const statement of statements) {
      results.push(await statement.run<T>());
    }
    return results;
  }

  dispose(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }
}

class SqliteD1PreparedStatement implements D1PreparedStatement {
  private values: Primitive[] = [];

  constructor(
    private readonly dbPath: string,
    private readonly sql: string
  ) {}

  bind(...values: Primitive[]): D1PreparedStatement {
    const statement = new SqliteD1PreparedStatement(this.dbPath, this.sql);
    statement.values = values;
    return statement;
  }

  async first<T = unknown>(): Promise<T | null> {
    const results = await this.all<T>();
    return results.results?.[0] ?? null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const output = execFileSync(
      "sqlite3",
      ["-json", this.dbPath, materializeSql(this.sql, this.values)],
      {
        ...sqliteOptions()
      }
    ).toString();
    return { success: true, results: output.trim() ? (JSON.parse(output) as T[]) : [] };
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const sql = `${materializeSql(this.sql, this.values)}; SELECT changes() AS changes;`;
    const output = execFileSync("sqlite3", ["-json", this.dbPath, sql], sqliteOptions()).toString();
    const rows = output.trim() ? (JSON.parse(output) as Array<{ changes?: number }>) : [];
    return { success: true, meta: { changes: rows.at(-1)?.changes ?? 0 } };
  }
}

function sqliteOptions(): ExecFileSyncOptions {
  return { timeout: 5000, stdio: ["ignore", "pipe", "pipe"] };
}

function materializeSql(sql: string, values: Primitive[]): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    const value = values[index++];
    if (value === undefined) throw new Error("Missing SQL bind value");
    if (value === null) return "NULL";
    if (typeof value === "number") return String(value);
    return `'${value.replaceAll("'", "''")}'`;
  });
}
