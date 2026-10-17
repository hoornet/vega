import type { ButtonHTMLAttributes, MouseEvent, Ref } from "react";

// One button for every action that has a label.
//
// Before the October 2026 UI review every button was the same outlined
// rectangle, written out by hand about ninety times. Zap, Follow, Mute and
// Message on a profile were told apart only by the colour of their text, the
// dim ones read as disabled, and no screen said which action was its main one.
//
// Three levels, by how much the action matters on the screen it is on:
//   primary    filled. The one thing this screen or dialog is for.
//   secondary  a quiet fill. Everything else worth a button. The default.
//   ghost      no box until hovered. Cancel, dismiss, actions in a dense row.
//
// A primary can be `danger` (the confirm of something that cannot be undone)
// or `zap` (sending sats). A ghost can be `danger`: quiet at rest, red under
// the pointer (Mute, Following). There is no coloured secondary: a status
// colour is only held at 4.5:1 on a bare surface, not on a fill. Give a
// secondary a coloured icon instead.

export type ButtonSize = "sm" | "md" | "lg";

type Look =
  | { variant?: "secondary"; tone?: never }
  | { variant: "primary"; tone?: "accent" | "danger" | "zap" }
  | { variant: "ghost"; tone?: "neutral" | "danger" };

/**
 * A button that is only an icon is `square`: as wide as it is tall, so a row
 * of them is a row of equal targets, and it must be named, because the icon
 * says nothing to a screen reader. Pass the Lucide icon as the only child.
 */
type Shape = { square: true; "aria-label": string; wrap?: never } | { square?: false };

export type ButtonProps = Look & Shape & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed" | "aria-busy"> & {
  /** `sm` for a dense row, `lg` for the single action of a form or a first-run step. */
  size?: ButtonSize;
  /** Makes it a toggle: announced as pressed or not, and drawn in the accent when on. */
  pressed?: boolean;
  /**
   * "You are here": the same look as a pressed toggle, announced as the
   * current page instead. For a sidebar's row or footer button that leads to
   * a view, which pressing again does not switch back.
   */
  current?: boolean;
  /**
   * The action is in flight. Unlike `disabled` it keeps keyboard focus: a
   * button that disables itself when pressed drops focus to the page.
   */
  busy?: boolean;
  /**
   * Let a long label wrap and the button grow, for a full-width button in a
   * narrow column (the sidebar). Otherwise a label stays on one line.
   */
  wrap?: boolean;
  ref?: Ref<HTMLButtonElement>;
};


const SIZE: Record<ButtonSize, string> = {
  sm: "text-caption [&>svg]:size-3.5",
  md: "text-ui [&>svg]:size-4",
  lg: "text-ui [&>svg]:size-4",
};

// Side padding for a label; an icon-only button is a square of its height instead.
const PAD: Record<ButtonSize, string> = { sm: "px-2", md: "px-3", lg: "px-4" };
const SQUARE: Record<ButtonSize, string> = { sm: "w-7", md: "w-8", lg: "w-10" };

// A minimum, not a fixed height: beside a field in a row that stretches its
// items, the button takes the field's height (34px with its border) instead of
// sitting 2px short of it. On its own it is 28, 32 or 40px.
const HEIGHT: Record<ButtonSize, string> = { sm: "min-h-7", md: "min-h-8", lg: "min-h-10" };

// A label stays on one line unless `wrap` is set; then the button grows with it.
const WRAP: Record<ButtonSize, string> = { sm: "py-1 whitespace-normal", md: "py-1.5 whitespace-normal", lg: "py-2.5 whitespace-normal" };

// [at rest, under the pointer]. The hover is left off while busy.
type Pair = readonly [string, string];

// The hover of a solid fill is its own token, never the fill at 90%: that lets
// the surface show through, and on a light theme it lightens the fill under a
// light label.
const PRIMARY: Record<"accent" | "danger" | "zap", Pair> = {
  accent: ["bg-accent text-accent-text", "not-disabled:hover:bg-accent-hover"],
  danger: ["bg-danger text-danger-text", "not-disabled:hover:bg-danger-hover"],
  zap: ["bg-zap text-zap-text", "not-disabled:hover:bg-zap-hover"],
};

/**
 * The secondary fill, as a percentage of the text colour: at rest, and under
 * the pointer. The theme tests compute their contrast rules from these, and a
 * Button test holds the class names below to them. Change both together.
 */
export const SECONDARY_TINT = { rest: 8, hover: 14 } as const;

// A tint of the text colour is a step from whatever surface is under it, so
// the same button works on the canvas, in the sidebar and in a dialog.
const SECONDARY: Pair = ["bg-text/8 text-text", "not-disabled:hover:bg-text/14"];

const GHOST: Record<"neutral" | "danger", Pair> = {
  neutral: ["text-text-muted", "not-disabled:hover:text-text not-disabled:hover:bg-text/8"],
  // No fill under the pointer: red text is only held at 4.5:1 on a bare surface.
  // Red under the keyboard focus too, or only mouse users are warned.
  danger: ["text-text-muted", "not-disabled:hover:text-danger focus-visible:text-danger"],
};

// A toggle that is on. A secondary takes the accent tint (the active chip). A
// ghost takes accent text and no fill, so it can sit on a row that hovers:
// accent on its own tint is not held at 4.5:1 on the hover surface.
const PRESSED: Record<"secondary" | "ghost", Pair> = {
  secondary: ["bg-accent/10 text-accent", ""],
  ghost: ["text-accent", "not-disabled:hover:bg-text/8"],
};

function look({ variant, tone }: Look, pressed: boolean | undefined): Pair {
  if (variant === "primary") return PRIMARY[tone ?? "accent"];
  if (pressed) return PRESSED[variant ?? "secondary"];
  if (variant === "ghost") return GHOST[tone ?? "neutral"];
  return SECONDARY;
}

interface Drawn {
  size?: ButtonSize;
  pressed?: boolean;
  current?: boolean;
  busy?: boolean;
  wrap?: boolean;
  square?: boolean;
}

function draw(shape: Look, { size = "md", pressed, current, busy = false, wrap = false, square = false }: Drawn): string {
  const [base, hover] = look(shape, pressed || current);
  // The one action of a form or a first-run step carries more weight. A quiet button beside it must not.
  const weight = size === "lg" && shape.variant === "primary" ? "font-medium" : "";
  // While busy the icon makes way for the spinner. The label keeps its full
  // contrast: "Publishing…" at 60% was 2.8 to 3.8:1.
  const state = busy ? "cursor-progress [&>svg]:hidden" : `cursor-pointer ${hover}`;
  return `${SIZE[size]} ${square ? SQUARE[size] : PAD[size]} ${HEIGHT[size]} ${wrap ? WRAP[size] : "whitespace-nowrap"} ${weight} ${base} ${state} inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm transition-colors [&>svg]:shrink-0 [&>svg]:stroke-[1.75] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50`;
}

/**
 * The same look for a link that has to sit beside a button and read as one (an
 * external "open" next to "connect"). An action is a `Button`; this is only
 * for something that really is a link.
 */
export function buttonClass(shape: Look & { size?: ButtonSize }): string {
  return draw(shape, { size: shape.size });
}

// The same size as the icon it stands in for, so a button with an icon keeps its width while busy.
const SPINNER: Record<ButtonSize, string> = { sm: "size-3.5", md: "size-4", lg: "size-4" };

export function Button({ variant, tone, size = "md", pressed, current, busy = false, wrap = false, square = false, className = "", type = "button", onClick, ref, children, ...rest }: ButtonProps) {
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) { e.preventDefault(); return; }
    onClick?.(e);
  };
  return (
    <button
      // Before the button's own attributes, so a caller cannot unset the state it reports.
      {...rest}
      ref={ref}
      // A bare <button> inside a form submits it. Ask for "submit" when you mean it.
      type={type}
      aria-pressed={pressed}
      aria-current={current ? "page" : undefined}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={click}
      className={`${draw({ variant, tone } as Look, { size, pressed, current, busy, wrap, square })} ${className}`}
    >
      {busy && <span aria-hidden className={`${SPINNER[size]} shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin`} />}
      {children}
    </button>
  );
}
