import { expect, test, describe, beforeEach } from "bun:test";
import {
  openDb, insertRun, insertResult, getAllRuns,
  getRunResults, getLatestRunId, getPreviousRunId, getEntityHistory,
} from "../db";
import type { Database } from "bun:sqlite";

describe("db", () => {
  let db: Database;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  test("insertRun returns a positive integer id", () => {
    const id = insertRun(db);
    expect(id).toBeGreaterThan(0);
  });

  test("consecutive insertRun calls return different ids", () => {
    const id1 = insertRun(db);
    const id2 = insertRun(db);
    expect(id1).not.toBe(id2);
  });

  test("insertResult stores a found result", () => {
    const runId = insertRun(db);
    insertResult(db, {
      runId, slug: "maryland", name: "Maryland", type: "state",
      url: "https://www.maryland.gov", found: true,
      httpStatus: 200, content: "# Maryland", contentHash: "abc123", fetchedMs: 150,
    });
    const rows = getRunResults(db, runId);
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe("maryland");
    expect(rows[0].found).toBe(1);
    expect(rows[0].content).toBe("# Maryland");
  });

  test("insertResult stores a not-found result", () => {
    const runId = insertRun(db);
    insertResult(db, {
      runId, slug: "alaska", name: "Alaska", type: "state",
      url: "https://www.alaska.gov", found: false,
      httpStatus: 404, fetchedMs: 80,
    });
    const rows = getRunResults(db, runId);
    expect(rows[0].found).toBe(0);
    expect(rows[0].content).toBeNull();
  });

  test("getLatestRunId returns null when no runs exist", () => {
    expect(getLatestRunId(db)).toBeNull();
  });

  test("getLatestRunId returns the most recently inserted run", () => {
    insertRun(db);
    const id2 = insertRun(db);
    expect(getLatestRunId(db)).toBe(id2);
  });

  test("getPreviousRunId returns null for first run", () => {
    const id = insertRun(db);
    expect(getPreviousRunId(db, id)).toBeNull();
  });

  test("getPreviousRunId returns run immediately before given run", () => {
    const id1 = insertRun(db);
    const id2 = insertRun(db);
    const id3 = insertRun(db);
    expect(getPreviousRunId(db, id3)).toBe(id2);
    expect(getPreviousRunId(db, id2)).toBe(id1);
  });

  test("getAllRuns returns runs in descending order", () => {
    insertRun(db);
    insertRun(db);
    insertRun(db);
    const runs = getAllRuns(db);
    expect(runs).toHaveLength(3);
    expect(runs[0].id).toBeGreaterThan(runs[1].id);
  });

  test("getEntityHistory returns one entry per run", () => {
    const id1 = insertRun(db);
    insertResult(db, { runId: id1, slug: "maryland", name: "Maryland", type: "state", url: "https://www.maryland.gov", found: true, httpStatus: 200, contentHash: "hash_v1" });
    const id2 = insertRun(db);
    insertResult(db, { runId: id2, slug: "maryland", name: "Maryland", type: "state", url: "https://www.maryland.gov", found: true, httpStatus: 200, contentHash: "hash_v2" });
    const history = getEntityHistory(db, "maryland");
    expect(history).toHaveLength(2);
    expect(history[0].run_id).toBe(id1);
    expect(history[0].content_hash).toBe("hash_v1");
    expect(history[1].run_id).toBe(id2);
    expect(history[1].content_hash).toBe("hash_v2");
  });
});
