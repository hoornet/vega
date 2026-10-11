import { useState, type RefObject } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { publishQuote } from "../../lib/nostr";
import { useCanSign } from "../../stores/user";
import { useAutoResize } from "../../hooks/useAutoResize";
import { LoginModal } from "../shared/LoginModal";
import { Dialog } from "../shared/Dialog";
import { Button } from "../shared/Button";

interface QuoteModalProps {
  event: NDKEvent;
  authorName: string;
  authorAvatar?: string;
  onClose: () => void;
  onPublished?: () => void;
  /** Where focus goes when this closes: the button whose menu held "Quote…", which is gone by then. */
  returnFocus?: RefObject<HTMLElement | null>;
}

export function QuoteModal({ event, authorName, authorAvatar, onClose, onPublished, returnFocus }: QuoteModalProps) {
  const canSign = useCanSign();
  const [text, setText] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  // Same range as the article comment box — prose at a similar size. Capped
  // lower than the DM composer because this shares a modal with the quoted
  // note preview and the publish controls.
  const autoResize = useAutoResize(3, 10);

  const canPublish = text.trim().length > 0 && !publishing;

  const handlePublish = async () => {
    if (!canPublish) return;
    setPublishing(true);
    setError(null);
    try {
      await publishQuote(text.trim(), event);
      onPublished?.();
      onClose();
    } catch (err) {
      setError(`Failed to publish: ${err}`);
      setPublishing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handlePublish();
  };

  const preview = event.content.slice(0, 140) + (event.content.length > 140 ? "…" : "");

  return (
    <>
      {/* A click on the backdrop used to throw away a half-written quote without a word. */}
      <Dialog title="Quote note" onClose={onClose} closeOnBackdrop={text.trim().length === 0} returnFocus={returnFocus}>
        {/* Compose */}
        <div className="p-4">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); autoResize(e); }}
            onKeyDown={handleKeyDown}
            placeholder="Add your comment…"
            rows={3}
            className="w-full bg-transparent text-text text-body placeholder:text-text-dim resize-none focus:outline-none mb-3"
            style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
          />

          {/* Quoted note preview */}
          <div className="border border-border px-3 py-2.5 bg-bg rounded-lg">
            <div className="flex items-center gap-2 mb-1.5">
              {authorAvatar ? (
                <img src={authorAvatar} alt={`${authorName}'s avatar`} className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <div className="w-4 h-4 rounded-full bg-accent/20 flex items-center justify-center text-accent text-[8px]">
                  {authorName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-text-muted text-caption font-medium">{authorName}</span>
            </div>
            <p className="text-text-dim text-body leading-relaxed whitespace-pre-wrap break-words">{preview}</p>
          </div>

          {error && <p className="text-danger text-caption mt-2">{error}</p>}

          <div className="flex items-center justify-between mt-3">
            <span className="text-text-dim text-caption">{canSign ? "Ctrl+Enter to post" : ""}</span>
            {canSign ? (
              <Button variant="primary" onClick={handlePublish} disabled={!canPublish && !publishing} busy={publishing}>
                {publishing ? "Posting…" : "Quote & post"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setShowLogin(true)}>Sign in to post</Button>
            )}
          </div>
        </div>
      </Dialog>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}
