/**
 * SEVEN BITS COFFEE - LIVE THEME COLORS FOR CANVAS GAMES
 * Location: /js/features/theme-colors.js
 *
 * Canvas 2D fillStyle can't read CSS custom properties the way DOM elements
 * can (a literal string like "var(--color-accent)" is just an invalid color
 * to canvas) - so any arcade game that draws on a <canvas> needs its
 * palette read out of the computed styles once, at mount time, rather than
 * hardcoding hex values that go stale the moment an admin changes the
 * branding accent/theme.
 */
export function themeColor(varName, fallback) {
    if (typeof document === "undefined") return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

/** Common palette every canvas game pulls from, read fresh each time a game
 *  mounts (branding rarely changes mid-session, so caching per-mount is
 *  plenty live without re-reading computed styles every frame). */
export function readArcadePalette() {
    return {
        bg: themeColor("--color-bg", "#0a0a0a"),
        surface: themeColor("--color-surface", "#111111"),
        border: themeColor("--color-border", "#333333"),
        text: themeColor("--color-text", "#f9fafb"),
        textMuted: themeColor("--color-text-muted", "#888888"),
        accent: themeColor("--color-accent", "#d97706"),
        cyan: themeColor("--color-cyan", "#22d3ee")
    };
}
