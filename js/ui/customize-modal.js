/**
 * SEVEN BITS COFFEE - CUSTOMIZE ITEM MODAL
 * Location: /js/ui/customize-modal.js
 *
 * Shown when a customer clicks a menu item. Drinks get size + milk + extras;
 * food items get extras only. Every item gets a free-text notes field. This
 * is a client-side preview only - the server re-validates every key and
 * recomputes the real price when the order is placed (see server.js
 * resolveCustomization).
 */
import { CustomizationSystem } from "../features/customization-logic.js";
import { currencySymbol } from "../features/config-logic.js";

const fieldStyle =
    "width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 12px;";

/**
 * @param {object} options
 * @param {object} options.item - the menu item {id, name, price, section, story, icon}
 * @param {(payload: {size, milk, extras, notes, quantity}) => void} options.onAdd
 */
export async function renderCustomizeModal({ item, onAdd }) {
    const opts = await CustomizationSystem.loadOptions();
    const isDrink = CustomizationSystem.isDrinkItem(item);

    document.getElementById("customize-modal-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "customize-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";

    const state = { size: "regular", milk: "regular", extras: [], notes: "", quantity: 1 };

    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(380px, 92vw); font-family: 'Courier New', monospace; max-height: 88vh; overflow-y: auto;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">${escapeHtml(item.name)}</h2>
            <p style="font-size: 8pt; color: var(--color-text-muted); margin-top:-6px;">${escapeHtml(item.story || "")}</p>

            ${
                isDrink
                    ? `
            <label style="font-size: 7pt; color: var(--color-text-muted);">SIZE</label>
            <div id="cm-size-group" class="cm-pill-group" style="display:flex; gap:8px; margin: 4px 0 12px; flex-wrap: wrap;">
                ${opts.sizeOptions
                    .map(
                        (o) => `
                    <button type="button" class="cm-pill" data-group="size" data-key="${o.key}" data-delta="${o.priceDelta}">${escapeHtml(o.label)}${o.priceDelta ? ` (+${currencySymbol()}${o.priceDelta})` : ""}</button>
                `
                    )
                    .join("")}
            </div>

            <label style="font-size: 7pt; color: var(--color-text-muted);">MILK</label>
            <div id="cm-milk-group" class="cm-pill-group" style="display:flex; gap:8px; margin: 4px 0 12px; flex-wrap: wrap;">
                ${opts.milkOptions
                    .map(
                        (o) => `
                    <button type="button" class="cm-pill" data-group="milk" data-key="${o.key}" data-delta="${o.priceDelta}">${escapeHtml(o.label)}${o.priceDelta ? ` (+${currencySymbol()}${o.priceDelta})` : ""}</button>
                `
                    )
                    .join("")}
            </div>`
                    : ""
            }

            <label style="font-size: 7pt; color: var(--color-text-muted);">EXTRAS (OPTIONAL)</label>
            <div id="cm-extras-group" class="cm-pill-group" style="display:flex; gap:8px; margin: 4px 0 12px; flex-wrap: wrap;">
                ${opts.extraOptions
                    .map(
                        (o) => `
                    <button type="button" class="cm-pill" data-group="extras" data-key="${o.key}" data-delta="${o.priceDelta}">${escapeHtml(o.label)} (+${currencySymbol()}${o.priceDelta})</button>
                `
                    )
                    .join("")}
            </div>

            <label style="font-size: 7pt; color: var(--color-text-muted);">SPECIAL INSTRUCTIONS</label>
            <textarea id="cm-notes" rows="2" maxlength="${opts.maxNotesLength}" placeholder="e.g. less ice, extra hot..." style="${fieldStyle} resize: vertical;"></textarea>

            <div style="display:flex; align-items:center; justify-content:space-between; margin: 10px 0 16px;">
                <label style="font-size: 7pt; color: var(--color-text-muted);">QUANTITY</label>
                <div class="btn-qty-container">
                    <button id="cm-qty-minus" type="button">-</button>
                    <span id="cm-qty-value">1</span>
                    <button id="cm-qty-plus" type="button">+</button>
                </div>
            </div>

            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="cm-add" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">ADD TO CART &middot; <span id="cm-total-price">${currencySymbol()}${item.price}</span></button>
                <button id="cm-cancel" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Pill selection styling helper
    function applyPillStyles() {
        overlay.querySelectorAll(".cm-pill").forEach((btn) => {
            const group = btn.dataset.group;
            const key = btn.dataset.key;
            const selected = group === "extras" ? state.extras.includes(key) : state[group] === key;
            btn.style.cssText = `padding:6px 10px; font-size:7.5pt; cursor:pointer; font-family:inherit; border:1px solid var(--color-border); background:${selected ? "var(--color-accent)" : "var(--color-bg)"}; color:${selected ? "var(--color-accent-contrast)" : "var(--color-text)"};`;
        });
    }
    applyPillStyles();

    function updateTotal() {
        const unit = CustomizationSystem.estimateUnitPrice(item.price, state);
        document.getElementById("cm-total-price").textContent = `${currencySymbol()}${(unit * state.quantity).toFixed(2)}`;
    }

    overlay.querySelectorAll(".cm-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            const group = btn.dataset.group;
            const key = btn.dataset.key;
            if (group === "extras") {
                state.extras = state.extras.includes(key) ? state.extras.filter((k) => k !== key) : [...state.extras, key];
            } else {
                state[group] = key;
            }
            applyPillStyles();
            updateTotal();
        });
    });

    document.getElementById("cm-qty-minus").addEventListener("click", () => {
        state.quantity = Math.max(1, state.quantity - 1);
        document.getElementById("cm-qty-value").textContent = state.quantity;
        updateTotal();
    });
    document.getElementById("cm-qty-plus").addEventListener("click", () => {
        state.quantity = Math.min(50, state.quantity + 1);
        document.getElementById("cm-qty-value").textContent = state.quantity;
        updateTotal();
    });
    document.getElementById("cm-notes").addEventListener("input", (e) => {
        state.notes = e.target.value;
    });

    document.getElementById("cm-cancel").addEventListener("click", () => overlay.remove());
    document.getElementById("cm-add").addEventListener("click", () => {
        onAdd({ ...state, extras: [...state.extras] });
        overlay.remove();
    });
}

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
