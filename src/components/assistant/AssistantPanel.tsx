import { useMemo, useState } from "react";
import { Sparkles, Square, Copy, RotateCcw, Settings } from "lucide-react";
import { Button } from "../shared/Button";
import { Dialog } from "../shared/Dialog";
import { renderAnswerMarkdown } from "../../lib/markdown";
import { copyText } from "../../lib/clipboard";
import { useUIStore } from "../../stores/ui";
import type { AssistantPanelProps, ConsentRequest } from "./useAssistantBox";

/** The box's main button while its text asks Vega: a different look from Post, so the two are not mistaken. */
export function AskVegaButton({ onClick, busy, size }: { onClick: () => void; busy: boolean; size?: "sm" | "md" }) {
  return (
    <Button onClick={onClick} busy={busy} size={size}>
      <Sparkles className="text-accent" />Ask Vega
    </Button>
  );
}

/** Under a box in `@vega` mode: what would be sent where, the answer, and the question before a cloud model. */
export function AssistantPanel({ line, answer, consent, onStop, onUse, onDiscard, onRetry }: AssistantPanelProps) {
  const html = useMemo(() => (answer.text ? renderAnswerMarkdown(answer.text) : ""), [answer.text]);
  const openSettings = useUIStore((s) => s.openSettings);
  const running = answer.status === "waiting" || answer.status === "streaming";

  return (
    <>
      {line && (
        <p className="flex items-start gap-1.5 text-text-muted text-caption mt-1">
          <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" aria-hidden />
          <span>{line}</span>
        </p>
      )}

      {answer.status !== "idle" && (
        <section aria-label="Vega's answer" className="mt-2 rounded-lg border border-border bg-bg-raised px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-text-muted text-caption mb-1">
            <Sparkles className="w-3.5 h-3.5 text-accent" aria-hidden />
            <span>Vega{answer.model ? `, ${answer.model}` : ""}</span>
            {answer.status === "waiting" && <span>· thinking…</span>}
            {answer.status === "stopped" && <span>· stopped</span>}
          </div>

          {/* A long answer scrolls inside the card, so its buttons stay in sight and the feed under the box is not pushed off the window. */}
          {html && <div tabIndex={0} aria-label="Answer text" className="prose-compact text-body text-text break-words max-h-[calc(var(--window-h)*0.45)] overflow-y-auto" dangerouslySetInnerHTML={{ __html: html }} />}

          {answer.status === "error" && <p role="alert" className="text-danger text-caption">{answer.error}</p>}
          {answer.status === "stopped" && !answer.text && <p className="text-text-muted text-caption">Stopped before anything arrived.</p>}

          {/* One announcement when the answer is in, not one per piece as it streams. */}
          <span className="sr-only" aria-live="polite">{answer.status === "done" ? "Vega answered." : ""}</span>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            {running && <Button size="sm" onClick={onStop}><Square />Stop</Button>}
            {(answer.status === "done" || answer.status === "stopped") && answer.text.trim() && (
              <>
                <Button size="sm" variant="primary" onClick={onUse}>Use as draft</Button>
                <Button size="sm" onClick={() => void copyText(answer.text.trim(), "Copied.")}><Copy />Copy</Button>
              </>
            )}
            {answer.status === "error" && <Button size="sm" onClick={() => void onRetry()}><RotateCcw />Try again</Button>}
            {answer.status === "error" && answer.needsSettings && (
              <Button size="sm" onClick={() => openSettings("assistant")}><Settings />Open Settings</Button>
            )}
            {!running && <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>}
          </div>
        </section>
      )}

      {consent && <CloudConsent request={consent} />}
    </>
  );
}

function CloudConsent({ request }: { request: ConsentRequest }) {
  const [always, setAlways] = useState(false);
  return (
    <Dialog title={`Send to ${request.who}?`} size="sm" onClose={() => request.answer(false, false)}>
      <div className="p-4 space-y-3">
        <p className="text-body text-text">
          {sentence(request.what)} will be sent to {request.who}. They may keep it under their terms.
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="mt-0.5 accent-accent w-4 h-4 shrink-0" />
          <span className="text-body text-text-muted">Don't ask again for {request.who}</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => request.answer(false, false)}>Cancel</Button>
          <Button variant="primary" onClick={() => request.answer(true, always)}>Send</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** "Your feed, 16 notes" as the subject of a sentence: "Your feed (16 notes)". */
function sentence(what: string): string {
  const comma = what.indexOf(", ");
  return comma === -1 ? what : `${what.slice(0, comma)} (${what.slice(comma + 2)})`;
}
