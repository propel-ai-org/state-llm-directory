import { createHash } from "crypto";
import { openDb, insertRun, insertResult } from "./db";
import { ENTITIES } from "./states";

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface FetchResult {
  found: boolean;
  status: number;
  content?: string;
  ms: number;
}

export async function fetchLlms(baseUrl: string): Promise<FetchResult> {
  const start = Date.now();
  try {
    const resp = await fetch(`${baseUrl}/llms.txt`, {
      headers: { "User-Agent": "llms-tracker/1.0 (+research)" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const ms = Date.now() - start;
    if (resp.ok) {
      const content = await resp.text();
      return { found: true, status: resp.status, content, ms };
    }
    return { found: false, status: resp.status, ms };
  } catch {
    return { found: false, status: 0, ms: Date.now() - start };
  }
}

async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function runCrawl(): Promise<{ runId: number; found: number; total: number }> {
  const db = openDb();
  const runId = insertRun(db);
  let found = 0;

  await withConcurrency(ENTITIES, 10, async (entity) => {
    const result = await fetchLlms(entity.url);
    insertResult(db, {
      runId,
      slug: entity.slug,
      name: entity.name,
      type: entity.type,
      url: entity.url,
      found: result.found,
      httpStatus: result.status,
      content: result.content,
      contentHash: result.content ? hashContent(result.content) : undefined,
      fetchedMs: result.ms,
    });
    if (result.found) found++;
    process.stdout.write(result.found ? `  ✓ ${entity.name}\n` : `  · ${entity.name}\n`);
  });

  db.close();
  return { runId, found, total: ENTITIES.length };
}

// Only run when executed directly
if (import.meta.main) {
  console.log("Starting crawl...\n");
  const { runId, found, total } = await runCrawl();
  console.log(`\nRun #${runId} complete: ${found}/${total} have llms.txt`);
}
