import { expect, test, describe } from "bun:test";
import { parseLlms } from "../parse";

describe("parseLlms", () => {
  test("parses title from first h1", () => {
    const result = parseLlms("# Maryland\n");
    expect(result.title).toBe("Maryland");
  });

  test("returns Untitled when no h1 present", () => {
    const result = parseLlms("");
    expect(result.title).toBe("Untitled");
  });

  test("parses blockquote as description", () => {
    const result = parseLlms("# State\n\n> Official state website\n");
    expect(result.description).toBe("Official state website");
  });

  test("description is undefined when no blockquote", () => {
    const result = parseLlms("# State\n");
    expect(result.description).toBeUndefined();
  });

  test("parses sections with named headings", () => {
    const result = parseLlms("# State\n\n## Docs\n\n## APIs\n");
    expect(result.sections.map(s => s.name)).toEqual(["Docs", "APIs"]);
  });

  test("parses links with description", () => {
    const content = "# State\n\n## Docs\n\n- [Budget](https://example.gov/budget): Annual budget\n";
    const result = parseLlms(content);
    expect(result.sections[0].links[0]).toEqual({
      text: "Budget",
      url: "https://example.gov/budget",
      description: "Annual budget",
    });
  });

  test("parses links without description", () => {
    const content = "# State\n\n## Docs\n\n- [Laws](https://example.gov/laws)\n";
    const result = parseLlms(content);
    expect(result.sections[0].links[0]).toEqual({
      text: "Laws",
      url: "https://example.gov/laws",
      description: undefined,
    });
  });

  test("parses multiple links per section", () => {
    const content = "# State\n\n## Docs\n\n- [A](https://a.gov): First\n- [B](https://b.gov): Second\n";
    const result = parseLlms(content);
    expect(result.sections[0].links).toHaveLength(2);
  });

  test("links belong to their section, not previous", () => {
    const content = "# State\n\n## Alpha\n\n- [A](https://a.gov)\n\n## Beta\n\n- [B](https://b.gov)\n";
    const result = parseLlms(content);
    expect(result.sections[0].links[0].text).toBe("A");
    expect(result.sections[1].links[0].text).toBe("B");
  });
});
