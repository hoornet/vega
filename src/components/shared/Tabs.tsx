import { createContext, useContext, useRef, type KeyboardEvent } from "react";

// One set of tabs for every view.
//
// Before the October 2026 UI review tabs were built five ways: in the header
// on the left (Feed, Media), in the header on the right (People), as a
// segmented control (Bookmarks), and in a row under the header in two text
// styles and two cases (Articles, Zaps, Profile). People had to look for the
// secondary navigation on each screen.
//
// Tabs are the first row under the view's header, left-aligned, in Title
// Case. The feed is the one exception: its tabs take the title's place in the
// header (pass them to ViewHeader's `tabs` slot), where the underline sits on
// the header's own divider.

/** Set by ViewHeader around its `tabs` slot, so tabs there style themselves for a header. */
export const TabsInHeader = createContext(false);

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** A total shown quietly after the label: results found, people followed. Omit for none. */
  count?: number;
  /** How many of them still need attention, shown as a badge: unread articles. Omit for none. */
  unread?: number;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  /** What these tabs choose between, for screen readers: "Feed", "Bookmarks". */
  label: string;
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** The id of the element these tabs switch. Spread `tabPanelProps` on that element. */
  panel?: string;
}

/** Marks a view's content as the panel its tabs control. */
export function tabPanelProps(panel: string, value: string) {
  return { id: panel, role: "tabpanel" as const, "aria-labelledby": `${panel}-tab-${value}` };
}

export function Tabs<T extends string>({ label, tabs, value, onChange, panel }: TabsProps<T>) {
  const inHeader = useContext(TabsInHeader);
  const listRef = useRef<HTMLDivElement>(null);

  // The one tab reachable with the Tab key: the selected one, unless it is
  // disabled or missing (Articles, Following tab, after signing out), in which
  // case the first that can be used. Otherwise the list could not be reached.
  const selectable = tabs.filter((t) => !t.disabled);
  const stop = selectable.find((t) => t.id === value)?.id ?? selectable[0]?.id;

  // Arrow keys move focus between tabs. They do not select: selecting loads
  // (the feed fetches, Podcasts fetches), and holding an arrow would start one
  // load per tab passed. Enter or Space on the focused tab selects, as a click.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 && e.key !== "Home" && e.key !== "End") return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? []);
    if (buttons.length === 0) return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? buttons.length - 1
      : at < 0 ? (step > 0 ? 0 : buttons.length - 1)
      : (at + step + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={inHeader ? "flex -ml-3" : "flex flex-wrap shrink-0 border-b border-border-subtle px-1"}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        const note = t.unread ? `${t.unread} unread` : t.count !== undefined ? String(t.count) : "";
        return (
          <button
            key={t.id}
            role="tab"
            id={panel ? `${panel}-tab-${t.id}` : undefined}
            aria-controls={panel}
            aria-selected={active}
            aria-label={note ? `${t.label}, ${note}` : undefined}
            tabIndex={t.id === stop ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={`${inHeader ? "min-h-12" : "h-9"} -mb-px px-3 inline-flex items-center gap-1.5 text-ui whitespace-nowrap border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 disabled:opacity-40 disabled:cursor-not-allowed ${
              active ? "text-text border-accent" : "text-text-muted hover:text-text border-transparent"
            }`}
          >
            {t.label}
            {t.count !== undefined && <span className="text-caption text-text-dim tabular-nums">{t.count}</span>}
            {!!t.unread && <span className="px-1.5 rounded-sm bg-accent text-accent-text text-micro tabular-nums">{t.unread}</span>}
          </button>
        );
      })}
    </div>
  );
}
