import { join } from "path";
import { openDb, getAllRuns, getRunResults, getLatestRunId, getPreviousRunId, getEntityHistory } from "./db";
import { ENTITIES } from "./states";

const PUBLIC = join(import.meta.dir, "public");
const db = openDb();
let crawlInProgress = false;

function buildApiResponse(runId: number | null) {
  const runs = getAllRuns(db);
  if (!runId) runId = getLatestRunId(db);
  if (!runId) return { runs: [], entities: [], summary: { total: 0, found: 0, prev_found: 0 } };

  const prevRunId = getPreviousRunId(db, runId);
  const currentResults = getRunResults(db, runId);
  const prevResults = prevRunId ? getRunResults(db, prevRunId) : [];

  const currentBySlug = Object.fromEntries(currentResults.map(r => [r.slug, r]));
  const prevBySlug = Object.fromEntries(prevResults.map(r => [r.slug, r]));

  const entities = ENTITIES.map(entity => {
    const cur = currentBySlug[entity.slug];
    const prev = prevBySlug[entity.slug];
    const history = getEntityHistory(db, entity.slug);

    const firstSeenRun = history.find(h => h.found);
    const firstSeenAt = firstSeenRun
      ? runs.find(r => r.id === firstSeenRun.run_id)?.ran_at
      : undefined;

    const changed = !!(cur?.found && prev?.found && cur.content_hash !== prev.content_hash);

    return {
      slug: entity.slug,
      name: entity.name,
      type: entity.type,
      url: entity.url,
      history: history.map(h => ({
        run_id: h.run_id,
        ran_at: runs.find(r => r.id === h.run_id)?.ran_at ?? "",
        found: !!h.found,
        content_hash: h.content_hash,
      })),
      current: {
        found: !!cur?.found,
        content: cur?.content ?? null,
        prev_content: prev?.content ?? null,
        changed,
        http_status: cur?.http_status ?? null,
        fetched_ms: cur?.fetched_ms ?? null,
        first_seen_at: firstSeenAt ?? null,
      },
    };
  });

  const found = entities.filter(e => e.current.found).length;
  const prevFound = prevRunId
    ? prevResults.filter(r => r.found).length
    : 0;

  return {
    runs,
    current_run_id: runId,
    entities,
    summary: {
      total: ENTITIES.length,
      found,
      prev_found: prevFound,
      newly_added: entities
        .filter(e => e.current.found && prevRunId && !prevBySlug[e.slug]?.found)
        .map(e => e.name),
    },
  };
}

async function serveStatic(path: string): Promise<Response> {
  const resolved = join(PUBLIC, path);
  if (!resolved.startsWith(PUBLIC + "/") && resolved !== PUBLIC) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(resolved);
  if (await file.exists()) {
    return new Response(file);
  }
  return new Response("Not found", { status: 404 });
}

const server = Bun.serve({
  port: 3131,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveStatic("index.html");
    }

    if (url.pathname === "/api/data") {
      const runIdParam = url.searchParams.get("run_id");
      if (runIdParam !== null && !/^\d+$/.test(runIdParam)) {
        return new Response("Invalid run_id", { status: 400 });
      }
      const runId = runIdParam ? Number(runIdParam) : null;
      const data = buildApiResponse(runId);
      return Response.json(data);
    }

    if (url.pathname === "/api/crawl" && req.method === "POST") {
      if (crawlInProgress) {
        return Response.json({ ok: false, message: "Crawl already in progress" }, { status: 409 });
      }
      crawlInProgress = true;
      const proc = Bun.spawn(["bun", join(import.meta.dir, "crawl.ts")], {
        stdout: "inherit",
        stderr: "inherit",
      });
      proc.exited.then(() => { crawlInProgress = false; });
      return Response.json({ ok: true, message: "Crawl started in background" });
    }

    // Serve other static files (style.css, app.js)
    return serveStatic(url.pathname.slice(1));
  },
});

console.log(`Serving at http://localhost:${server.port}`);
