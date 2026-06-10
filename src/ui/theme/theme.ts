import { useMemo } from "react";

export interface Theme {
  name: "dark" | "light";
  // Foundation
  fg: string;          // main text
  fgMuted: string;     // dimmer text (e.g. labels)
  fgFaint: string;     // very dim (e.g. timestamps)
  // Roles
  user: string;        // human voice
  assistant: string;   // AI voice
  accent: string;      // brand / banner highlight
  tool: string;        // tool headline color
  success: string;
  failure: string;
  warn: string;
  messageFg: string;
  messageBg: string;
  // Borders / accents
  borderActive: string;
  borderIdle: string;
  borderInfo: string;
  // Box backgrounds (use sparingly — Ink only supports basic bg)
  cardBg?: string;
}

const DARK: Theme = {
  name: "dark",
  fg: "white",
  fgMuted: "gray",
  fgFaint: "blackBright",
  user: "white",
  assistant: "white",
  accent: "white",
  tool: "gray",
  success: "white",
  failure: "white",
  warn: "gray",
  messageFg: "black",
  messageBg: "white",
  borderActive: "gray",
  borderIdle: "blackBright",
  borderInfo: "blackBright",
};

const LIGHT: Theme = {
  name: "light",
  fg: "black",
  fgMuted: "blackBright",
  fgFaint: "gray",
  user: "black",
  assistant: "blackBright",
  accent: "black",
  tool: "blackBright",
  success: "black",
  failure: "black",
  warn: "blackBright",
  messageFg: "white",
  messageBg: "black",
  borderActive: "blackBright",
  borderIdle: "gray",
  borderInfo: "gray",
};

/**
 * Detect dark vs light background by looking at the COLORFGBG env var that
 * macOS Terminal, iTerm2, some VTEs, and others set when their theme changes.
 * Format is "<fg>;<bg>" where bg is a 0..15 color index (or sometimes a triplet).
 * Index 0..6 ≈ dark backgrounds, 7..15 ≈ light backgrounds.
 */
export function detectThemeName(): "dark" | "light" {
  const override = (process.env.JOY_THEME || "").toLowerCase();
  if (override === "dark" || override === "light") return override;

  const v = process.env.COLORFGBG;
  if (v) {
    const parts = v.split(";");
    const bg = Number(parts[parts.length - 1]);
    if (!Number.isNaN(bg)) {
      if (bg >= 7) return "light";
      if (bg >= 0) return "dark";
    }
  }
  // Default to dark for terminals that do not expose their background.
  return "dark";
}

export function getTheme(name?: "dark" | "light"): Theme {
  const t = name ?? detectThemeName();
  return t === "light" ? LIGHT : DARK;
}

export function useTheme(name?: "dark" | "light"): Theme {
  return useMemo(() => getTheme(name), [name]);
}
