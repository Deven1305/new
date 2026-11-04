import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { MIGRATIONS } from "./migrations.js";

/** The only database surface the app uses: parameterised SQL. Works on PGlite (local) and PostgreSQL (production). */
export interface Db {
  kind: "pglite" | "postgres";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function pgliteDb(instance: PGlite | Parameters<Parameters<PGlite["transaction"]>[0]>[0], kind: "pglite" = "pglite"): Db {
  const q: Db = {
    kind,
    async query<T>(sql: string, params: unknown[] = []) {
      return (await instance.query<T>(sql, params as unknown[])).rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      return ((await instance.query<T>(sql, params as unknown[])).rows[0] as T | undefined) ?? null;
    },
    async exec(sql: string) {
      await instance.exec(sql);
    },
    async tx<T>(fn: (d: Db) => Promise<T>) {
      if (!(instance instanceof PGlite)) return fn(q);
      return instance.transaction((t) => fn(pgliteDb(t)));
    },
    async close() {
      if (instance instanceof PGlite) await instance.close();
    },
  };
  return q;
}

function postgresDb(pool: pg.Pool, client?: pg.PoolClient): Db {
  const runner = client ?? pool;
  const q: Db = {
    kind: "postgres",
    async query<T>(sql: string, params: unknown[] = []) {
      return (await runner.query(sql, params)).rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      return ((await runner.query(sql, params)).rows[0] as T | undefined) ?? null;
    },
    async exec(sql: string) {
      await runner.query(sql);
    },
    async tx<T>(fn: (d: Db) => Promise<T>) {
      if (client) return fn(q);
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const out = await fn(postgresDb(pool, c));
        await c.query("COMMIT");
        return out;
      } catch (err) {
        await c.query("ROLLBACK");
        throw err;
      } finally {
        c.release();
      }
    },
    async close() {
      if (!client) await pool.end();
    },
  };
  return q;
}

export async function openDb(opts: { databaseUrl?: string; dataDir?: string; memory?: boolean }): Promise<Db> {
  let db: Db;
  if (opts.databaseUrl) db = postgresDb(new pg.Pool({ connectionString: opts.databaseUrl, max: 10 }));
  else if (opts.memory) db = pgliteDb(new PGlite());
  else {
    const dir = join(opts.dataDir ?? ".data", "pglite");
    mkdirSync(dir, { recursive: true });
    db = pgliteDb(new PGlite(dir));
  }
  await migrate(db);
  return db;
}

export async function migrate(db: Db): Promise<void> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const m of MIGRATIONS) {
    const done = await db.one("SELECT version FROM schema_migrations WHERE version = $1", [m.version]);
    if (done) continue;
    await db.tx(async (t) => {
      await t.exec(m.sql);
      await t.query("INSERT INTO schema_migrations (version) VALUES ($1)", [m.version]);
    });
  }
}
