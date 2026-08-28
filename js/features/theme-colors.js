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
