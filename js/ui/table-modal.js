/**
 * SEVEN BITS COFFEE - OPEN/EDIT TABLE MODAL
 * Location: /js/ui/table-modal.js
 *
 * Replaces the native browser prompt() that used to ask for a table number -
 * that broke the terminal/monospace theme and had no room for identifying
 * the customer for loyalty/discounts. Same modal handles both opening a new
 * table and editing an already-open one (renumber if a customer asks to
 * move seats, or update who's on the tab).
 */
import { currencySymbol } from "../features/config-logic.js";
import { KitchenSystem } from "../features/kitchen-logic.js";
import { TableSessionsSystem } from "../features/table-sessions-logic.js";

let menuItemsCache = null; // lazy-loaded once for the add-items picker below
async function loadMenuItems() {
    if (!menuItemsCache) {
        const res = await fetch("/api/menu", { credentials: "include" });
        const data = res.ok ? await res.json() : { items: [] };
        menuItemsCache = (data.items || []).filter((i) => i.available !== false);
    }
    return menuItemsCache;
}

const fieldStyle =
    "width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 12px;";

/**
 * @param {object} options
 * @param {number} options.tableCount - admin-configured number of physical tables
 * @param {object} [options.table] - existing table session to edit, or omit to open a new one
 * @param {(payload: object) => Promise<void>} options.onSave
 */
export function renderTableModal({ tableCount, table = null, onSave }) {
    document.getElementById("table-modal-overlay")?.remove();
    const isEdit = !!table;

    const overlay = document.createElement("div");
    overlay.id = "table-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";

    const tableOptions = Array.from({ length: tableCount }, (_, i) => i + 1)
        .map((n) => `<option value="${n}" ${table && table.tableNumber === n ? "selected" : ""}>TABLE ${n}</option>`)
        .join("");

    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(380px, 92vw); font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">${isEdit ? "EDIT TABLE" : "OPEN TABLE"}</h2>
            <p id="tm-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 8px;"></p>

            <label for="tm-table-number" style="font-size: 7pt; color: var(--color-text-muted);">TABLE NUMBER</label>
            ${
                tableCount > 0
                    ? `<select id="tm-table-number" style="${fieldStyle}">${tableOptions}</select>`
                    : `<p style="font-size:8pt; color:var(--color-danger); margin:4px 0 12px;">No tables configured - set "Number of Tables" in Admin &gt; Global Settings first.</p>`
            }

            <label for="tm-customer-name" style="font-size: 7pt; color: var(--color-text-muted);">CUSTOMER NAME (OPTIONAL - for identifying repeat customers / discounts)</label>
            <input id="tm-customer-name" type="text" maxlength="60" value="${table ? escapeHtml(table.customerName || "") : ""}" style="${fieldStyle}" />

            <label for="tm-customer-phone" style="font-size: 7pt; color: var(--color-text-muted);">CUSTOMER PHONE (OPTIONAL)</label>
            <input id="tm-customer-phone" type="tel" maxlength="15" value="${table ? escapeHtml(table.customerPhone || "") : ""}" style="${fieldStyle}" />

            ${
                !isEdit
                    ? `
            <label for="tm-note" style="font-size: 7pt; color: var(--color-text-muted);">NOTE (OPTIONAL)</label>
            <input id="tm-note" type="text" maxlength="140" style="${fieldStyle}" />`
                    : ""
            }

            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="tm-save" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;" ${tableCount === 0 ? "disabled" : ""}>${isEdit ? "SAVE CHANGES" : "OPEN TABLE"}</button>
                <button id="tm-cancel" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("tm-cancel").addEventListener("click", () => overlay.remove());
    document.getElementById("tm-save").addEventListener("click", async () => {
        const errorEl = document.getElementById("tm-error");
        errorEl.textContent = "";
        const tableNumberEl = document.getElementById("tm-table-number");
        const payload = {
            tableNumber: tableNumberEl ? Number(tableNumberEl.value) : null,
            customerName: document.getElementById("tm-customer-name").value.trim(),
            customerPhone: document.getElementById("tm-customer-phone").value.trim()
        };
        if (!isEdit) payload.note = document.getElementById("tm-note").value.trim();

        try {
            await onSave(payload);
            overlay.remove();
        } catch (e) {
            errorEl.textContent = e.message || "Could not save";
        }
    });
}

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Converts one merged bill line back into the raw cart shape
 *  KitchenSystem.editItems()/computeOrder() expect - see the identical
 *  helper (and its combo caveat) in billing-page.js. */
function lineToRawItem(line) {
    return {
        id: line.id,
        quantity: line.quantity,
        customization: {
            size: line.size,
            milk: line.milk,
            extras: (line.extras || []).map((e) => e.key),
            notes: line.notes
        }
    };
}

/**
 * Shows the actual combined bill for a table (merged items across all its
 * orders, each line tagged with which order it came from) - doubles as the
 * table's general "manage this tab" view now, not just a pre-close review:
 * quantities can be adjusted or lines removed (editing whichever underlying
 * order that line belongs to - a table's bill is several separate order
 * records, see computeTableSessionBill() in server.js), and a "+ ADD ITEMS"
 * picker starts a brand new order attached to this same table, any time
 * before it's closed. CANCEL just dismisses without closing/settling, so
 * opening this to make a quick edit mid-meal is a normal use, not only a
 * step toward paying.
 *
 * @param {object} options
 * @param {object} options.table - table session with merged .items, .subtotal, .cgst, .sgst, .serviceCharge, .tipAmount, .total (from GET /api/table-sessions/:id)
 * @param {(markPaid: boolean) => Promise<void>} options.onClose
 * @param {() => void} [options.onDismiss] - called on a plain CANCEL (not a close action) - lets the caller refresh whatever list is showing behind this, since items may have changed without the table itself closing.
 */
export function renderTableBillModal({ table, onClose, onDismiss }) {
    document.getElementById("table-bill-modal-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "table-bill-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5100";
    document.body.appendChild(overlay);

    async function renderContent(t) {
        table = t;
        const menuItems = await loadMenuItems();
        overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(420px, 92vw); font-family: 'Courier New', monospace; max-height: 85vh; overflow-y: auto;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">TABLE ${escapeHtml(table.tableNumber)} - BILL</h2>
            ${table.customerName || table.customerPhone ? `<p style="font-size:8pt; color:var(--color-text-muted); margin: -6px 0 12px;">${escapeHtml(table.customerName || "")} ${table.customerPhone ? `(${escapeHtml(table.customerPhone)})` : ""}</p>` : ""}

            <div style="max-height: 260px; overflow-y: auto; margin: 10px 0; border-bottom: 1px dashed var(--color-border); padding-bottom: 10px;">
                ${table.items
                    .map(
                        (i, idx) => `
                    <div style="display:flex; align-items:center; gap:8px; font-size: 9pt; margin-bottom: 6px;">
                        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(i.name)} <span style="color:var(--color-text-muted); font-size:7pt;">(#${escapeHtml(i.orderId)})</span></span>
                        <span style="flex:none; display:flex; align-items:center; gap:4px;">
                            <button type="button" class="tb-item-qty-btn" data-index="${idx}" data-delta="-1" aria-label="Remove one ${escapeHtml(i.name)}" style="width:20px; height:20px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); cursor:pointer; font-family:inherit; font-size:9pt; line-height:1;">-</button>
                            <span style="width:16px; text-align:center; color:var(--color-accent); font-weight:bold;">${i.quantity}</span>
                            <button type="button" class="tb-item-qty-btn" data-index="${idx}" data-delta="1" aria-label="Add one ${escapeHtml(i.name)}" style="width:20px; height:20px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); cursor:pointer; font-family:inherit; font-size:9pt; line-height:1;">+</button>
                        </span>
                        <span style="flex:none; width:56px; text-align:right;">${currencySymbol()}${(i.price * i.quantity).toFixed(2)}</span>
                        <button type="button" class="tb-item-remove-btn" data-index="${idx}" title="Remove ${escapeHtml(i.name)}" aria-label="Remove ${escapeHtml(i.name)}" style="flex:none; background:none; border:none; color:var(--color-danger); font-size:13px; cursor:pointer; padding:0 2px;">&times;</button>
                    </div>
                `
                    )
                    .join("")}
            </div>

            <div style="display:flex; gap:6px; align-items:center; margin-bottom:14px; flex-wrap:wrap;">
                <select id="tb-add-item-select" style="flex:1 1 130px; min-width:110px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 7px; font-family:inherit; font-size:9pt;">
                    ${menuItems.map((m) => `<option value="${m.id}">${escapeHtml(m.name)} (${currencySymbol()}${m.price})</option>`).join("")}
                </select>
                <input id="tb-add-item-qty" type="number" min="1" value="1" style="width:46px; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 7px; font-family:inherit; font-size:9pt;" />
                <button type="button" id="tb-add-item-btn" style="flex:none; padding:6px 12px; background:var(--color-border); color:var(--color-text); border:none; font-size:8.5pt; font-weight:bold; letter-spacing:.05em; text-transform:uppercase; cursor:pointer;">+ Add</button>
            </div>
            <p id="tb-item-error" style="color:var(--color-danger); font-size:8pt; min-height:11px; margin:-8px 0 8px;"></p>

            <div style="font-size: 9pt; color: var(--color-text-muted); display:flex; justify-content:space-between; margin-bottom:4px;"><span>Subtotal</span><span>${currencySymbol()}${table.subtotal.toFixed(2)}</span></div>
            <div style="font-size: 9pt; color: var(--color-text-muted); display:flex; justify-content:space-between; margin-bottom:4px;"><span>CGST + SGST</span><span>${currencySymbol()}${(table.cgst + table.sgst).toFixed(2)}</span></div>
            ${table.serviceCharge ? `<div style="font-size: 9pt; color: var(--color-text-muted); display:flex; justify-content:space-between; margin-bottom:4px;"><span>Service Charge</span><span>${currencySymbol()}${table.serviceCharge.toFixed(2)}</span></div>` : ""}
            ${table.tipAmount ? `<div style="font-size: 9pt; color: var(--color-text-muted); display:flex; justify-content:space-between; margin-bottom:4px;"><span>Tip</span><span>${currencySymbol()}${table.tipAmount.toFixed(2)}</span></div>` : ""}
            <div style="font-size: 1.2rem; font-weight:bold; color:var(--color-accent); display:flex; justify-content:space-between; border-top:1px solid var(--color-accent); padding-top:10px; margin-top:6px;"><span>TOTAL</span><span>${currencySymbol()}${table.total.toFixed(2)}</span></div>

            <div style="display: grid; gap: 10px; margin-top: 20px;">
                <button id="tb-close-paid" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">CLOSE &amp; MARK PAID</button>
                <button id="tb-close-unpaid" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CLOSE AS UNPAID (SETTLE LATER)</button>
                <button id="tb-cancel" style="background: none; border: none; color: var(--color-text-muted); font-size: 7pt; cursor: pointer; text-decoration: underline; padding: 4px;">CANCEL</button>
            </div>
        </div>
    `;

        const errorEl = document.getElementById("tb-item-error");
        async function refresh() {
            const fresh = await TableSessionsSystem.get(table.id);
            if (fresh) await renderContent(fresh);
        }
        // A qty change or removal edits whichever ORDER that specific line
        // belongs to (i.orderId) - it needs that order's OWN full item list
        // (editItems replaces the whole array), reconstructed from every
        // merged line sharing the same orderId, not just the one being
        // touched.
        async function editLine(index, mutate) {
            errorEl.textContent = "";
            const line = table.items[index];
            const ordersItems = table.items.filter((i) => i.orderId === line.orderId).map(lineToRawItem);
            const posInOrder = table.items.filter((i) => i.orderId === line.orderId).indexOf(line);
            mutate(ordersItems, posInOrder);
            try {
                await KitchenSystem.editItems(line.orderId, ordersItems);
                await refresh();
            } catch (e) {
                errorEl.textContent = e.message || "Could not update items";
            }
        }
        overlay.querySelectorAll(".tb-item-qty-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const index = Number(btn.dataset.index);
                const delta = Number(btn.dataset.delta);
                editLine(index, (items, pos) => {
                    const nextQty = items[pos].quantity + delta;
                    if (nextQty <= 0) items.splice(pos, 1);
                    else items[pos].quantity = nextQty;
                });
            });
        });
        overlay.querySelectorAll(".tb-item-remove-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const index = Number(btn.dataset.index);
                const line = table.items[index];
                const remainingInOrder = table.items.filter((i) => i.orderId === line.orderId).length;
                if (remainingInOrder <= 1) {
                    errorEl.textContent = "That's the only item left on its order - remove the whole order from Billing instead.";
                    return;
                }
                editLine(index, (items, pos) => items.splice(pos, 1));
            });
        });
        document.getElementById("tb-add-item-btn").addEventListener("click", async () => {
            errorEl.textContent = "";
            const select = document.getElementById("tb-add-item-select");
            const qtyInput = document.getElementById("tb-add-item-qty");
            const id = Number(select?.value);
            const quantity = Math.max(1, parseInt(qtyInput?.value, 10) || 1);
            if (!id) return;
            try {
                await KitchenSystem.pushOrder([{ id, quantity, size: "regular", milk: "regular", extras: [], notes: "" }], "COUNTER", {
                    tableSessionId: table.id,
                    orderType: "dine-in",
                    // A brand new order normally needs a phone (or an
                    // explicit staff guest-order bypass) - reuse the table's
                    // own phone if it was opened with one, so every order on
                    // the same tab stays attributed the same way, otherwise
                    // fall back to the same walk-in bypass staff already have
                    // for a fresh counter order.
                    phone: table.customerPhone || null,
                    guestOrder: !table.customerPhone
                });
                await refresh();
            } catch (e) {
                errorEl.textContent = e.message || "Could not add item";
            }
        });

        // Refreshes whatever list is showing behind this modal (order
        // count/total per table) even on a plain cancel, since items may
        // have been added/adjusted without ever reaching a close action.
        document.getElementById("tb-cancel").addEventListener("click", () => {
            overlay.remove();
            onDismiss?.();
        });
        document.getElementById("tb-close-paid").addEventListener("click", async () => {
            await onClose(true);
            overlay.remove();
        });
        document.getElementById("tb-close-unpaid").addEventListener("click", async () => {
            await onClose(false);
            overlay.remove();
        });
    }

    renderContent(table);
}
