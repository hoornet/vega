import { describe, it, expect } from "vitest";
import { markdownEdit, continueList } from "./markdownEdit";

// B15 in the October 2026 UI review, read from code and checked here before it
// was fixed: Ctrl+B with no selection inserted the literal "**bold text**", and
// H, Quote and List put their prefix at the caret, not at the line start.

const sel = (text: string) => {
  const start = text.indexOf("|"), end = text.lastIndexOf("|") - 1;
  return { content: text.replace(/\|/g, ""), start, end: end < start ? start : end };
};
const show = (e: { content: string; selectionStart: number; selectionEnd: number }) =>
  e.content.slice(0, e.selectionStart) + "|" + e.content.slice(e.selectionStart, e.selectionEnd) + (e.selectionEnd > e.selectionStart ? "|" : "") + e.content.slice(e.selectionEnd);
const run = (text: string, action: Parameters<typeof markdownEdit>[3]) => { const { content, start, end } = sel(text); return show(markdownEdit(content, start, end, action)); };

describe("bold and italic", () => {
  it("wrap a selection and leave it selected", () => {
    expect(run("say |hello| now", "bold")).toBe("say **|hello|** now");
    expect(run("say |hello| now", "italic")).toBe("say *|hello|* now");
  });

  it("with nothing selected put the marks down and the caret between them, not placeholder text", () => {
    expect(run("say | now", "bold")).toBe("say **|** now");
    expect(run("say | now", "italic")).toBe("say *|* now");
  });

  it("leave a selection's edge spaces outside the marks", () => {
    expect(run("a |word |here", "bold")).toBe("a **|word|** here");
    expect(run("a | |b", "bold")).toBe("a **|**b");
  });
});

describe("heading, quote and list", () => {
  it("go at the start of the line, wherever the caret is", () => {
    expect(run("My heading|", "heading")).toBe("## My heading|");
    expect(run("first\nsec|ond\nthird", "quote")).toBe("first\n> sec|ond\nthird");
    expect(run("one|", "list")).toBe("- one|");
  });

  it("cover every line a selection touches", () => {
    expect(run("a\n|b\nc|\nd", "list")).toBe("a\n|- b\n- c|\nd");
  });

  it("come off again when every touched line already has them", () => {
    expect(run("## My heading|", "heading")).toBe("My heading|");
    expect(run("|- b\n- c|", "list")).toBe("|b\nc|");
    expect(run("|- b\nc|", "list")).toBe("|- - b\n- c|");
  });

  it("keep the caret on its text when a prefix goes on an empty line", () => {
    expect(run("|", "heading")).toBe("## |");
  });

  it("go on the first line when the caret is at the very start, even before a blank line", () => {
    expect(run("|\nabc", "heading")).toBe("## |\nabc");
  });

  it("leave out a line the selection only reaches the start of", () => {
    expect(run("|> one\n> two\n|three", "quote")).toBe("|one\ntwo\n|three");
  });
});

describe("code and link", () => {
  it("fence a selection with a newline in it, and backtick one without", () => {
    expect(run("|a\nb|", "code")).toBe("```\n|a\nb|\n```");
    expect(run("|a|", "code")).toBe("`|a|`");
    expect(run("x| y", "code")).toBe("x`|` y");
  });

  it("start a fence on its own line when the selection begins mid-line", () => {
    expect(run("abc |def\nghi| jkl", "code")).toBe("abc \n```\n|def\nghi|\n```\n jkl");
  });

  it("make the selection the link text and select the address to type over, or select the placeholder text", () => {
    expect(run("see |docs|", "link")).toBe("see [docs](|url|)");
    expect(run("see |", "link")).toBe("see [|link text|](url)");
  });
});

describe("Enter in a list", () => {
  const enter = (text: string) => { const { content, start } = sel(text); const e = continueList(content, start); return e && show(e); };

  it("continues a bullet list with the same marker and indent", () => {
    expect(enter("- one|")).toBe("- one\n- |");
    expect(enter("  * one|")).toBe("  * one\n  * |");
  });

  it("continues a numbered list with the next number", () => {
    expect(enter("1. one|")).toBe("1. one\n2. |");
    expect(enter("9) nine|")).toBe("9) nine\n10) |");
  });

  it("ends the list on an empty item", () => {
    expect(enter("- one\n- |")).toBe("- one\n|");
  });

  it("splits an item from the middle of its text", () => {
    expect(enter("- o|ne")).toBe("- o\n- |ne");
  });

  it("does nothing outside a list, at column 0, or inside the marker", () => {
    expect(enter("plain|")).toBeNull();
    expect(enter("|- item")).toBeNull();
    expect(enter("-| item")).toBeNull();
    expect(enter("1.| one")).toBeNull();
  });
});
