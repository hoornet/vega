import { useState, useRef, useEffect } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { publishQuote } from "../../lib/nostr";
import { useCanSign } from "../../stores/user";
import { useAutoResize } from "../../hooks/useAutoResize";
import { LoginModal } from "../shared/LoginModal";
import { BodyPortal } from "../shared/BodyPortal";
import { Button } from "../shared/Button";

interface QuoteModalProps {
  event: NDKEvent;
  authorName: string;
  authorAvatar?: string;
  onClose: () => void;
  onPublished?: () => void;
}

export function QuoteModal({ event, authorName, authorAvatar, onClose, onPublished }: QuoteModalProps) {
  const canSign = useCanSign();
  const [text, setText] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Same range as the article comment box — prose at a similar size. Capped
  // lower than the DM composer because this shares a modal with the quoted
  // note preview and the publish controls.
  const autoResize = useAutoResize(3, 10);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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
    if (e.key === "Escape") onClose();
  };

  const preview = event.content.slice(0, 140) + (event.content.length > 140 ? "…" : "");

  return (
    <BodyPortal>
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quote-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* max-h/overflow are load-bearing: the overlay centres this panel and
          never scrolls, so without them a grown composer pushes "Quote & post"
          off-screen with no way to reach it. */}
      <div className="bg-bg border border-border w-full max-w-md mx-4 shadow-2xl max-h-[85vh] overflow-y-auto rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h2 id="quote-modal-title" className="text-text text-title font-medium">Quote note</h2>
          <button onClick={onClose} aria-label="Close" className="text-text-dim hover:text-text text-lg leading-none">×</button>
        </div>

        {/* Compose */}
        <div className="p-4">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); autoResize(e); }}
            onKeyDown={handleKeyDown}
            placeholder="Add your comment…"
            rows={3}
            className="w-full bg-transparent text-text text-body placeholder:text-text-dim resize-none focus:outline-none mb-3"
            style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
          />

          {/* Quoted note preview */}
          <div className="border border-border px-3 py-2.5 bg-bg-raised rounded-lg">
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
      </div>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
    </BodyPortal>
  );
}
