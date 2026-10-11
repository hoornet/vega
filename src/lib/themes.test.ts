import { describe, it, expect } from "vitest";
import { contrast, over } from "./contrast";
import { DEFAULT_THEME_ID, RETIRED_THEMES, getTheme, resolveThemeId, themes } from "./themes";
import { SECONDARY_TINT } from "../components/shared/Button";

// The October 2026 UI review found the most used text colour (`text-dim`, 431
// uses, mostly 10 to 11px) at 3.0 to 3.7:1 in every theme, and the default
// theme's primary button label at 2.7:1. These are the rules the themes were
// re-tuned to. They are computed from the values, so a new theme or a tweaked
// colour that breaks one fails here instead of in someone's eyes.

const AA = 4.5;
const SURFACES = ["bg", "bg-raised", "bg-hover"] as const;

describe("contrast", () => {
  it("matches the reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
    // #767676 on white is the well-known "just passes AA" grey.
    expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(AA);
    expect(contrast("#777777", "#ffffff")).toBeLessThan(AA);
  });

  it("blends a translucent colour over an opaque one", () => {
    expect(over("#ffffff", 0, "#000000")).toBe("#000000");
    expect(over("#ffffff", 1, "#000000")).toBe("#ffffff");
    expect(over("#ffffff", 0.5, "#000000")).toBe("#808080");
    expect(over("#ff0000", 0.1, "#000000")).toBe("#1a0000");
  });
});

describe.each(themes.map((t) => [t.id, t.colors] as const))("theme %s", (_id, c) => {
  it("keeps every text colour readable on every surface", () => {
    for (const surface of SURFACES) {
      for (const text of ["text", "text-muted", "text-dim", "accent"] as const) {
        expect(contrast(c[text], c[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  // Three text levels are only useful if they can be told apart.
  it("keeps the three text levels distinct", () => {
    const on = (k: "text" | "text-muted" | "text-dim") => contrast(c[k], c.bg);
    expect(on("text-muted") / on("text-dim"), "muted over dim").toBeGreaterThanOrEqual(1.3);
    expect(on("text") / on("text-muted"), "text over muted").toBeGreaterThanOrEqual(1.25);
  });

  it("keeps labels readable on the fills they sit on", () => {
    expect(contrast(c["accent-text"], c.accent), "label on accent").toBeGreaterThanOrEqual(AA);
    expect(contrast(c["accent-text"], c["accent-hover"]), "label on accent-hover").toBeGreaterThanOrEqual(AA);
    expect(contrast(c["zap-text"], c.zap), "label on zap").toBeGreaterThanOrEqual(AA);
    // Most dark themes have a light danger colour, so white on it fails.
    expect(contrast(c["danger-text"], c.danger), "label on danger").toBeGreaterThanOrEqual(AA);
    expect(contrast(c["zap-text"], c["zap-hover"]), "label on zap-hover").toBeGreaterThanOrEqual(AA);
    expect(contrast(c["danger-text"], c["danger-hover"]), "label on danger-hover").toBeGreaterThanOrEqual(AA);
  });

  // A hover that cannot be seen is not feedback.
  it("makes the hover of a solid fill a visible step from the fill", () => {
    for (const fill of ["accent", "zap", "danger"] as const) {
      expect(contrast(c[fill], c[`${fill}-hover`]), `${fill} to ${fill}-hover`).toBeGreaterThanOrEqual(1.1);
    }
  });

  // The shared Button's quiet fills are tints of the text colour, so that one
  // button works on the canvas, in the sidebar and in a dialog. The tints come
  // from the component, so changing one there is checked here.
  const rest = SECONDARY_TINT.rest / 100;
  const hovered = SECONDARY_TINT.hover / 100;

  it("keeps a secondary button's label readable on its fill, at rest and hovered", () => {
    for (const surface of ["bg", "bg-raised", "bg-hover"] as const) {
      expect(contrast(c.text, over(c.text, rest, c[surface])), `text on the secondary fill over ${surface}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(c.text, over(c.text, hovered, c[surface])), `text on the hovered secondary fill over ${surface}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("keeps a secondary button's fill a step from the surface under it, and its hover a step from that", () => {
    for (const surface of ["bg", "bg-raised", "bg-hover"] as const) {
      const fill = over(c.text, rest, c[surface]);
      expect(contrast(fill, c[surface]), `secondary fill over ${surface}`).toBeGreaterThanOrEqual(1.1);
      expect(contrast(over(c.text, hovered, c[surface]), fill), `hovered secondary fill over ${surface}`).toBeGreaterThanOrEqual(1.05);
    }
  });

  // An icon in a status colour on a secondary button (the bolt on Zap) is a
  // graphic, held to 3:1. Text in a status colour is not held to 4.5:1 there,
  // which is why Button has no coloured secondary.
  it("keeps a status-coloured icon visible on a secondary button", () => {
    for (const surface of ["bg", "bg-raised", "bg-hover"] as const) {
      for (const status of ["zap", "danger"] as const) {
        expect(contrast(c[status], over(c.text, hovered, c[surface])), `${status} icon on the hovered secondary fill over ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  // `bg-accent/10 text-accent` marks the active tab, the active nav row and
  // selected chips: accent written on its own tint.
  it("keeps accent readable on its own tint", () => {
    for (const surface of ["bg", "bg-raised"] as const) {
      expect(contrast(c.accent, over(c.accent, 0.1, c[surface])), `accent on accent/10 over ${surface}`).toBeGreaterThanOrEqual(AA);
    }
  });

  // Status text sits on the hover surface whenever the pointer is over its
  // row: a zap count, a relay's latency, a verification tick.
  it("keeps status colours readable on every surface", () => {
    for (const status of ["danger", "warning", "success", "zap"] as const) {
      for (const surface of SURFACES) {
        expect(contrast(c[status], c[surface]), `${status} on ${surface}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  // One border colour used to do three jobs at 1.2 to 1.8:1: too strong to
  // disappear as a divider, too weak to show where a field is.
  it("gives the three border roles three strengths", () => {
    const subtle = contrast(c["border-subtle"], c.bg);
    const border = contrast(c.border, c.bg);
    const strong = contrast(c["border-strong"], c.bg);
    expect(subtle, "divider").toBeGreaterThanOrEqual(1.35);
    expect(subtle, "divider").toBeLessThanOrEqual(1.6);
    expect(border, "outline").toBeGreaterThanOrEqual(1.85);
    expect(border / subtle, "outline over divider").toBeGreaterThanOrEqual(1.25);
    expect(strong / border, "field edge over outline").toBeGreaterThanOrEqual(1.4);
  });

  // Fields are drawn on the canvas and inside raised things (dialogs, cards,
  // the sidebar), so their edge has to hold on both.
  it("keeps a field's edge at 3:1 on the canvas and on raised surfaces", () => {
    for (const surface of ["bg", "bg-raised"] as const) {
      expect(contrast(c["border-strong"], c[surface]), `field edge on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("never draws a border that vanishes into a surface", () => {
    for (const b of ["border", "border-subtle", "border-strong"] as const) {
      for (const surface of SURFACES) {
        expect(contrast(c[b], c[surface]), `${b} on ${surface}`).toBeGreaterThanOrEqual(1.1);
      }
    }
  });

  // The hover surface is the worst case for text, so it must stay close to
  // the canvas. It must also be a step away from both other surfaces, or
  // hovering shows nothing.
  it("keeps the three surfaces apart, and the hover surface close to the canvas", () => {
    const raised = contrast(c["bg-raised"], c.bg);
    const hover = contrast(c["bg-hover"], c.bg);
    expect(raised, "raised from canvas").toBeGreaterThanOrEqual(1.02);
    expect(hover, "hover from canvas").toBeGreaterThanOrEqual(1.08);
    expect(hover, "hover from canvas").toBeLessThanOrEqual(1.35);
    expect(contrast(c["bg-hover"], c["bg-raised"]), "hover from raised").toBeGreaterThanOrEqual(1.05);
  });
});

describe("the stylesheet's first-paint colours", () => {
  // index.css declares the colours shown before applyTheme() runs. If they
  // differ from the default theme the app flashes the old colours on launch.
  // Vitest hands back an empty string for CSS imports, `?raw` included, and
  // the app has no Node typings, so the file is read through an untyped import.
  async function readStylesheet(): Promise<string> {
    const fsModule = "node:fs";
    const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: string): string };
    const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ".";
    return fs.readFileSync(`${cwd}/src/index.css`, "utf8");
  }

  it("mirror the default theme exactly", async () => {
    const stylesheet = await readStylesheet();
    const block = stylesheet.slice(stylesheet.indexOf("@theme"), stylesheet.indexOf("\n}", stylesheet.indexOf("@theme")));
    const declared: Record<string, string> = {};
    const decl = /--color-([a-z-]+):\s*(#[0-9a-fA-F]{6});/g;
    for (let m = decl.exec(block); m; m = decl.exec(block)) declared[m[1]] = m[2].toLowerCase();
    expect(Object.keys(declared).length).toBeGreaterThan(10);
    const midnight = getTheme(DEFAULT_THEME_ID)!.colors;
    expect(declared).toEqual(Object.fromEntries(Object.entries(midnight).map(([k, v]) => [k, v.toLowerCase()])));
  });
});

describe("resolveThemeId", () => {
  it("keeps a theme that exists", () => {
    for (const t of themes) expect(resolveThemeId(t.id)).toBe(t.id);
  });

  it("falls back to the default for nothing stored or an unknown id", () => {
    expect(resolveThemeId(null)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId("")).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId("solarized")).toBe(DEFAULT_THEME_ID);
  });

  // Sepia was removed. Someone who had it selected should land on the nearest
  // theme, not be switched to Midnight without a word.
  it("moves a retired theme to its replacement", () => {
    expect(getTheme("sepia")).toBeUndefined();
    expect(resolveThemeId("sepia")).toBe("gruvbox");
  });

  // If a replacement is itself removed one day and nobody updates the map,
  // its users fall back to the default without a word: the failure this
  // function exists to prevent.
  it("ends every retirement on a theme that exists", () => {
    for (const [retired, target] of Object.entries(RETIRED_THEMES)) {
      expect(getTheme(retired), `${retired} is still a theme`).toBeUndefined();
      expect(getTheme(resolveThemeId(retired)), `${retired} -> ${target}`).toBeDefined();
      expect(resolveThemeId(retired)).not.toBe(DEFAULT_THEME_ID);
    }
  });

  it("is not fooled by names that exist on every object", () => {
    expect(resolveThemeId("constructor")).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId("__proto__")).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId("toString")).toBe(DEFAULT_THEME_ID);
  });
});
