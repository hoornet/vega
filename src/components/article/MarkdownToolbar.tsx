import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { uploadBytes } from "../../lib/upload";

type MarkdownAction = "bold" | "italic" | "heading" | "link" | "image" | "quote" | "code" | "list";

interface ToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  setContent: (value: string) => void;
  setUploading?: (value: boolean) => void;
  setError?: (value: string | null) => void;
}

function applyMarkdown(
  textarea: HTMLTextAreaElement,
  action: MarkdownAction,
  content: string,
  setContent: (value: string) => void,
  insertText?: string,
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = content.slice(start, end);

  let before = "";
  let after = "";
  let replacement = "";
  let cursorOffset = 0;

  switch (action) {
    case "bold":
      before = "**";
      after = "**";
      replacement = selected || "bold text";
      cursorOffset = selected ? 0 : 9; // select "bold text"
      break;
    case "italic":
      before = "*";
      after = "*";
      replacement = selected || "italic text";
      cursorOffset = selected ? 0 : 11;
      break;
    case "heading":
      before = "## ";
      after = "";
      replacement = selected || "Heading";
      break;
    case "link":
      if (selected) {
        before = "[";
        after = "](url)";
        replacement = selected;
      } else {
        before = "[";
        after = "](url)";
        replacement = "link text";
      }
      break;
    case "image":
      if (insertText) {
        before = "";
        after = "";
        replacement = insertText;
      } else {
        before = "![";
        after = "](url)";
        replacement = selected || "alt text";
      }
      break;
    case "quote":
      before = "> ";
      after = "";
      replacement = selected || "quote";
      break;
    case "code":
      if (selected.includes("\n")) {
        before = "```\n";
        after = "\n```";
        replacement = selected;
      } else {
        before = "`";
        after = "`";
        replacement = selected || "code";
      }
      break;
    case "list":
      if (selected) {
        replacement = selected
          .split("\n")
          .map((line) => `- ${line}`)
          .join("\n");
      } else {
        before = "- ";
        after = "";
        replacement = "item";
      }
      break;
  }

  const newContent =
    content.slice(0, start) + before + replacement + after + content.slice(end);
  setContent(newContent);

  // Restore focus and selection
  requestAnimationFrame(() => {
    textarea.focus();
    const newCursorPos = start + before.length + replacement.length + after.length;
    if (!selected && cursorOffset === 0) {
      // Select the placeholder text
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = start + before.length + replacement.length;
    } else {
      textarea.selectionStart = textarea.selectionEnd = newCursorPos;
    }
  });
}

const TOOLS: { action: MarkdownAction; label: string; title: string; bold?: boolean; italic?: boolean }[] = [
  { action: "bold", label: "B", title: "Bold (Ctrl+B)", bold: true },
  { action: "italic", label: "I", title: "Italic (Ctrl+I)", italic: true },
  { action: "heading", label: "H", title: "Heading" },
  { action: "link", label: "Link", title: "Insert link (Ctrl+K)" },
  { action: "image", label: "Image", title: "Upload image" },
  { action: "quote", label: "Quote", title: "Block quote" },
  { action: "code", label: "Code", title: "Code block" },
  { action: "list", label: "List", title: "Bullet list" },
];

export function MarkdownToolbar({ textareaRef, content, setContent, setUploading, setError }: ToolbarProps) {
  const handleClick = (action: MarkdownAction) => {
    if (action === "image") {
      handleImageUpload();
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) return;
    applyMarkdown(textarea, action, content, setContent);
  };

  const handleImageUpload = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg"] },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setUploading?.(true);
      setError?.(null);
      try {
        for (const filePath of paths) {
          const bytes = await readFile(filePath);
          const fileName = filePath.split(/[\\/]/).pop() || "image.png";
          const ext = fileName.split(".").pop()?.toLowerCase() || "png";
          const mimeMap: Record<string, string> = {
            jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
            webp: "image/webp", svg: "image/svg+xml",
          };
          const url = await uploadBytes(new Uint8Array(bytes), fileName, mimeMap[ext] || "image/png");
          const textarea = textareaRef.current;
          if (textarea) {
            applyMarkdown(textarea, "image", content, setContent, `![${fileName}](${url})`);
          }
        }
      } finally {
        setUploading?.(false);
      }
    } catch (err) {
      setError?.(`Image upload failed: ${err}`);
    }
  };

  return (
    <div className="flex items-center gap-0.5 border-b border-border px-2 py-1 bg-bg-raised shrink-0">
      {TOOLS.map(({ action, label, title, bold, italic }) => (
        <button
          key={action}
          onClick={() => handleClick(action)}
          title={title}
          className="px-2 py-0.5 text-[11px] text-text-muted hover:text-text hover:bg-bg-hover transition-colors rounded-sm"
          style={{ fontWeight: bold ? "bold" : undefined, fontStyle: italic ? "italic" : undefined }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Keyboard shortcut handler for the article editor textarea */
export function handleEditorKeyDown(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  content: string,
  setContent: (value: string) => void,
): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  const textarea = textareaRef.current;
  if (!textarea) return false;

  switch (e.key.toLowerCase()) {
    case "b":
      e.preventDefault();
      applyMarkdown(textarea, "bold", content, setContent);
      return true;
    case "i":
      e.preventDefault();
      applyMarkdown(textarea, "italic", content, setContent);
      return true;
    case "k":
      e.preventDefault();
      applyMarkdown(textarea, "link", content, setContent);
      return true;
    default:
      return false;
  }
}
