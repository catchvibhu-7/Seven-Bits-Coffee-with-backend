/**
 * SEVEN BITS COFFEE - CHOOSE YOUR STORE
 * Location: /js/ui/store-picker-modal.js
 *
 * Shown to a customer/guest (or a fully anonymous visitor) when there's
 * more than one store to pick from - see js/features/store-logic.js for
 * why this is a client-side preference, not a session/account field.
 */
import { StoreSystem } from "../features/store-logic.js";
import { escapeHtml } from "../features/html-utils.js";

/** Great-circle distance in km - accurate enough for "which nearby store"
 *  sorting, no need for anything more precise than that. */
function distanceKm(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
            <h2 class="modal-title-header">CHOOSE YOUR STORE</h2>
            <p style="font-size: 11px; color: var(--color-text-muted); margin: 0 0 16px;">Which location are you ordering from? This only sets the menu and details you see - not tied to your account, so you can switch any time.</p>
            <div id="store-picker-list" style="display: grid; gap: 10px;"></div>
            <p id="store-picker-geo-status" style="font-size: 10px; color: var(--color-text-muted); min-height: 10px; margin: 8px 0 0;"></p>
            <button id="store-picker-cancel" style="margin-top:10px; width:100%; background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">${currentId != null ? "CANCEL" : "SKIP FOR NOW"}</button>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("store-picker-cancel").addEventListener("click", () => overlay.remove());

    function renderList(stores, distancesById) {
        const listEl = document.getElementById("store-picker-list");
        if (!listEl) return;
        listEl.innerHTML = stores
            .map((s) => {
                const distance = distancesById?.get(s.id);
                return `
                <button type="button" class="store-pick-btn" data-store-id="${s.id}" style="text-align:left; background:${s.id === currentId ? "var(--color-accent)" : "var(--color-bg)"}; color:${s.id === currentId ? "var(--color-accent-contrast)" : "var(--color-text)"}; border:1px solid var(--color-accent); padding:12px 14px; cursor:pointer; font-family:inherit;">
                    <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px;">
                        <span style="font-weight:bold; font-size:14px;">${escapeHtml(s.name)}</span>
                        ${distance != null ? `<span style="font-size:11px; opacity:0.8; white-space:nowrap;">${distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`} away</span>` : ""}
                    </div>
                    ${s.address ? `<div style="font-size:11px; opacity:0.8; margin-top:2px;">${escapeHtml(s.address)}</div>` : ""}
                </button>`;
            })
            .join("");
        listEl.querySelectorAll(".store-pick-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const storeId = Number(btn.dataset.storeId);
                StoreSystem.setSelectedStoreId(storeId);
                overlay.remove();
                onPicked(storeId);
            });
        });
    }

    renderList(StoreSystem.stores);

    // Geolocation is purely an enhancement (sort by distance, show "X away")
    // - denied permission, an unsupported browser, or no store having
    // coordinates set all fall back to the plain list above with no error
    // shown, since picking a store manually always works regardless.
    const statusEl = document.getElementById("store-picker-geo-status");
    const storesWithCoords = StoreSystem.stores.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if (navigator.geolocation && storesWithCoords.length > 0) {
        statusEl.textContent = "Finding stores near you...";
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                const distancesById = new Map(StoreSystem.stores.map((s) => [s.id, Number.isFinite(s.lat) && Number.isFinite(s.lng) ? distanceKm(latitude, longitude, s.lat, s.lng) : null]));
                const sorted = [...StoreSystem.stores].sort((a, b) => {
                    const da = distancesById.get(a.id);
                    const db = distancesById.get(b.id);
                    if (da == null && db == null) return 0;
                    if (da == null) return 1;
                    if (db == null) return -1;
                    return da - db;
                });
                renderList(sorted, distancesById);
                statusEl.textContent = "Sorted by distance from you.";
            },
            () => {
                statusEl.textContent = "";
            },
            { timeout: 8000, maximumAge: 300000 }
        );
    }
}
