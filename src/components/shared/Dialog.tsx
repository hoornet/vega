import { useId, useRef, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { BodyPortal } from "./BodyPortal";
import { Button } from "./Button";
import { useModal } from "../../hooks/useModal";

// One dialog for everything modal.
//
// Before the October 2026 UI review the zap, quote, login and help dialogs each
// built their own backdrop, panel, close button and way out. Escape closed one
// from anywhere, one only while its text field had focus, one only while focus
// was inside it, and one by accident (the app-wide handler, which also changed
// the view behind it). None returned focus to where it came from, and none kept
// Tab from wandering into the page underneath.
//
// The rule now, the same for all of them:
//   - Escape closes it, and only it. With something open over it, that goes first.
//   - A press and release on the backdrop closes it, unless `closeOnBackdrop`
//     is false (something typed would be lost).
//   - Focus moves in when it opens, stays in while it is open, and goes back
//     to where it was when it closes.
//   - It is rendered at <body> (see BodyPortal), so it covers the whole window
//     wherever it was opened from.

const WIDTH = { sm: "max-w-xs", md: "max-w-md", lg: "max-w-2xl" } as const;

interface DialogProps {
  /** The visible heading. It names the dialog. */
  title: ReactNode;
  /** A line under the title, for the state of things ("No wallet connected"). */
  status?: ReactNode;
  onClose: () => void;
  /** `sm` is 20rem, `md` 28rem, `lg` 42rem (a sheet that shows a card). All give way to a narrower window. */
  size?: keyof typeof WIDTH;
  /** Pass false while closing would throw away something typed. Escape and the close button still work. */
  closeOnBackdrop?: boolean;
  /** Where focus goes when it closes, if not back to where it was. See `useModal`. */
  returnFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function Dialog({ title, status, onClose, size = "md", closeOnBackdrop = true, returnFocus, children }: DialogProps) {
  const titleId = useId();
  const { container: panel } = useModal(onClose, { returnFocus });
  // A text selection dragged out of the panel ends as a "click" on the
  // backdrop. Only a press that started there counts.
  const pressedOnBackdrop = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => { pressedOnBackdrop.current = e.target === e.currentTarget; };
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    const onBackdrop = pressedOnBackdrop.current && e.target === e.currentTarget;
    pressedOnBackdrop.current = false;
    if (onBackdrop && closeOnBackdrop) onClose();
  };

  return (
    <BodyPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        onPointerDown={onPointerDown}
        onClick={onBackdropClick}
      >
        {/* The height limit and the scrolling are load-bearing: the backdrop centres the
            panel and never scrolls, so without them a tall dialog puts its last button out
            of reach. The limit is a share of the backdrop, not of the viewport: this is
            inside the text-size zoom, where 85vh came out as 121% of the window at Extra
            Large text. */}
        <div
          ref={panel}
          tabIndex={-1}
          className={`${WIDTH[size]} w-full max-h-full overflow-y-auto bg-bg-raised border border-border rounded-lg shadow-2xl focus:outline-none`}
        >
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border-subtle">
            <div className="min-w-0">
              <h2 id={titleId} className="flex items-center gap-1.5 text-title font-medium text-text">{title}</h2>
              {status ? <div className="mt-0.5 text-caption">{status}</div> : null}
            </div>
            <Button variant="ghost" size="sm" className="-mr-2 -mt-0.5" onClick={onClose} aria-label="Close"><X /></Button>
          </div>
          {children}
        </div>
      </div>
    </BodyPortal>
  );
}
