/**
 * SEVEN BITS COFFEE - ADD/EDIT COMBO MODAL
 * Location: /js/ui/combo-modal.js
 *
 * Lets an admin/manager pick 2+ menu items (with quantities) and set one
 * bundle price. The server validates every item id and price again on
 * save - this only builds the payload.
 */
import { currencySymbol } from "../features/config-logic.js";

const fieldStyle =
    "width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 12px;";

/**
 * @param {object} options
 * @param {Array} options.menuItems - all menu items [{id, name, price, section}]
 * @param {object} [options.combo] - existing combo to edit, or omit to add new
 * @param {(payload: object) => Promise<void>} options.onSave
 */
export function renderComboModal({ menuItems, combo = null, onSave }) {
    document.getElementById("combo-modal-overlay")?.remove();
    const isEdit = !!combo;

    const overlay = document.createElement("div");
    overlay.id = "combo-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";

    // rows state: [{id, quantity}]
    const rows = combo ? combo.items.map((i) => ({ ...i })) : [{ id: menuItems[0]?.id ?? "", quantity: 1 }, { id: menuItems[1]?.id ?? "", quantity: 1 }];

    function itemOptionsHtml(selectedId) {
        return menuItems.map((m) => `<option value="${m.id}" ${m.id === selectedId ? "selected" : ""}>${escapeHtml(m.name)} (${currencySymbol()}${m.price})</option>`).join("");
    }

    function rowsHtml() {
        return rows
            .map(
                (row, idx) => `
            <div class="combo-row" data-idx="${idx}" style="display:flex; gap:6px; align-items:center; margin-bottom:6px;">
                <select class="combo-row-item" data-idx="${idx}" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px; font-family:inherit;">
                    ${itemOptionsHtml(row.id)}
                </select>
                <input class="combo-row-qty" data-idx="${idx}" type="number" min="1" max="20" value="${row.quantity}" style="width:50px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px; font-family:inherit;" />
                <button class="combo-row-remove" data-idx="${idx}" type="button" style="background:none; border:none; color:var(--color-danger); cursor:pointer; font-size:14pt; line-height:1;">&times;</button>
            </div>
        `
            )
            .join("");
    }

    function baseTotal() {
        return rows.reduce((sum, r) => {
            const item = menuItems.find((m) => m.id === Number(r.id));
            return sum + (item ? item.price * r.quantity : 0);
        }, 0);
    }

    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(400px, 92vw); font-family: 'Courier New', monospace; max-height: 88vh; overflow-y: auto;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">${isEdit ? "EDIT COMBO" : "ADD COMBO"}</h2>
            <p id="cb-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 8px;"></p>

            <label style="font-size: 7pt; color: var(--color-text-muted);">NAME</label>
            <input id="cb-name" type="text" maxlength="60" value="${combo ? escapeHtml(combo.name) : ""}" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">DESCRIPTION (OPTIONAL)</label>
            <input id="cb-description" type="text" maxlength="160" value="${combo ? escapeHtml(combo.description || "") : ""}" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">ITEMS IN THIS COMBO</label>
            <div id="cb-rows">${rowsHtml()}</div>
            <button id="cb-add-row" type="button" style="background:none; border:1px dashed var(--color-border); color: var(--color-text-muted); padding:6px 10px; font-size:7pt; cursor:pointer; margin-bottom:12px; font-family:inherit;">+ ADD ITEM</button>

            <div style="font-size: 8pt; color: var(--color-text-muted); margin-bottom:8px;">Regular total: <span id="cb-base-total">${currencySymbol()}${baseTotal()}</span></div>

            <label style="font-size: 7pt; color: var(--color-text-muted);">COMBO PRICE (${currencySymbol()})</label>
            <input id="cb-price" type="number" min="1" step="1" value="${combo ? combo.price : ""}" style="${fieldStyle}" />

            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="cb-save" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">${isEdit ? "SAVE CHANGES" : "CREATE COMBO"}</button>
                <button id="cb-cancel" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    function rerenderRows() {
        document.getElementById("cb-rows").innerHTML = rowsHtml();
        document.getElementById("cb-base-total").textContent = `${currencySymbol()}${baseTotal()}`;
        wireRowEvents();
    }

    function wireRowEvents() {
        overlay.querySelectorAll(".combo-row-item").forEach((sel) => {
            sel.addEventListener("change", (e) => {
                rows[Number(e.target.dataset.idx)].id = Number(e.target.value);
                document.getElementById("cb-base-total").textContent = `${currencySymbol()}${baseTotal()}`;
            });
        });
        overlay.querySelectorAll(".combo-row-qty").forEach((inp) => {
            inp.addEventListener("input", (e) => {
                rows[Number(e.target.dataset.idx)].quantity = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
                document.getElementById("cb-base-total").textContent = `${currencySymbol()}${baseTotal()}`;
            });
        });
        overlay.querySelectorAll(".combo-row-remove").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                if (rows.length <= 2) return; // need at least 2 items in a combo
                rows.splice(Number(e.target.dataset.idx), 1);
                rerenderRows();
            });
        });
    }
    wireRowEvents();

    document.getElementById("cb-add-row").addEventListener("click", () => {
        rows.push({ id: menuItems[0]?.id ?? "", quantity: 1 });
        rerenderRows();
    });

    document.getElementById("cb-cancel").addEventListener("click", () => overlay.remove());
    document.getElementById("cb-save").addEventListener("click", async () => {
        const errorEl = document.getElementById("cb-error");
        errorEl.textContent = "";
        const name = document.getElementById("cb-name").value.trim();
        const description = document.getElementById("cb-description").value.trim();
        const price = Number(document.getElementById("cb-price").value);

        if (!name) return (errorEl.textContent = "Name is required");
        if (!Number.isFinite(price) || price <= 0) return (errorEl.textContent = "Enter a valid combo price");
        if (rows.length < 2) return (errorEl.textContent = "A combo needs at least 2 items");

        try {
            await onSave({ name, description, price, items: rows.map((r) => ({ id: Number(r.id), quantity: r.quantity })) });
            overlay.remove();
        } catch (e) {
            errorEl.textContent = e.message || "Could not save combo";
        }
    });
}

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
