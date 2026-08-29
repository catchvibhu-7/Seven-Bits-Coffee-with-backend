/**
 * SEVEN BITS COFFEE - CHOOSE YOUR STORE
 * Location: /js/ui/store-picker-modal.js
 *
 * Shown to a customer/guest (or a fully anonymous visitor) when there's
 * more than one store to pick from - see js/features/store-logic.js for
 * why this is a client-side preference, not a session/account field.
 */
import { StoreSystem } from "../features/store-logic.js";

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** @param {(storeId: number) => void} onPicked */
export function renderStorePickerModal(onPicked) {
    document.getElementById("store-picker-overlay")?.remove();
    const currentId = StoreSystem.getSelectedStoreId();

    const overlay = document.createElement("div");
    overlay.id = "store-picker-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "6000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(380px, 92vw); box-sizing: border-box; font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">CHOOSE YOUR STORE</h2>
            <p style="font-size: 8pt; color: var(--color-text-muted); margin: 0 0 16px;">Which location are you ordering from? This only sets the menu and details you see - not tied to your account, so you can switch any time.</p>
            <div style="display: grid; gap: 10px;">
                ${StoreSystem.stores
                    .map(
                        (s) => `
                <button type="button" class="store-pick-btn" data-store-id="${s.id}" style="text-align:left; background:${s.id === currentId ? "var(--color-accent)" : "var(--color-bg)"}; color:${s.id === currentId ? "var(--color-accent-contrast)" : "var(--color-text)"}; border:1px solid var(--color-accent); padding:12px 14px; cursor:pointer; font-family:inherit;">
                    <div style="font-weight:bold; font-size:10pt;">${escapeHtml(s.name)}</div>
                    ${s.address ? `<div style="font-size:8pt; opacity:0.8; margin-top:2px;">${escapeHtml(s.address)}</div>` : ""}
                </button>`
                    )
                    .join("")}
            </div>
            <button id="store-picker-cancel" style="margin-top:18px; width:100%; background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">${currentId != null ? "CANCEL" : "SKIP FOR NOW"}</button>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll(".store-pick-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const storeId = Number(btn.dataset.storeId);
            StoreSystem.setSelectedStoreId(storeId);
            overlay.remove();
            onPicked(storeId);
        });
    });
    document.getElementById("store-picker-cancel").addEventListener("click", () => overlay.remove());
}
