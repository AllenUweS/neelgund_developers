type ColorPalette = {
  text: string;
  textSecondary: string;
  background: string;
  card: string;
  border: string;
  tint: string;
  tabIconDefault: string;
  tabIconSelected: string;
  brand: string;
  brandDark: string;
  accent: string;
  success: string;
  danger: string;
  warning: string;
  surface: string;
  surfaceSecondary: string;
  placeholder: string;
  overlay: string;
};

export type Theme = {
  colors: ColorPalette;
  spacing: (factor: number) => number;
  radius: number;
  elevation: (level: number) => number;
  // Add any other design tokens you need.
};

const lightColors: ColorPalette = {
  text: "#0F1923",
  textSecondary: "#64748B",
  background: "#F8FAFC",
  card: "#FFFFFF",
  border: "#E2E8F0",
  tint: "#1B4F8A",
  tabIconDefault: "#94A3B8",
  tabIconSelected: "#1B4F8A",
  brand: "#1B4F8A",
  brandDark: "#0D2F5A",
  accent: "#F4A820",
  success: "#22C55E",
  danger: "#EF4444",
  warning: "#F59E0B",
  surface: "#FFFFFF",
  surfaceSecondary: "#F1F5F9",
  placeholder: "#94A3B8",
  overlay: "rgba(15, 25, 35, 0.5)",
};

// Simple utility helpers for spacing and elevation.
const spacing = (factor: number) => factor * 8; // 8px grid
const elevation = (level: number) => level; // placeholder – can map to shadow presets later.

export const lightTheme: Theme = {
  colors: lightColors,
  spacing,
  radius: 8,
  elevation,
};

// Dark theme can be added later – for now we expose only light.
export const darkTheme: Theme = {
  colors: {
    ...lightColors,
    background: "#0F1923",
    card: "#1A202C",
    text: "#F1F5F9",
    textSecondary: "#A0AEC0",
    surface: "#1A202C",
    surfaceSecondary: "#2D3748",
    overlay: "rgba(255,255,255,0.3)",
  },
  spacing,
  radius: 8,
  elevation,
};

export const theme = {
  light: lightTheme,
  dark: darkTheme,
};

