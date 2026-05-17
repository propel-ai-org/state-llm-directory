# llms.txt State Tracker

Tracks adoption of [llms.txt](https://llmstxt.org) across US states, DC, and territories over time.

## Usage

```bash
# Run a crawl (adds a new snapshot to the database)
bun crawl.ts

# Open the viewer
bun serve.ts
# → http://localhost:3131
```

## Stack

- **Bun** — runtime, SQLite, HTTP server, test runner
- **TypeScript** — server-side
- **Vanilla JS** — frontend (no framework, no build step)
- **No build step**

## Data

Results stored in `data/tracker.db` (SQLite). Each `bun crawl.ts` run adds a new snapshot — historical data accumulates automatically. Run history is visualized in the adoption timeline chart.

## Tests

```bash
bun test
```
