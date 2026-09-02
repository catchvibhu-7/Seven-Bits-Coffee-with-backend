/**
 * SEVEN BITS COFFEE - MY ADDRESSES (delivery)
 * Location: /js/ui/address-modal.js
 *
 * Customer-only. Addresses are located by manual pin-drop on an OpenStreetMap
 * tile map (Leaflet, vendored under js/vendor + css/vendor - no geocoding
 * API, no API key, no CDN script per the CSP's script-src allowlist) rather
 * than typed-address geocoding - the customer drags/clicks a marker and we
 * just read lat/lng off it.
 */
import { AddressSystem } from "../features/address-logic.js";
import { StoreSystem } from "../features/store-logic.js";
import { escapeHtml, TRASH_ICON } from "../features/html-utils.js";
import { t } from "../features/i18n-logic.js";

// Central-India fallback when nothing better is known (no store selected, or
// the selected store has no lat/lng of its own yet) - just needs to open
// somewhere sane, the customer pans/zooms from there regardless.
const FALLBACK_CENTER = [22.9734, 78.6569];
const FALLBACK_ZOOM = 5;
const PIN_ZOOM = 15;

let leafletLoadPromise = null;
function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletLoadPromise) return leafletLoadPromise;
    leafletLoadPromise = new Promise((resolve, reject) => {
        if (!document.getElementById("leaflet-css-link")) {
            const link = document.createElement("link");
            link.id = "leaflet-css-link";
            link.rel = "stylesheet";
            link.href = "/css/vendor/leaflet.css";
            document.head.appendChild(link);
        }
        const script = document.createElement("script");
        script.src = "/js/vendor/leaflet.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(t("address.mapLoadFailed")));
        document.body.appendChild(script);
    });
    return leafletLoadPromise;
}

export function renderAddressModal() {
    document.getElementById("address-modal-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "address-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5200";
    document.body.appendChild(overlay);

    let addresses = [];
    let map = null;
    let marker = null;
    let pickedLatLng = null;

    async function renderList() {
        addresses = await AddressSystem.list();
        overlay.innerHTML = `
            <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(420px, 92vw); max-height: 85vh; overflow-y: auto; box-sizing: border-box; font-family: 'Courier New', monospace;">
                <h2 class="modal-title-header">${t("address.myAddresses")}</h2>
                ${
                    addresses.length === 0
                        ? `<p style="font-size:12px; color:var(--color-text-muted);">${t("address.noSavedAddresses")}</p>`
                        : addresses
                              .map(
                                  (a) => `
                    <div style="border:1px solid var(--color-border); padding:10px; margin-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                            <div>
                                <strong style="font-size:12px;">${escapeHtml(a.label)}</strong>
                                ${a.isDefault ? `<span style="font-size:9px; color:var(--color-accent); margin-left:6px; text-transform:uppercase;">${t("address.defaultTag")}</span>` : ""}
                                ${a.addressText ? `<div style="font-size:11px; color:var(--color-text-muted); margin-top:4px;">${escapeHtml(a.addressText)}</div>` : ""}
                                ${a.landmark || a.city || a.state || a.pincode ? `<div style="font-size:11px; color:var(--color-text-muted); margin-top:2px;">${[a.landmark, a.city, a.state, a.pincode].filter(Boolean).map(escapeHtml).join(" &middot; ")}</div>` : ""}
                            </div>
                        </div>
                        <div style="display:flex; gap:6px; margin-top:8px;">
                            <button class="admin-btn-secondary" data-edit-address="${a.id}" style="font-size:10px; padding:5px 8px;">${t("common.edit")}</button>
                            <button class="icon-btn icon-btn-danger" data-delete-address="${a.id}" title="${t("address.deleteAddressAria", { label: escapeHtml(a.label) })}" aria-label="${t("address.deleteAddressAria", { label: escapeHtml(a.label) })}">${TRASH_ICON}</button>
                            ${!a.isDefault ? `<button class="admin-btn-secondary" data-default-address="${a.id}" style="font-size:10px; padding:5px 8px;">${t("address.setDefault")}</button>` : ""}
                        </div>
                    </div>
                `
                              )
                              .join("")
                }
                <button type="button" class="admin-btn-primary" id="addr-add-new" style="width:100%; margin-top:10px;">${t("address.addAddress")}</button>
                <button id="addr-close" class="btn-close" style="margin-top: 15px; width: 100%; background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">${t("common.close")}</button>
            </div>
        `;

        document.getElementById("addr-close").addEventListener("click", () => overlay.remove());
        document.getElementById("addr-add-new").addEventListener("click", () => renderForm(null));
        overlay.querySelectorAll("[data-edit-address]").forEach((btn) => {
            btn.addEventListener("click", () => renderForm(addresses.find((a) => a.id === Number(btn.dataset.editAddress))));
        });
        overlay.querySelectorAll("[data-delete-address]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                try {
                    await AddressSystem.remove(Number(btn.dataset.deleteAddress));
                    await renderList();
                } catch (e) {
                    window.showToast?.(e.message, "error");
                }
            });
        });
        overlay.querySelectorAll("[data-default-address]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                try {
                    await AddressSystem.update(Number(btn.dataset.defaultAddress), { isDefault: true });
                    await renderList();
                } catch (e) {
                    window.showToast?.(e.message, "error");
                }
            });
        });
    }

    async function renderForm(existing) {
        overlay.innerHTML = `
            <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(460px, 92vw); max-height: 90vh; overflow-y: auto; box-sizing: border-box; font-family: 'Courier New', monospace;">
                <h2 class="modal-title-header">${existing ? t("address.editAddressTitle") : t("address.addAddressTitle")}</h2>
                <p id="addr-form-error" style="color:var(--color-danger); font-size: 11px; margin: 0 0 8px;"></p>
                <label for="addr-label" class="field-hint">${t("address.labelFieldHint")}</label>
                <input id="addr-label" type="text" maxlength="40" value="${escapeHtml(existing?.label || "")}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;" />
                <label for="addr-text" class="field-hint">${t("address.addressFieldHint")}</label>
                <textarea id="addr-text" maxlength="200" rows="2" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px; resize:vertical;">${escapeHtml(existing?.addressText || "")}</textarea>
                <label for="addr-landmark" class="field-hint">${t("address.landmarkFieldHint")}</label>
                <input id="addr-landmark" type="text" maxlength="100" value="${escapeHtml(existing?.landmark || "")}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;" />
                <div style="display:flex; gap:10px;">
                    <div style="flex:2;">
                        <label for="addr-city" class="field-hint">${t("address.cityFieldHint")}</label>
                        <input id="addr-city" type="text" maxlength="60" value="${escapeHtml(existing?.city || "")}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;" />
                    </div>
                    <div style="flex:2;">
                        <label for="addr-state" class="field-hint">${t("address.stateFieldHint")}</label>
                        <input id="addr-state" type="text" maxlength="60" value="${escapeHtml(existing?.state || "")}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;" />
                    </div>
                    <div style="flex:1;">
                        <label for="addr-pincode" class="field-hint">${t("address.pincodeFieldHint")}</label>
                        <input id="addr-pincode" type="text" inputmode="numeric" maxlength="12" value="${escapeHtml(existing?.pincode || "")}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;" />
                    </div>
                </div>
                <label for="addr-search" class="field-hint">${t("address.searchFieldHint")}</label>
                <div style="position:relative;">
                    <input id="addr-search" type="text" placeholder="${t("address.searchPlaceholder")}" autocomplete="off" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;" />
                    <div id="addr-search-results" style="display:none; position:absolute; top:100%; left:0; right:0; z-index:10; background:var(--color-surface); border:1px solid var(--color-accent); max-height:180px; overflow-y:auto;"></div>
                </div>
                <label class="field-hint">${t("address.dropPinHint")}</label>
                <div style="display:flex; justify-content:flex-end; margin:4px 0;">
                    <button type="button" id="addr-use-location" style="background:none; border:none; color:var(--color-accent); font-size:10px; text-decoration:underline; cursor:pointer; font-family:inherit; padding:0;">${t("address.useMyLocation")}</button>
                </div>
                <div id="addr-map" style="height:260px; margin:6px 0 10px; border:1px solid var(--color-border);"></div>
                <p id="addr-coords" style="font-size:10px; color:var(--color-text-muted); margin:-6px 0 10px;"></p>
                <div style="display:flex; gap:10px;">
                    <button type="button" class="admin-btn-secondary" id="addr-form-back" style="flex:1;">${t("checkout.back")}</button>
                    <button type="button" class="admin-btn-primary" id="addr-form-save" style="flex:2;">${t("common.save")}</button>
                </div>
            </div>
        `;
        document.getElementById("addr-form-back").addEventListener("click", renderList);

        pickedLatLng = existing ? { lat: existing.lat, lng: existing.lng } : null;
        updateCoordsLabel();

        try {
            await ensureLeaflet();
        } catch (e) {
            document.getElementById("addr-form-error").textContent = e.message;
            return;
        }

        const selectedStore = StoreSystem.getSelectedStore();
        const center = pickedLatLng
            ? [pickedLatLng.lat, pickedLatLng.lng]
            : selectedStore?.lat != null && selectedStore?.lng != null
              ? [selectedStore.lat, selectedStore.lng]
              : FALLBACK_CENTER;
        const zoom = pickedLatLng || (selectedStore?.lat != null && selectedStore?.lng != null) ? PIN_ZOOM : FALLBACK_ZOOM;

        map = window.L.map("addr-map").setView(center, zoom);
        window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 19
        }).addTo(map);

        if (pickedLatLng) {
            marker = window.L.marker([pickedLatLng.lat, pickedLatLng.lng]).addTo(map);
        }

        map.on("click", (e) => {
            pickedLatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
            if (marker) {
                marker.setLatLng(e.latlng);
            } else {
                marker = window.L.marker(e.latlng).addTo(map);
            }
            updateCoordsLabel();
        });

        function updateCoordsLabel() {
            const el = document.getElementById("addr-coords");
            if (!el) return;
            el.textContent = pickedLatLng ? t("address.pinSet", { lat: pickedLatLng.lat.toFixed(5), lng: pickedLatLng.lng.toFixed(5) }) : t("address.noPinSet");
        }

        function movePin(lat, lng, zoom) {
            pickedLatLng = { lat, lng };
            map.setView([lat, lng], zoom || PIN_ZOOM);
            if (marker) marker.setLatLng([lat, lng]);
            else marker = window.L.marker([lat, lng]).addTo(map);
            updateCoordsLabel();
        }

        // Nominatim (OSM's free address-search endpoint, no key) - debounced,
        // ~1 req/sec usage policy ceiling. Selecting a result auto-fills the
        // text fields and moves the pin; manual pin-drop stays available too.
        let searchTimer = null;
        const searchInput = document.getElementById("addr-search");
        const resultsBox = document.getElementById("addr-search-results");
        searchInput.addEventListener("input", () => {
            clearTimeout(searchTimer);
            const q = searchInput.value.trim();
            if (q.length < 3) {
                resultsBox.style.display = "none";
                return;
            }
            searchTimer = setTimeout(async () => {
                let results = [];
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=in&limit=5&q=${encodeURIComponent(q)}`);
                    results = await res.json();
                } catch {
                    resultsBox.style.display = "none";
                    return;
                }
                if (!results.length) {
                    resultsBox.innerHTML = `<div style="padding:8px; font-size:11px; color:var(--color-text-muted);">${t("address.noMatches")}</div>`;
                    resultsBox.style.display = "block";
                    return;
                }
                resultsBox.innerHTML = results
                    .map(
                        (r, i) => `<div data-idx="${i}" style="padding:8px; font-size:11px; cursor:pointer; border-bottom:1px solid var(--color-border);">${escapeHtml(r.display_name)}</div>`
                    )
                    .join("");
                resultsBox.style.display = "block";
                resultsBox.querySelectorAll("[data-idx]").forEach((row) => {
                    // mousedown, not click - fires before the input's blur closes this dropdown out from under it
                    row.addEventListener("mousedown", (e) => {
                        e.preventDefault();
                        const r = results[Number(row.dataset.idx)];
                        const addr = r.address || {};
                        document.getElementById("addr-text").value = r.display_name;
                        document.getElementById("addr-city").value = addr.city || addr.town || addr.village || addr.suburb || "";
                        document.getElementById("addr-state").value = addr.state || "";
                        document.getElementById("addr-pincode").value = addr.postcode || "";
                        searchInput.value = r.display_name;
                        resultsBox.style.display = "none";
                        movePin(Number(r.lat), Number(r.lon));
                    });
                });
            }, 400);
        });
        overlay.addEventListener("click", (e) => {
            if (e.target !== searchInput) resultsBox.style.display = "none";
        });

        // No geocoding API (pincode/landmark below are staff-facing text
        // only) - the browser's own GPS is the one free, instant way to
        // actually narrow the map down instead of panning/zooming by hand.
        document.getElementById("addr-use-location").addEventListener("click", () => {
            const errorEl = document.getElementById("addr-form-error");
            errorEl.textContent = "";
            if (!navigator.geolocation) {
                errorEl.textContent = t("address.geoNotSupported");
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    pickedLatLng = latlng;
                    map.setView([latlng.lat, latlng.lng], PIN_ZOOM);
                    if (marker) marker.setLatLng(latlng);
                    else marker = window.L.marker(latlng).addTo(map);
                    updateCoordsLabel();
                },
                () => {
                    errorEl.textContent = t("address.geoFailed");
                }
            );
        });

        document.getElementById("addr-form-save").addEventListener("click", async () => {
            const errorEl = document.getElementById("addr-form-error");
            errorEl.textContent = "";
            const label = document.getElementById("addr-label").value.trim();
            const addressText = document.getElementById("addr-text").value.trim();
            const landmark = document.getElementById("addr-landmark").value.trim();
            const city = document.getElementById("addr-city").value.trim();
            const state = document.getElementById("addr-state").value.trim();
            const pincode = document.getElementById("addr-pincode").value.trim();
            if (!label) {
                errorEl.textContent = t("address.giveLabel");
                return;
            }
            if (!pickedLatLng) {
                errorEl.textContent = t("address.dropPinRequired");
                return;
            }
            try {
                if (existing) {
                    await AddressSystem.update(existing.id, { label, addressText, landmark, city, state, pincode, lat: pickedLatLng.lat, lng: pickedLatLng.lng });
                } else {
                    await AddressSystem.add({ label, addressText, landmark, city, state, pincode, lat: pickedLatLng.lat, lng: pickedLatLng.lng });
                }
                await renderList();
            } catch (e) {
                errorEl.textContent = e.message;
            }
        });
    }

    renderList();
}
