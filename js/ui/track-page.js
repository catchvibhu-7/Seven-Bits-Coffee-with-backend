/**
 * SEVEN BITS COFFEE - ORDER TRACKING (no login)
 * Location: /js/ui/track-page.js
 *
 * Reached via ?track=<token> (see the QR code on the payment confirmation
 * screen, js/ui/checkout-modal.js). No session/cookie is involved - the
 * token itself is the credential, resolved by the public
 * GET /api/orders/track/:token endpoint, which only ever returns one
 * order's status, never a full order record or a list.
 */
import { KitchenSystem } from "../features/kitchen-logic.js";
import { currencySymbol } from "../features/config-logic.js";
import { escapeHtml } from "../features/html-utils.js";

let pollTimer = null;

function renderOrder(root, order) {
    const color = KitchenSystem.STATUS_COLORS[order.status] || "var(--color-text-muted)";
    const placeText = order.orderType === "dine-in" && order.tableNumber ? `Table ${escapeHtml(order.tableNumber)}` : order.orderType === "dine-in" ? "Dine-in" : "Takeaway";

    root.innerHTML = `
        <div style="border:2px solid var(--color-accent); background:var(--color-surface); padding:24px; font-family:'Courier New', monospace;">
            <div style="font-size:12px; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Tracking order</div>
            <h1 style="margin:0 0 16px; font-size:22px;">#${escapeHtml(order.orderNumber)}</h1>
            <div style="display:inline-block; padding:6px 14px; border:1px solid ${color}; color:${color}; font-weight:bold; letter-spacing:1px; margin-bottom:16px;">${escapeHtml(order.status)}</div>
            <div style="font-size:12px; color:var(--color-text-muted); margin-bottom:18px;">${placeText} &middot; ${new Date(order.createdAt).toLocaleString()}</div>
            <div style="border-top:1px dashed var(--color-border); padding-top:14px; margin-bottom:14px;">
                ${order.items
                    .map((i) => `<div style="display:flex; justify-content:space-between; font-size:14px; padding:3px 0;"><span>${i.quantity}x ${escapeHtml(i.name)}</span></div>`)
                    .join("")}
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--color-accent); padding-top:14px;">
                <span style="font-size:12px; color:var(--color-text-muted);">${order.isPaid ? "PAID" : "PAYMENT DUE"}</span>
                <span style="font-size:16px; font-weight:bold; color:var(--color-accent);">${currencySymbol()}${order.total.toFixed(2)}</span>
            </div>
            <p style="font-size:11px; color:var(--color-text-muted); margin:20px 0 0; text-align:center;">This page updates automatically - no need to refresh.</p>
        </div>
    `;
}

function renderError(root, message) {
    root.innerHTML = `
        <div style="border:2px solid var(--color-danger); background:var(--color-surface); padding:24px; text-align:center; font-family:'Courier New', monospace;">
            <h1 style="margin:0 0 10px; font-size:18px; color:var(--color-danger);">TRACKING LINK NOT VALID</h1>
            <p style="color:var(--color-text-muted); font-size:13px;">${escapeHtml(message)}</p>
            <button id="track-error-home-btn" class="btn-primary" style="margin-top:14px; background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px 20px; font-weight: bold; cursor: pointer; font-family: inherit;">GO TO MENU</button>
        </div>
    `;
    document.getElementById("track-error-home-btn")?.addEventListener("click", () => window.showPage("home"));
}

async function fetchAndRender(root, token) {
    try {
        const res = await fetch(`/api/orders/track/${encodeURIComponent(token)}`);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            stopTrackPolling();
            renderError(root, data.error || "This tracking link is no longer valid.");
            return;
        }
        renderOrder(root, await res.json());
    } catch (e) {
        // A transient network hiccup shouldn't blank the page - leave
        // whatever was last shown and let the next poll try again.
    }
}

export function stopTrackPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
}

export function renderTrackPage(token) {
    const root = document.getElementById("track-root");
    if (!root) return;
    stopTrackPolling();
    if (!token) {
        renderError(root, "No tracking code was given.");
        return;
    }
    root.innerHTML = `<p style="color:var(--color-text-muted); font-family:'Courier New', monospace;">Loading...</p>`;
    fetchAndRender(root, token);
    pollTimer = setInterval(() => fetchAndRender(root, token), 6000);
}
