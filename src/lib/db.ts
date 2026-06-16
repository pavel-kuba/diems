import Database from "better-sqlite3";
import { join } from "node:path";

// Server-only SQLite handle (companies imported via scripts/import-companies.mjs).
// Cached across hot reloads in dev so we don't reopen the file each request.
const globalForDb = globalThis as unknown as { _monitoringDb?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb._monitoringDb) {
    const file = join(process.cwd(), "data", "monitoring.db");
    const db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma("journal_mode = WAL");
    globalForDb._monitoringDb = db;
  }
  return globalForDb._monitoringDb;
}

export type CompanyRow = {
  id: number;
  name: string;
  website: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  description: string | null;
  market: string;
  detail_url: string | null;
};
