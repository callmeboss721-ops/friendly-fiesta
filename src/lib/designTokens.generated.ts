// Generated from tokens/ce-empire-2026.json. Do not edit directly.
export const ceTokens = {
  "color": {
    "canvas": "#050814",
    "surface": "#0A1220",
    "surfaceRaised": "#0E1A2C",
    "text": "#D7F4FF",
    "textMuted": "#A8C6D4",
    "brand": "#5EE7FF",
    "success": "#1EE08A",
    "danger": "#FF3355"
  },
  "spacing": {
    "1": "0.25rem",
    "2": "0.5rem",
    "3": "0.75rem",
    "4": "1rem",
    "5": "1.25rem",
    "6": "1.5rem"
  },
  "radius": {
    "sm": "0.5rem",
    "md": "0.75rem",
    "lg": "1rem",
    "xl": "1.25rem"
  },
  "motion": {
    "fast": "140ms",
    "normal": "220ms",
    "slow": "420ms"
  },
  "elevation": {
    "panel": "0 16px 48px rgba(0, 0, 0, 0.28)",
    "brand": "0 0 28px rgba(94, 231, 255, 0.14)"
  },
  "typography": {
    "body": "var(--font-noto-thai)",
    "display": "var(--font-noto-thai)",
    "mono": "var(--font-geist-mono)"
  }
} as const;

export type CeTokenColor = keyof typeof ceTokens.color;
