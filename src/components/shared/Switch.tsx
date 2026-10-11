import { useId, type ReactNode } from "react";

// One switch for every on/off setting.
//
// Before the October 2026 UI review the same switch was written out ten times,
// with two knob implementations. Each was a bare <button>: no role and no
// state, so a screen reader could not say whether a setting was on, and two of
// the ten had no name either. One setting said on/off with a single button
// labelled "Off", which could have been the state or the action.
//
// The label is part of the component because a switch without one cannot be
// named, and clicking the label has to work.

// A switch nobody can name is the defect this replaced, so the bare control
// does not compile without one.
type Named =
  | { "aria-labelledby": string; "aria-label"?: never }
  | { "aria-label": string; "aria-labelledby"?: never };

type SwitchControlProps = Named & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Cannot be used right now. */
  disabled?: boolean;
  /**
   * A change is being applied. Unlike `disabled` it keeps keyboard focus: a
   * button that disables itself on Space drops focus to the page, and the next
   * Space does nothing.
   */
  busy?: boolean;
  /** `sm` is for a popover or another tight spot. */
  size?: "md" | "sm";
  /** For a `<label htmlFor>` in the row, so that clicking the label toggles. */
  id?: string;
  "aria-describedby"?: string;
  className?: string;
};

const TRACK = { md: "w-9 h-5", sm: "w-8 h-4" } as const;
const KNOB = { md: "w-4 h-4", sm: "w-3 h-3" } as const;

/**
 * The switch on its own, for a row that lays out its own label (label on the
 * left, switch on the right). Prefer `Switch`, which brings the label with it.
 */
export function SwitchControl({ checked, onChange, disabled = false, busy = false, size = "md", className = "", ...rest }: SwitchControlProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => { if (!busy) onChange(!checked); }}
      {...rest}
      className={`${TRACK[size]} rounded-full relative shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
        busy ? "cursor-progress opacity-60" : "cursor-pointer"
      } ${checked ? "bg-accent" : "bg-border-strong"} ${className}`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 left-0.5 ${KNOB[size]} rounded-full bg-bg transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}
      />
    </button>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What the switch turns on. Clicking it toggles too. */
  label: ReactNode;
  /** A sentence under the label: what on and off mean. */
  hint?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, hint, disabled = false, busy = false, className = "" }: SwitchProps) {
  const id = useId();
  return (
    <div className={className}>
      {/* w-fit: a label as wide as the pane makes the empty space beside the text toggle the setting. */}
      <label className={`flex w-fit max-w-full items-start gap-3 ${disabled ? "cursor-not-allowed" : busy ? "cursor-progress" : "cursor-pointer"}`}>
        <SwitchControl
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          busy={busy}
          aria-labelledby={`${id}-label`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          // 20px tall beside a 24px line of label text: 2px down centres it on the first line
          className="mt-0.5"
        />
        <span id={`${id}-label`} className={`text-body ${disabled ? "text-text-muted" : "text-text"}`}>{label}</span>
      </label>
      {/* Outside the label, under the text: a paragraph of explanation should not be a click target. */}
      {hint && <p id={`${id}-hint`} className="ml-12 mt-1 text-caption text-text-muted">{hint}</p>}
    </div>
  );
}
