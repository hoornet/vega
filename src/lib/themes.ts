interface ThemeColors {
  bg: string;
  "bg-raised": string;
  "bg-hover": string;
  border: string;
  "border-subtle": string;
  text: string;
  "text-muted": string;
  "text-dim": string;
  accent: string;
  "accent-hover": string;
  zap: string;
  danger: string;
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
      bg: "#0a0a0a",
      "bg-raised": "#111111",
      "bg-hover": "#1a1a1a",
      border: "#222222",
      "border-subtle": "#1a1a1a",
      text: "#e0e0e0",
      "text-muted": "#777777",
      "text-dim": "#555555",
      accent: "#8b5cf6",
      "accent-hover": "#7c3aed",
      zap: "#f59e0b",
      danger: "#ef4444",
      warning: "#f59e0b",
      success: "#22c55e",
    },
  },
  {
    id: "light",
    name: "Light",
    colors: {
      bg: "#f5f5f5",
      "bg-raised": "#ffffff",
      "bg-hover": "#e8e8e8",
      border: "#d4d4d4",
      "border-subtle": "#e5e5e5",
      text: "#1a1a1a",
      "text-muted": "#6b7280",
      "text-dim": "#9ca3af",
      accent: "#7c3aed",
      "accent-hover": "#6d28d9",
      zap: "#d97706",
      danger: "#dc2626",
      warning: "#d97706",
      success: "#16a34a",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    colors: {
      bg: "#1e1e2e",
      "bg-raised": "#313244",
      "bg-hover": "#45475a",
      border: "#45475a",
      "border-subtle": "#313244",
      text: "#cdd6f4",
      "text-muted": "#a6adc8",
      "text-dim": "#6c7086",
      accent: "#cba6f7",
      "accent-hover": "#b4befe",
      zap: "#f9e2af",
      danger: "#f38ba8",
      warning: "#f9e2af",
      success: "#a6e3a1",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    colors: {
      bg: "#1a1b26",
      "bg-raised": "#24283b",
      "bg-hover": "#292e42",
      border: "#3b4261",
      "border-subtle": "#292e42",
      text: "#a9b1d6",
      "text-muted": "#565f89",
      "text-dim": "#3b4261",
      accent: "#7aa2f7",
      "accent-hover": "#89b4fa",
      zap: "#e0af68",
      danger: "#f7768e",
      warning: "#e0af68",
      success: "#9ece6a",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    colors: {
      bg: "#282828",
      "bg-raised": "#3c3836",
      "bg-hover": "#504945",
      border: "#504945",
      "border-subtle": "#3c3836",
      text: "#ebdbb2",
      "text-muted": "#a89984",
      "text-dim": "#665c54",
      accent: "#fe8019",
      "accent-hover": "#d65d0e",
      zap: "#fabd2f",
      danger: "#fb4934",
      warning: "#fabd2f",
      success: "#b8bb26",
    },
  },
  {
    id: "ethereal",
    name: "Ethereal",
    colors: {
      bg: "#1a1a2e",
      "bg-raised": "#16213e",
      "bg-hover": "#1f2f50",
      border: "#2a3a5c",
      "border-subtle": "#1f2f50",
      text: "#dfe6e9",
      "text-muted": "#a0aec0",
      "text-dim": "#5a6a8a",
      accent: "#a29bfe",
      "accent-hover": "#6c5ce7",
      zap: "#ffeaa7",
      danger: "#ff7675",
      warning: "#ffeaa7",
      success: "#55efc4",
    },
  },
  {
    id: "hackerman",
    name: "Hackerman",
    colors: {
      bg: "#0a0a0a",
      "bg-raised": "#0d1117",
      "bg-hover": "#161b22",
      border: "#1a2332",
      "border-subtle": "#131a24",
      text: "#00ff41",
      "text-muted": "#00bb2d",
      "text-dim": "#006b1a",
      accent: "#00ff41",
      "accent-hover": "#33ff66",
      zap: "#ffff00",
      danger: "#ff0000",
      warning: "#ffff00",
      success: "#00ff41",
    },
  },
];

export const DEFAULT_THEME_ID = "midnight";

export function getTheme(id: string): Theme | undefined {
  return themes.find((t) => t.id === id);
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--color-${key}`, value);
  }
}
