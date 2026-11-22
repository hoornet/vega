import { describe, it, expect } from "vitest";

// WebKitGTK gives an empty textarea inside the text-size zoom a sideways scrollbar (index.css).
// jsdom has no layout, so the rule itself is what can be held here. Read as themes.test.ts reads
// the stylesheet: Vitest hands back "" for CSS imports, and the app has no Node typings.
async function readStylesheet(): Promise<string> {
  const fsModule = "node:fs";
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: string): string };
  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ".";
  return fs.readFileSync(`${cwd}/src/index.css`, "utf8");
}

describe("text boxes never scroll sideways", () => {
  it("keeps overflow-x: hidden on every textarea", async () => {
    expect(await readStylesheet()).toMatch(/(^|\n)textarea\s*\{[^}]*overflow-x:\s*hidden/);
  });
});
