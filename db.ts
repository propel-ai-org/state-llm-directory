import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";

const DATA_DIR = process.env.LLMS_TRACKER_DATA_DIR ?? join(import.meta.dir, "data");

export function openDb(path?: string): Database {
  if (!path || path !== ":memory:") {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new Database(path ?? join(DATA_DIR, "tracker.db"));
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      found INTEGER NOT NULL,
      http_status INTEGER,
      content TEXT,
      content_hash TEXT,
      fetched_ms INTEGER
    )
  `);
  return db;
}

export function insertRun(db: Database): number {
  const stmt = db.prepare("INSERT INTO runs (ran_at) VALUES (?) RETURNING id");
  const row = stmt.get(new Date().toISOString()) as { id: number };
  return row.id;
}

export interface ResultInput {
  runId: number;
  slug: string;
  name: string;
  type: string;
  url: string;
  found: boolean;
  httpStatus?: number;
  content?: string;
  contentHash?: string;
  fetchedMs?: number;
}

export function insertResult(db: Database, r: ResultInput): void {
  db.run(
    `INSERT INTO results
       (run_id, slug, name, type, url, found, http_status, content, content_hash, fetched_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.runId, r.slug, r.name, r.type, r.url,
      r.found ? 1 : 0,
      r.httpStatus ?? null,
      r.content ?? null,
      r.contentHash ?? null,
      r.fetchedMs ?? null,
    ]
  );
}

export interface RunRow { id: number; ran_at: string }
export interface ResultRow {
  id: number; run_id: number; slug: string; name: string;
  type: string; url: string; found: number; http_status: number | null;
  content: string | null; content_hash: string | null; fetched_ms: number | null;
}
export interface HistoryRow {
  run_id: number; ran_at: string; found: number; content_hash: string | null;
}

export function getAllRuns(db: Database): RunRow[] {
  return db.query("SELECT id, ran_at FROM runs ORDER BY id DESC").all() as RunRow[];
}

export function getRunResults(db: Database, runId: number): ResultRow[] {
  return db.query("SELECT * FROM results WHERE run_id = ? ORDER BY slug").all(runId) as ResultRow[];
}

export function getLatestRunId(db: Database): number | null {
  const row = db.query("SELECT id FROM runs ORDER BY id DESC LIMIT 1").get() as { id: number } | null;
  return row?.id ?? null;
}

export function getPreviousRunId(db: Database, currentRunId: number): number | null {
  const row = db.query(
    "SELECT id FROM runs WHERE id < ? ORDER BY id DESC LIMIT 1"
  ).get(currentRunId) as { id: number } | null;
  return row?.id ?? null;
}

export function getEntityHistory(db: Database, slug: string): HistoryRow[] {
  return db.query(`
    SELECT r.id AS run_id, r.ran_at, COALESCE(res.found, 0) AS found, res.content_hash
    FROM runs r
    LEFT JOIN results res ON res.run_id = r.id AND res.slug = ?
    ORDER BY r.ran_at ASC
  `).all(slug) as HistoryRow[];
}
