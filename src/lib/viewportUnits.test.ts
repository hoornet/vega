import { describe, it, expect } from "vitest";

// Inside the text-size zoom (the window's root box, App.tsx), vh and vw mean
// different things per engine: Chromium multiplies them by the zoom, WebKitGTK
// does not. h-screen and w-screen are 100vh and 100vw. So nothing rendered
// under the root sizes itself in them: a share of the window is written with
// `--window-h` (App.tsx) or as a percentage of a definite box. This is a
// ratchet: a file may lose these and never gain one. Onboarding is outside the
// zoom and keeps its two.

const sources = import.meta.glob(["../components/**/*.tsx", "../App.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const ALLOWED: Record<string, number> = {
  "components/onboarding/OnboardingFlow.tsx": 2,
};
const UNIT = /\bh-screen\b|\bw-screen\b|\[[^\]]*\b\d+(?:\.\d+)?v[hw]\b[^\]]*\]/g;

/** Class strings only: a comment that explains the rule is not a use of it. */
function uses(source: string): number {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return (withoutComments.match(UNIT) ?? []).length;
}

describe("viewport units under the text-size zoom", () => {
  const counts = new Map<string, number>();
  for (const [path, source] of Object.entries(sources)) {
    if (/\.test\.tsx$/.test(path)) continue;
    const n = uses(source);
    if (n > 0) counts.set(path.replace(/^\.\.\//, ""), n);
  }

  it("gains no vh, vw, h-screen or w-screen in anything rendered under the root", () => {
    const over = [...counts].filter(([file, n]) => n > (ALLOWED[file] ?? 0)).map(([file, n]) => `${file}: ${n}, ${ALLOWED[file] ?? 0} allowed`);
    expect(over).toEqual([]);
  });

  it("has no ceiling higher than what is there", () => {
    const slack = Object.entries(ALLOWED).filter(([file, n]) => (counts.get(file) ?? 0) < n).map(([file, n]) => `${file}: allows ${n}, has ${counts.get(file) ?? 0}`);
    expect(slack, "lower these numbers in ALLOWED").toEqual([]);
  });
});
