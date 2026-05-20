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
      bg: "#2a1e15",
      "bg-raised": "#362718",
      "bg-hover": "#45301f",
      border: "#564030",
      "border-subtle": "#34251a",
      text: "#ece1cf",
      "text-muted": "#b29a82",
      "text-dim": "#8a7560",
      accent: "#e89e58",
      "accent-hover": "#d18545",
      "accent-text": "#2a1e15",
      zap: "#f5c668",
      "zap-text": "#2a1e15",
      danger: "#db5d52",
      warning: "#e89e58",
      success: "#88c177",
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
      bg: "#050708",
      "bg-raised": "#0c1218",
      "bg-hover": "#161e26",
      border: "#1a2632",
      "border-subtle": "#101820",
      text: "#18ff62",
      "text-muted": "#0eb840",
      "text-dim": "#0a7e2a",
      accent: "#7dffa6",
      "accent-hover": "#4cf57a",
      "accent-text": "#050708",
      zap: "#f5e042",
      "zap-text": "#050708",
      danger: "#ff5050",
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
      border: "#d9cdb3",
      "border-subtle": "#ebe2cc",
      text: "#2d2922",
      "text-muted": "#6a6253",
      "text-dim": "#948b78",
      accent: "#8b4513",
      "accent-hover": "#6d3711",
      "accent-text": "#faf3e5",
      zap: "#b7791f",
      "zap-text": "#faf3e5",
      danger: "#b91c1c",
      warning: "#b7791f",
      success: "#4d7c0f",
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
