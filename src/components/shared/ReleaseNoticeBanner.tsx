import { useState, useEffect } from "react";
import pkg from "../../../package.json";
import { useUIStore } from "../../stores/ui";
import { pendingNotices, markVersionSeen, type ReleaseNotice } from "../../lib/releaseNotices";

/**
 * Shown once, on the first launch after an upgrade that changed existing
 * behaviour. See src/lib/releaseNotices.ts for when an entry is warranted.
 */
export function ReleaseNoticeBanner() {
  const setView = useUIStore((s) => s.setView);
  const [notices, setNotices] = useState<ReleaseNotice[]>([]);

  useEffect(() => {
    setNotices(pendingNotices(pkg.version));
    // Stamp immediately rather than on dismiss: if the user quits without
    // dismissing, the notice has still served its purpose and shouldn't nag.
    markVersionSeen(pkg.version);
  }, []);

  if (notices.length === 0) return null;

  const dismiss = (version: string) =>
    setNotices((prev) => prev.filter((n) => n.version !== version));

  return (
    <>
      {notices.map((notice) => (
        <div key={notice.version} className="bg-accent/10 border-b border-accent/30 text-[12px] shrink-0">
          <div className="flex items-start justify-between gap-4 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-text font-medium">{notice.title}</p>
              <p className="text-text-muted mt-0.5">{notice.body}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {notice.action && (
                <button
                  onClick={() => {
                    setView(notice.action!.view);
                    dismiss(notice.version);
                  }}
                  className="text-accent hover:text-accent-hover transition-colors whitespace-nowrap"
                >
                  {notice.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(notice.version)}
                aria-label="Dismiss notice"
                className="text-text-dim hover:text-text transition-colors"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
