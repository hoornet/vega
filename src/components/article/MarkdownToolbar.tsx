import type { KeyboardEvent, RefObject } from "react";
import { Bold, Italic, Heading2, Link2, Image, Quote, Code, List } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { uploadBytes } from "../../lib/upload";
import { Button } from "../shared/Button";
import { markdownEdit, continueList, applyEdit, type EditAction } from "../../lib/markdownEdit";

// The editor's toolbar. The rules for what each button does to the text are
// in `lib/markdownEdit.ts`, pure and tested; this puts them on the textarea.

interface ToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setContent: (value: string) => void;
  setUploading?: (value: boolean) => void;
  setError?: (value: string | null) => void;
}

/** Apply a toolbar action to the textarea's current selection. */
export function applyMarkdownAction(textarea: HTMLTextAreaElement, action: EditAction, setContent: (value: string) => void): void {
  const change = markdownEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd, action);
  applyEdit(textarea, change, setContent);
}

/** Put text in at the caret, replacing the selection. */
export function insertAtCaret(textarea: HTMLTextAreaElement, text: string, setContent: (value: string) => void): void {
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const content = textarea.value;
  applyEdit(textarea, { content: content.slice(0, start) + text + content.slice(end), selectionStart: start + text.length, selectionEnd: start + text.length, replace: { start, end, text } }, setContent);
}

const TOOLS: { action: EditAction | "image"; label: string; title: string; icon: typeof Bold }[] = [
  { action: "bold", label: "Bold", title: "Bold (Ctrl+B)", icon: Bold },
  { action: "italic", label: "Italic", title: "Italic (Ctrl+I)", icon: Italic },
  { action: "heading", label: "Heading", title: "Heading", icon: Heading2 },
  { action: "link", label: "Link", title: "Link (Ctrl+K)", icon: Link2 },
  { action: "image", label: "Image", title: "Upload an image", icon: Image },
  { action: "quote", label: "Quote", title: "Quote", icon: Quote },
  { action: "code", label: "Code", title: "Code", icon: Code },
  { action: "list", label: "List", title: "Bullet list", icon: List },
];

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
};

export function MarkdownToolbar({ textareaRef, setContent, setUploading, setError }: ToolbarProps) {
  const handleClick = (action: EditAction | "image") => {
    if (action === "image") { void handleImageUpload(); return; }
    const textarea = textareaRef.current;
    if (!textarea) return;
    applyMarkdownAction(textarea, action, setContent);
  };

  const handleImageUpload = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setUploading?.(true);
      setError?.(null);
      try {
        const snippets: string[] = [];
        for (const filePath of paths) {
          const bytes = await readFile(filePath);
          const fileName = filePath.split(/[\\/]/).pop() || "image.png";
          const ext = fileName.split(".").pop()?.toLowerCase() || "png";
          const url = await uploadBytes(new Uint8Array(bytes), fileName, MIME[ext] || "image/png");
          snippets.push(`![${fileName}](${url})`);
        }
        const textarea = textareaRef.current;
        if (textarea && snippets.length > 0) {
          const cursorPos = textarea.selectionStart ?? textarea.value.length;
          const needsLeadingNewline = cursorPos > 0 && textarea.value[cursorPos - 1] !== "\n";
          insertAtCaret(textarea, (needsLeadingNewline ? "\n\n" : "") + snippets.join("\n\n") + "\n\n", setContent);
        }
      } finally {
        setUploading?.(false);
      }
    } catch (err) {
      setError?.(`Image upload failed: ${err}`);
    }
  };

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
      {TOOLS.map(({ action, label, title, icon: Icon }) => (
        <Button key={action} square size="sm" variant="ghost" onClick={() => handleClick(action)} title={title} aria-label={label}>
          <Icon />
        </Button>
      ))}
    </div>
  );
}

/**
 * Keyboard shortcuts in the body: Ctrl+B, Ctrl+I, Ctrl+K, and Enter inside a
 * list, which continues it. True when the key was taken.
 */
export function handleEditorKeyDown(
  e: KeyboardEvent<HTMLTextAreaElement>,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  setContent: (value: string) => void,
): boolean {
  const textarea = textareaRef.current;
  if (!textarea) return false;
  // The Enter that commits an IME conversion is not an Enter in the text.
  if (e.nativeEvent.isComposing || e.keyCode === 229) return false;
  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && textarea.selectionStart === textarea.selectionEnd) {
    const change = continueList(textarea.value, textarea.selectionStart);
    if (!change) return false;
    e.preventDefault();
    applyEdit(textarea, change, setContent);
    return true;
  }
  if (!(e.ctrlKey || e.metaKey)) return false;
  const action = ({ b: "bold", i: "italic", k: "link" } as Record<string, EditAction>)[e.key.toLowerCase()];
  if (!action) return false;
  e.preventDefault();
  applyMarkdownAction(textarea, action, setContent);
  return true;
}
