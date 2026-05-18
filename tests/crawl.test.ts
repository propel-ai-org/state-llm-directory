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

  test("rejects HTML response with text/html Content-Type", async () => {
    globalThis.fetch = mock(async () =>
      new Response("<html><body>oops</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" },
      })
    ) as any;
    const result = await fetchLlms("https://www.ct.gov");
    expect(result.found).toBe(false);
    expect(result.content).toBeUndefined();
  });

  test("rejects body starting with <!DOCTYPE even with no Content-Type", async () => {
    globalThis.fetch = mock(async () =>
      new Response("<!DOCTYPE html>\n<html>fake</html>", { status: 200 })
    ) as any;
    const result = await fetchLlms("https://www.example.gov");
    expect(result.found).toBe(false);
  });

  test("rejects body starting with <html>", async () => {
    globalThis.fetch = mock(async () =>
      new Response("<html><head></head></html>", { status: 200 })
    ) as any;
    const result = await fetchLlms("https://www.example.gov");
    expect(result.found).toBe(false);
  });

  test("rejects when redirect lands on a different path", async () => {
    globalThis.fetch = mock(async (url: string) => {
      const r = new Response("# Homepage as markdown somehow", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      });
      Object.defineProperty(r, "url", { value: "https://www.nm.gov/" });
      return r;
    }) as any;
    const result = await fetchLlms("https://www.newmexico.gov");
    expect(result.found).toBe(false);
  });

  test("accepts text/markdown response that stayed on /llms.txt", async () => {
    globalThis.fetch = mock(async () => {
      const r = new Response("# Maryland.gov\n\n## Docs", {
        status: 200,
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
      Object.defineProperty(r, "url", { value: "https://www.maryland.gov/llms.txt" });
      return r;
    }) as any;
    const result = await fetchLlms("https://www.maryland.gov");
    expect(result.found).toBe(true);
    expect(result.content).toContain("# Maryland");
  });

  test("accepts text/plain response", async () => {
    globalThis.fetch = mock(async () => {
      const r = new Response("# mysite\n\n> The American Samoa Government", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
      Object.defineProperty(r, "url", { value: "https://www.americansamoa.gov/llms.txt" });
      return r;
    }) as any;
    const result = await fetchLlms("https://www.americansamoa.gov");
    expect(result.found).toBe(true);
  });
});
