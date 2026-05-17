import { expect, test, describe, mock, beforeEach } from "bun:test";
import { fetchLlms, hashContent, runCrawl } from "../crawl";

describe("hashContent", () => {
  test("returns a 64-char hex string", () => {
    const hash = hashContent("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  test("same content produces same hash", () => {
    expect(hashContent("test")).toBe(hashContent("test"));
  });

  test("different content produces different hash", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});

describe("fetchLlms", () => {
  beforeEach(() => {
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("maryland.gov")) {
        return new Response("# Maryland\n\n## Docs\n\n- [Site](https://maryland.gov)", { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as any;
  });

  test("returns found=true with content for 200 response", async () => {
    const result = await fetchLlms("https://www.maryland.gov");
    expect(result.found).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toContain("# Maryland");
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  test("returns found=false for 404 response", async () => {
    const result = await fetchLlms("https://www.alaska.gov");
    expect(result.found).toBe(false);
    expect(result.status).toBe(404);
    expect(result.content).toBeUndefined();
  });

  test("returns found=false on network error", async () => {
    globalThis.fetch = mock(async () => { throw new Error("network error"); }) as any;
    const result = await fetchLlms("https://www.broken.gov");
    expect(result.found).toBe(false);
    expect(result.status).toBe(0);
  });
});
