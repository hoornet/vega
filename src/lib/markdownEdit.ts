// Edits the article editor's toolbar and shortcuts make to the markdown, as
// pure functions over the text and the selection, so each rule has a test.
// `applyEdit` puts one on a textarea through the browser's own insert, which
// keeps the undo stack; replacing the whole value from state reset it.
//
// Before October 2026 (B15 in the UI review): Ctrl+B with no selection
// inserted the literal `**bold text**`; H, Quote and List inserted their prefix
// at the caret, so H at the end of a typed line gave `My heading## Heading`.

export type EditAction = "bold" | "italic" | "heading" | "link" | "quote" | "code" | "list";

export interface TextEdit {
  /** The text after the edit. */
  content: string;
  /** Where the selection goes afterwards. */
  selectionStart: number;
  selectionEnd: number;
  /** The one range that changed, for an insert that keeps undo. */
  replace: { start: number; end: number; text: string };
}

const edit = (content: string, start: number, end: number, text: string, selectionStart: number, selectionEnd = selectionStart): TextEdit => ({
  content: content.slice(0, start) + text + content.slice(end),
  selectionStart,
  selectionEnd,
  replace: { start, end, text },
});

/**
 * Wrap the selection in `mark`, or with nothing selected put the marks down
 * and the caret between them. Whitespace at the selection's edges stays
 * outside the marks: a double-click selects the trailing space on Windows,
 * and `**word **` is not emphasis.
 */
function wrap(content: string, start: number, end: number, mark: string): TextEdit {
  const selected = content.slice(start, end);
  if (!selected.trim()) return edit(content, start, end, mark + mark, start + mark.length);
  const lead = selected.length - selected.trimStart().length;
  const trail = selected.length - selected.trimEnd().length;
  const core = selected.slice(lead, selected.length - trail);
  const text = selected.slice(0, lead) + mark + core + mark + selected.slice(selected.length - trail);
  return edit(content, start, end, text, start + lead + mark.length, start + lead + mark.length + core.length);
}

/**
 * The start of the line `at` is on, and the end of the line `to` is on. A
 * selection that ends at the very start of a line (Shift+Down) does not
 * touch that line.
 */
function lineBounds(content: string, at: number, to: number) {
  const first = at === 0 ? 0 : content.lastIndexOf("\n", at - 1) + 1;
  const toLine = to > at && content[to - 1] === "\n" ? to - 1 : to;
  const nl = content.indexOf("\n", Math.max(toLine, first));
  const last = nl === -1 ? content.length : nl;
  return { first, last };
}

const PREFIX: Record<"heading" | "quote" | "list", { add: string; has: RegExp }> = {
  heading: { add: "## ", has: /^[ \t]{0,3}#{1,6}[ \t]+/ },
  quote: { add: "> ", has: /^[ \t]{0,3}>[ \t]?/ },
  list: { add: "- ", has: /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/ },
};

/**
 * Put a line prefix on every line the selection touches, at the start of the
 * line and not at the caret. If every touched line already has one, take it
 * off instead, so the button is a toggle.
 */
function prefixLines(content: string, start: number, end: number, kind: "heading" | "quote" | "list"): TextEdit {
  const { first, last } = lineBounds(content, start, end);
  const lines = content.slice(first, last).split("\n");
  const { add, has } = PREFIX[kind];
  const allHave = lines.every((line) => has.test(line));
  const changed = lines.map((line) => (allHave ? line.replace(has, "") : add + line));
  const text = changed.join("\n");
  const firstDelta = changed[0].length - lines[0].length;
  const totalDelta = text.length - (last - first);
  // A caret stays on its text. A selection that began at the line's start takes the new prefix in.
  const selectionStart = start < end && start === first ? first : Math.max(first, start + firstDelta);
  return edit(content, first, last, text, selectionStart, Math.max(selectionStart, end + totalDelta));
}

export function markdownEdit(content: string, start: number, end: number, action: EditAction): TextEdit {
  const selected = content.slice(start, end);
  switch (action) {
    case "bold": return wrap(content, start, end, "**");
    case "italic": return wrap(content, start, end, "*");
    case "code": {
      if (selected.includes("\n")) {
        // A fence opens a block only at the start of a line: give it one when the selection starts mid-line.
        const before = start > 0 && content[start - 1] !== "\n" ? "\n" : "";
        const after = end < content.length && content[end] !== "\n" ? "\n" : "";
        const text = before + "```\n" + selected + "\n```" + after;
        const from = start + before.length + 4;
        return edit(content, start, end, text, from, from + selected.length);
      }
      return wrap(content, start, end, "`");
    }
    case "link": {
      // With text selected it becomes the link and "url" is selected to be typed over; without, "link text" is.
      const label = selected || "link text";
      const text = `[${label}](url)`;
      return selected
        ? edit(content, start, end, text, start + label.length + 3, start + label.length + 6)
        : edit(content, start, end, text, start + 1, start + 1 + label.length);
    }
    case "heading":
    case "quote":
    case "list":
      return prefixLines(content, start, end, action);
  }
}

const LIST_LINE = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))[ \t]+(.*)$/;

/**
 * Enter inside a list item continues the list: the next line gets the same
 * marker (or the next number). Enter on an empty item ends the list by taking
 * the marker off. Null when the caret is not in a list, so the key does what
 * it always does.
 */
export function continueList(content: string, caret: number): TextEdit | null {
  const { first } = lineBounds(content, caret, caret);
  const lineEnd = content.indexOf("\n", caret);
  const line = content.slice(first, lineEnd === -1 ? content.length : lineEnd);
  const m = LIST_LINE.exec(line);
  if (!m) return null;
  const [, indent, bullet, number, numberMark, rest] = m;
  // Only from inside the item's text: Enter at column 0 or inside the marker is a plain line break.
  if (caret < first + line.length - rest.length) return null;
  if (!rest.trim() && caret >= first + line.length) {
    // An empty item: end the list here.
    return edit(content, first, first + line.length, "", first);
  }
  const marker = bullet ? `${bullet} ` : `${Number(number) + 1}${numberMark} `;
  const text = `\n${indent}${marker}`;
  return edit(content, caret, caret, text, caret + text.length);
}

/**
 * Put an edit on a textarea. The browser's own insert goes through the undo
 * stack and fires `input`, so a controlled textarea's `onChange` sees it; where
 * that is not available (tests), the value is set and `fallback` is told.
 */
export function applyEdit(textarea: HTMLTextAreaElement, change: TextEdit, fallback: (content: string) => void): void {
  textarea.focus();
  textarea.setSelectionRange(change.replace.start, change.replace.end);
  let inserted = false;
  try {
    inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, change.replace.text);
  } catch {
    inserted = false;
  }
  if (inserted && textarea.value === change.content) {
    // The insert is done and the value already matches the state React will
    // hold, so the selection can be set now. Set a frame later, it landed
    // after the next keystroke and moved the caret back under fast typing.
    textarea.setSelectionRange(change.selectionStart, change.selectionEnd);
    return;
  }
  fallback(change.content);
  // The value arrives with the next render, which puts the caret at the end.
  requestAnimationFrame(() => textarea.setSelectionRange(change.selectionStart, change.selectionEnd));
}
