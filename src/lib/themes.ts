interface ThemeColors {
  bg: string;
  "bg-raised": string;
  "bg-hover": string;
  /** Outlines of things you can see the edge of: cards, chips, buttons. */
  border: string;
  /** Dividers between rows and regions. Meant to recede. */
  "border-subtle": string;
  /** Edges that say "you can type or switch this": inputs, selects, off toggles. */
  "border-strong": string;
  text: string;
  "text-muted": string;
  "text-dim": string;
  accent: string;
  "accent-hover": string;
  "accent-text": string;
  zap: string;
  /** A solid `zap` button under the pointer. Never `bg-zap/90`: that lets the surface show through, and on a light theme it lightens the fill under a light label. */
  "zap-hover": string;
  "zap-text": string;
  danger: string;
  /** A solid `danger` button under the pointer. */
  "danger-hover": string;
  /** Text and icons drawn on a solid `danger` fill. Never assume white: most dark themes have a light danger. */
  "danger-text": string;
  warning: string;
  success: string;
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
}

export const themes: Theme[] = [
  {
    id: "midnight",
    name: "Midnight",
    colors: {
      bg: "#0d0e12",
      "bg-raised": "#181a23",
      "bg-hover": "#1f222c",
      border: "#3d4152",
      "border-subtle": "#2b2e3a",
      "border-strong": "#60657b",
      text: "#e8e9ee",
      "text-muted": "#a9acbd",
      "text-dim": "#878a9b",
      accent: "#a78bfa",
      "accent-hover": "#bba6fc",
      "accent-text": "#14111f",
      zap: "#f5b73d",
      "zap-hover": "#d8a136",
      "zap-text": "#15161a",
      danger: "#ef5f6b",
      "danger-hover": "#f27983",
      "danger-text": "#0d0e12",
      warning: "#f5b73d",
      success: "#4cc98a",
    },
  },
  {
    id: "light",
    name: "Light",
    colors: {
      bg: "#f5f6f8",
      "bg-raised": "#ffffff",
      "bg-hover": "#e9ebf0",
      border: "#b2b4ba",
      "border-subtle": "#d1d2d7",
      "border-strong": "#8b8e97",
      text: "#1a1b22",
      "text-muted": "#4b4e5a",
      "text-dim": "#676a75",
      accent: "#6d28d9",
      "accent-hover": "#5b21b6",
      "accent-text": "#ffffff",
      zap: "#bd3f0c",
      "zap-hover": "#a6370b",
      "zap-text": "#ffffff",
      danger: "#b91c1c",
      "danger-hover": "#a31919",
      "danger-text": "#ffffff",
      warning: "#ac4f09",
      success: "#147a3a",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    colors: {
      bg: "#1e1e2e",
      "bg-raised": "#28283a",
      "bg-hover": "#313244",
      border: "#4b4e61",
      "border-subtle": "#38394c",
      "border-strong": "#6d7188",
      text: "#cdd6f4",
      "text-muted": "#aeb6d2",
      "text-dim": "#979db7",
      accent: "#cba6f7",
      "accent-hover": "#b4befe",
      "accent-text": "#1e1e2e",
      zap: "#f9e2af",
      "zap-hover": "#dbc79a",
      "zap-text": "#1e1e2e",
      danger: "#f38ba8",
      "danger-hover": "#d67a94",
      "danger-text": "#1e1e2e",
      warning: "#f9e2af",
      success: "#a6e3a1",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    colors: {
      bg: "#282828",
      "bg-raised": "#32302f",
      "bg-hover": "#3c3836",
      border: "#5c554e",
      "border-subtle": "#45413d",
      "border-strong": "#84776b",
      text: "#ebdbb2",
      "text-muted": "#d5c4a1",
      "text-dim": "#af9f8c",
      accent: "#fe821c",
      "accent-hover": "#ff9a45",
      "accent-text": "#282828",
      zap: "#fabd2f",
      "zap-hover": "#dca629",
      "zap-text": "#282828",
      danger: "#fc7b6b",
      "danger-hover": "#fc9083",
      "danger-text": "#282828",
      warning: "#fabd2f",
      success: "#b8bb26",
    },
  },
  {
    id: "nord",
    name: "Nord Frost",
    colors: {
      bg: "#2e3440",
      "bg-raised": "#353c4a",
      "bg-hover": "#3b4252",
      border: "#576174",
      "border-subtle": "#454c5c",
      "border-strong": "#7e8695",
      text: "#eceff4",
      "text-muted": "#c6cfdd",
      "text-dim": "#a4b1c8",
      accent: "#88c0d0",
      "accent-hover": "#81a1c1",
      "accent-text": "#2e3440",
      zap: "#ebcb8b",
      "zap-hover": "#cfb37a",
      "zap-text": "#2e3440",
      danger: "#e09ca2",
      "danger-hover": "#e5acb1",
      "danger-text": "#2e3440",
      warning: "#ebcb8b",
      success: "#a3be8c",
    },
  },
  {
    id: "hackerman",
    name: "Hackerman",
    colors: {
      bg: "#050708",
      "bg-raised": "#12181e",
      "bg-hover": "#161e26",
      border: "#1a4a3a",
      "border-subtle": "#113227",
      "border-strong": "#1b7247",
      text: "#18ff62",
      "text-muted": "#12c84a",
      "text-dim": "#0d9936",
      accent: "#7dffa6",
      "accent-hover": "#4cf57a",
      "accent-text": "#050708",
      zap: "#f5e042",
      "zap-hover": "#d8c53a",
      "zap-text": "#050708",
      danger: "#ff5050",
      "danger-hover": "#ff6c6c",
      "danger-text": "#050708",
      warning: "#f5e042",
      success: "#18ff62",
    },
  },
  {
    id: "reader",
    name: "Reader",
    colors: {
      bg: "#faf3e5",
      "bg-raised": "#fdf7eb",
      "bg-hover": "#f1e8d4",
      border: "#b8ad97",
      "border-subtle": "#d4cbb7",
      "border-strong": "#958c7a",
      text: "#2d2922",
      "text-muted": "#514b40",
      "text-dim": "#70685a",
      accent: "#8b4513",
      "accent-hover": "#6d3711",
      "accent-text": "#faf3e5",
      zap: "#8d6018",
      "zap-hover": "#7c5415",
      "zap-text": "#faf3e5",
      danger: "#b91c1c",
      "danger-hover": "#a31919",
      "danger-text": "#ffffff",
      warning: "#8d6018",
      success: "#48750e",
    },
  },
];

export const DEFAULT_THEME_ID = "midnight";

/**
 * Themes that were removed, and what someone who had one selected gets now.
 * Without an entry here their stored id matches nothing, no theme is applied,
 * and the app silently falls back to Midnight.
 *
 * Sepia was cut after the October 2026 UI review: it was a dark brown theme
 * (not what the name suggests), and Gruvbox and Reader already cover dark-warm
 * and light-warm.
 */
export const RETIRED_THEMES: Readonly<Record<string, string>> = {
  sepia: "gruvbox",
};

export function getTheme(id: string): Theme | undefined {
  return themes.find((t) => t.id === id);
}

export function isRetiredTheme(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(RETIRED_THEMES, id);
}

/**
 * The theme id to use for a stored one, which may be missing, retired or unknown.
 *
 * Retirements are followed to the end: if a replacement is itself retired
 * later, someone who skipped the versions in between still lands on a theme
 * and not on the default.
 */
export function resolveThemeId(stored: string | null): string {
  let id = stored ?? "";
  for (let hops = 0; isRetiredTheme(id) && hops < 10; hops++) id = RETIRED_THEMES[id];
  return getTheme(id) ? id : DEFAULT_THEME_ID;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--color-${key}`, value);
  }
}
