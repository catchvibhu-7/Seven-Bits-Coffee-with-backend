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

            <label style="font-size: 7pt; color: var(--color-text-muted);">TABLE NUMBER</label>
            ${
                tableCount > 0
                    ? `<select id="tm-table-number" style="${fieldStyle}">${tableOptions}</select>`
                    : `<p style="font-size:8pt; color:var(--color-danger); margin:4px 0 12px;">No tables configured - set "Number of Tables" in Admin &gt; Global Settings first.</p>`
            }

            <label style="font-size: 7pt; color: var(--color-text-muted);">CUSTOMER NAME (OPTIONAL - for identifying repeat customers / discounts)</label>
            <input id="tm-customer-name" type="text" maxlength="60" value="${table ? escapeHtml(table.customerName || "") : ""}" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">CUSTOMER PHONE (OPTIONAL)</label>
            <input id="tm-customer-phone" type="tel" maxlength="15" value="${table ? escapeHtml(table.customerPhone || "") : ""}" style="${fieldStyle}" />

            ${
                !isEdit
                    ? `
            <label style="font-size: 7pt; color: var(--color-text-muted);">NOTE (OPTIONAL)</label>
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

/**
 * Shows the actual combined bill for a table (merged items across all its
 * orders) before closing it - replaces a native confirm() dialog that only
 * showed a count and a total, with no way to review what's actually on it.
 *
 * @param {object} options
 * @param {object} options.table - table session with merged .items, .subtotal, .cgst, .sgst, .serviceCharge, .tipAmount, .total (from GET /api/table-sessions/:id)
 * @param {(markPaid: boolean) => Promise<void>} options.onClose
 */
export function renderTableBillModal({ table, onClose }) {
    document.getElementById("table-bill-modal-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "table-bill-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5100";

    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(400px, 92vw); font-family: 'Courier New', monospace; max-height: 85vh; overflow-y: auto;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">TABLE ${escapeHtml(table.tableNumber)} - BILL</h2>
            ${table.customerName || table.customerPhone ? `<p style="font-size:8pt; color:var(--color-text-muted); margin: -6px 0 12px;">${escapeHtml(table.customerName || "")} ${table.customerPhone ? `(${escapeHtml(table.customerPhone)})` : ""}</p>` : ""}

            <div style="max-height: 220px; overflow-y: auto; margin: 10px 0; border-bottom: 1px dashed var(--color-border); padding-bottom: 10px;">
                ${table.items
                    .map(
                        (i) => `
                    <div style="display:flex; justify-content:space-between; font-size: 9pt; margin-bottom: 5px;">
                        <span>${i.quantity}x ${escapeHtml(i.name)} <span style="color:var(--color-text-muted); font-size:7pt;">(#${escapeHtml(i.orderId)})</span></span>
                        <span>${currencySymbol()}${(i.price * i.quantity).toFixed(2)}</span>
                    </div>
                `
                    )
                    .join("")}
            </div>

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
    document.body.appendChild(overlay);

    document.getElementById("tb-cancel").addEventListener("click", () => overlay.remove());
    document.getElementById("tb-close-paid").addEventListener("click", async () => {
        await onClose(true);
        overlay.remove();
    });
    document.getElementById("tb-close-unpaid").addEventListener("click", async () => {
        await onClose(false);
        overlay.remove();
    });
}
