import { useMemo } from "react";
const DARK = {
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
const LIGHT = {
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
export function detectThemeName() {
    const override = (process.env.JOY_THEME || "").toLowerCase();
    if (override === "dark" || override === "light")
        return override;
    const v = process.env.COLORFGBG;
    if (v) {
        const parts = v.split(";");
        const bg = Number(parts[parts.length - 1]);
        if (!Number.isNaN(bg)) {
            if (bg >= 7)
                return "light";
            if (bg >= 0)
                return "dark";
        }
    }
    // Default to dark for terminals that do not expose their background.
    return "dark";
}
export function getTheme(name) {
    const t = name ?? detectThemeName();
    return t === "light" ? LIGHT : DARK;
}
export function useTheme(name) {
    return useMemo(() => getTheme(name), [name]);
}
