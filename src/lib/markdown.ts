import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
// No bundled highlight stylesheet: its dark palette was 1.6 to 2.3:1 on the
// Reader theme. The token colours come from the theme, in index.css.

// Register commonly used languages (keeps bundle small)
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import go from "highlight.js/lib/languages/go";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("go", go);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

// Configure marked with highlight.js via marked-highlight extension
marked.use(
  markedHighlight({
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  }),
  { breaks: true },
);

export function renderMarkdown(md: string): string {
  const html = marked(md) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["id", "class"] });
}

/**
 * A model's answer, as HTML. The same pipeline, with nothing that loads by itself: an answer must
 * not fetch a tracking pixel, a frame or a stylesheet, whatever the notes it read asked it to
 * write. Links stay, and open in the browser only when clicked, as everywhere in Vega.
 */
export function renderAnswerMarkdown(md: string): string {
  const html = marked(md) as string;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["img", "picture", "source", "video", "audio", "track", "iframe", "object", "embed", "svg", "math", "style", "link", "form", "input", "button"],
    FORBID_ATTR: ["style", "srcset", "background", "poster"],
  });
}
