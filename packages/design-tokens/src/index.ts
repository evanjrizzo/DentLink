export const designTokensPackage = {
  name: "@dentlink/design-tokens",
  responsibility: "Shared visual token boundary"
} as const;

export const dentLinkBrand = {
  name: "DentLink",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  logos: {
    standard: "/icons/DentLink.png",
    dark: "/icons/DentLinkDark.png",
    compact: "/icons/DL.png"
  }
} as const;

export const dentLinkColors = {
  appBg: "#f5f6f8",
  surfaceBg: "#ffffff",
  surfaceElevated: "#fbfcff",
  textPrimary: "#171a20",
  textSecondary: "#3f4854",
  textMuted: "#6b7280",
  border: "#d8dee8",
  borderSubtle: "#e7ebf2",
  accent: "#2563eb",
  accentContrast: "#ffffff",
  success: "#15803d",
  warning: "#b45309",
  error: "#b42318",
  importanceLow: "#94a3b8",
  importanceMedium: "#2563eb",
  importanceHigh: "#b42318",
  sourceGmail: "#1d4ed8",
  sourceLocal: "#137a3a",
  selectedBg: "#eee9ff",
  hoverBg: "#f3f4f6",
  logoBg: "#ffffff",
  logoBorder: "#d8dee8"
} as const;

export const dentLinkWidgetTokens = {
  brand: dentLinkBrand,
  colors: {
    ...dentLinkColors,
    appBg: "#0c0f14",
    surfaceBg: "#141b24",
    surfaceElevated: "#1b2531",
    textPrimary: "#f4f7fb",
    textSecondary: "#d7dde6",
    textMuted: "#aab5c2",
    border: "rgba(255, 255, 255, 0.14)",
    borderSubtle: "rgba(255, 255, 255, 0.10)",
    accent: "#7c3aed",
    selectedBg: "#2e1065",
    hoverBg: "#243140"
  },
  radius: {
    logo: 4,
    card: 4,
    control: 4
  },
  typography: {
    tab: 14,
    title: 16,
    body: 13,
    metadata: 12
  }
} as const;
