export function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Trash-can glyph for "delete this record" icon buttons (see .icon-btn in
 *  theme.css) - pair with a `title`/aria-label for the hover caption (the
 *  browser's own tooltip, not a themed one - see .icon-btn's own comment
 *  for why). Inline SVG rather than an icon font/emoji so it scales cleanly
 *  and always matches the button's current text color (stroke="currentColor"). */
export const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
