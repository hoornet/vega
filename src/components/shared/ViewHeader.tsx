import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { TabsInHeader } from "./Tabs";
import { Button } from "./Button";

// One header for every view.
//
// Before the October 2026 UI review each view built its own: heights from 45
// to 133px, titles from a 12px <h2> to an 18px <h1>, a "← back" link on one
// top-level view and no other, and titles that disagreed with the sidebar
// ("Zap History" under "Zaps", "Follows" under "People"). Clicking down the
// sidebar, the top of the window jumped on every view.
//
// The header is 48px tall. It only grows when its contents wrap, which they
// are allowed to do: a dense header in a narrow window must not push controls
// out of reach.

interface ViewHeaderProps {
  /** The view's name. For a top-level view it is the sidebar's label, word for word. */
  title?: ReactNode;
  /** The view's name for a header that shows something else in the title's place (tabs, a search field). */
  hiddenTitle?: string;
  /** Shows Back before the title. Only for views reached from another view. */
  onBack?: () => void;
  /** Quiet text after the title: a count, a status. */
  meta?: ReactNode;
  /** Tabs standing in the title's place (the feed). Pass `<Tabs />`. */
  tabs?: ReactNode;
  /** A field in the title's place, or after it: the search box. It takes the free width. */
  children?: ReactNode;
  /** Controls at the right edge. */
  actions?: ReactNode;
}

const given = (slot: ReactNode) => slot !== undefined && slot !== null && slot !== false;

export function ViewHeader({ title, hiddenTitle, onBack, meta, tabs, children, actions }: ViewHeaderProps) {
  // When the window is too narrow for one line, the controls wrap. With tabs
  // in the header they wrap *above* the tabs (wrap-reverse), so the selected
  // tab's underline stays on the header's divider instead of floating in the
  // middle of a two-line header.
  const wrap = given(tabs) ? "flex-wrap-reverse" : "flex-wrap";
  const lead = !!onBack || given(title) || given(meta);
  return (
    <header className={`min-h-12 shrink-0 border-b border-border-subtle px-4 flex ${wrap} items-center gap-x-3`}>
      {hiddenTitle && <h1 className="sr-only">{hiddenTitle}</h1>}
      {/* Tabs never shrink: squeezed, they slid under the controls beside them. */}
      {given(tabs) && (
        <div className="shrink-0 self-stretch flex">
          <TabsInHeader.Provider value={true}>{tabs}</TabsInHeader.Provider>
        </div>
      )}
      {/* Back, title and meta stay together on a full-height line. Loose in the
          header, a wrapped first line was only as tall as its text, with Back
          touching the top of the pane, and a long title took a line of its own. */}
      {lead && (
        <div className="min-h-12 min-w-0 flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" className="-ml-3" onClick={onBack}><ArrowLeft aria-hidden />Back</Button>
          )}
          {given(title) && <h1 className="text-title font-medium text-text truncate min-w-0">{title}</h1>}
          {given(meta) && <div className="text-caption text-text-dim shrink-0">{meta}</div>}
        </div>
      )}
      {given(children) && <div className="flex-1 min-w-40 flex items-center">{children}</div>}
      {given(actions) && <div className="ml-auto py-1.5 flex flex-wrap items-center justify-end gap-2 empty:hidden">{actions}</div>}
    </header>
  );
}
