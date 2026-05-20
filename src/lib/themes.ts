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
  "accent-text": string;
  zap: string;
  "zap-text": string;
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
      bg: "#0d0e12",
      "bg-raised": "#161820",
      "bg-hover": "#1f222c",
      border: "#2b2e3a",
      "border-subtle": "#1d1f29",
      text: "#e8e9ee",
      "text-muted": "#9a9db0",
      "text-dim": "#686b7d",
      accent: "#a78bfa",
      "accent-hover": "#8b5cf6",
      "accent-text": "#ffffff",
      zap: "#f5b73d",
      "zap-text": "#15161a",
      danger: "#ef5f6b",
      warning: "#f5b73d",
      success: "#4cc98a",
    },
  },
  {
    id: "light",
    name: "Light",
    colors: {
      bg: "#fbfbfc",
      "bg-raised": "#ffffff",
      "bg-hover": "#f0f1f4",
      border: "#e2e4e9",
      "border-subtle": "#ecedf1",
      text: "#1a1b22",
      "text-muted": "#5b5f6e",
      "text-dim": "#888c98",
      accent: "#6d28d9",
      "accent-hover": "#5b21b6",
      "accent-text": "#ffffff",
      zap: "#c2410c",
      "zap-text": "#ffffff",
      danger: "#b91c1c",
      warning: "#b45309",
      success: "#15803d",
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
      "text-dim": "#8286a1",
      accent: "#cba6f7",
      "accent-hover": "#b4befe",
      "accent-text": "#1e1e2e",
      zap: "#f9e2af",
      "zap-text": "#1e1e2e",
      danger: "#f38ba8",
      warning: "#f9e2af",
      success: "#a6e3a1",
    },
  },
  {
    id: "sepia",
    name: "Sepia",
    colors: {
      bg: "#2b2018",
      "bg-raised": "#382a1f",
      "bg-hover": "#453527",
      border: "#5a4636",
      "border-subtle": "#382a1f",
      text: "#e8d5c4",
      "text-muted": "#b89c84",
      "text-dim": "#a1846c",
      accent: "#e09850",
      "accent-hover": "#c47f3a",
      "accent-text": "#2b2018",
      zap: "#f0c040",
      "zap-text": "#2b2018",
      danger: "#d45040",
      warning: "#e0a040",
      success: "#7ab860",
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
      "text-dim": "#9b8c80",
      accent: "#fe8019",
      "accent-hover": "#d65d0e",
      "accent-text": "#282828",
      zap: "#fabd2f",
      "zap-text": "#282828",
      danger: "#fb4934",
      warning: "#fabd2f",
      success: "#b8bb26",
    },
  },
  {
    id: "nord",
    name: "Nord Frost",
    colors: {
      bg: "#2e3440",
      "bg-raised": "#3b4252",
      "bg-hover": "#434c5e",
      border: "#4c566a",
      "border-subtle": "#3b4252",
      text: "#eceff4",
      "text-muted": "#d8dee9",
      "text-dim": "#8f9ebb",
      accent: "#88c0d0",
      "accent-hover": "#81a1c1",
      "accent-text": "#2e3440",
      zap: "#ebcb8b",
      "zap-text": "#2e3440",
      danger: "#bf616a",
      warning: "#ebcb8b",
      success: "#a3be8c",
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
      "text-dim": "#008d22",
      accent: "#00ff41",
      "accent-hover": "#33ff66",
      "accent-text": "#0a0a0a",
      zap: "#ffff00",
      "zap-text": "#0a0a0a",
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
