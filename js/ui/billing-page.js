/**
 * SEVEN BITS COFFEE - BILLING (staff dashboard)
 * Location: /js/ui/billing-page.js
 *
 * Unifies the two kinds of "still needs settling" that used to only be
 * reachable separately: open table sessions (TableSessionsSystem, merged
 * multi-order tabs) and standalone unpaid counter/takeaway orders
 * (KitchenSystem, single order). Both settle through the same payment-
 * method selector - a real capability this app didn't have before (orders
 * only ever tracked isPaid true/false, never HOW). Table-session billing
 * still also works from Orders > TABLES/TABS (unchanged) - this page is a
 * second, more direct way to reach the exact same settle action, not a
 * replacement for it.
 */
import { TableSessionsSystem } from "../features/table-sessions-logic.js";
import { KitchenSystem } from "../features/kitchen-logic.js";

const PAYMENT_METHODS = [
    { key: "UPI", note: "Scan / VPA" },
    { key: "Card", note: "Tap / insert" },
    { key: "Cash", note: "Drawer" },
    { key: "Wallet", note: "7Bits credit" }
];

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function money(n) {
    return "₹" + Number(n || 0).toFixed(2);
}

let selectedBill = null; // { kind: "table"|"order", id }
let selectedMethod = "Cash";
let billingPage = 1; // 1-based; open-bills list pagination
const BILLING_PAGE_SIZE = 10;
let printableBill = null; // set by renderBillDetail() once a bill resolves - what the Print panel's buttons act on

/** Adapts a resolved bill (table-session or standalone-order shape) into
 *  the order-shaped object window.printBill()/window.printKOT() (app.js)
 *  already expect - reusing those exact print templates instead of a
 *  separate one just for this page. */
function billToPrintableOrder(bill, kind) {
    return {
        id: bill.id,
        orderNumber: kind === "table" ? `TABLE ${bill.tableNumber}` : bill.orderNumber || bill.id,
        createdAt: bill.createdAt || bill.openedAt || new Date().toISOString(),
        tableNumber: bill.tableNumber || null,
        method: kind === "table" ? "TABLE" : bill.method || "COUNTER",
        items: bill.items,
        subtotal: bill.subtotal,
        promoDiscountTotal: bill.promoDiscountTotal || 0,
        discountAmount: bill.discountAmount || 0,
        couponCode: bill.couponCode || null,
        cgst: bill.cgst || 0,
        sgst: bill.sgst || 0,
        serviceChargeActive: !!bill.serviceCharge,
        serviceCharge: bill.serviceCharge || 0,
        tipApplied: !!bill.tipAmount,
        tipAmount: bill.tipAmount || 0,
        total: bill.total
    };
}

/** Pre-selects a bill (e.g. right after staff creates a new order at
 *  checkout) so the Billing page opens straight to it instead of whatever
 *  the highest-total open bill happens to be. */
export function selectBillForOrder(orderId) {
    selectedBill = { kind: "order", id: orderId };
    selectedMethod = "Cash";
    billingPage = 1;
}

export async function renderBillingPage() {
    const root = document.getElementById("billing-root");
    if (!root) return;
    root.innerHTML = `<p style="color:var(--color-text-muted); font-size:9pt;">Loading open bills…</p>`;

    const [openTables, allOrders] = await Promise.all([TableSessionsSystem.list("open"), KitchenSystem.fetchOrders()]);
    const standaloneOrders = KitchenSystem.orders.filter((o) => !o.isPaid && !o.tableSessionId);

    const openBills = [
        ...openTables.map((t) => ({ kind: "table", id: t.id, label: `TABLE ${t.tableNumber}`, sub: t.customerName || `${t.orderCount} order${t.orderCount === 1 ? "" : "s"}`, total: t.total })),
        ...standaloneOrders.map((o) => ({ kind: "order", id: o.id, label: `#${o.orderNumber || o.id}`, sub: o.method === "ONLINE" ? "Online order" : o.method || "Counter", total: o.total }))
    ].sort((a, b) => b.total - a.total);

    // Keep whatever was selected if it's still open; otherwise default to the first bill.
    if (selectedBill && !openBills.some((b) => b.kind === selectedBill.kind && b.id === selectedBill.id)) {
        selectedBill = null;
    }
    if (!selectedBill && openBills.length > 0) {
        selectedBill = { kind: openBills[0].kind, id: openBills[0].id };
    }

    const totalPages = Math.max(1, Math.ceil(openBills.length / BILLING_PAGE_SIZE));
    billingPage = Math.min(Math.max(1, billingPage), totalPages);
    const pageStart = (billingPage - 1) * BILLING_PAGE_SIZE;
    const pageBills = openBills.slice(pageStart, pageStart + BILLING_PAGE_SIZE);

    const pagerHtml =
        totalPages > 1
            ? `
        <div class="menu-pager" style="margin-top:auto;">
            <button type="button" class="admin-pg-btn" data-page="1" ${billingPage <= 1 ? "disabled" : ""} title="First page">«</button>
            <button type="button" class="admin-pg-btn" data-page="${billingPage - 1}" ${billingPage <= 1 ? "disabled" : ""} title="Previous page">‹</button>
            <span class="menu-pager-label">${pageStart + 1}-${Math.min(pageStart + BILLING_PAGE_SIZE, openBills.length)} of ${openBills.length}</span>
            <button type="button" class="admin-pg-btn" data-page="${billingPage + 1}" ${billingPage >= totalPages ? "disabled" : ""} title="Next page">›</button>
            <button type="button" class="admin-pg-btn" data-page="${totalPages}" ${billingPage >= totalPages ? "disabled" : ""} title="Last page">»</button>
        </div>`
            : "";

    root.innerHTML = `
        <div style="display:grid; grid-template-columns:minmax(0,1fr); gap:16px;" class="billing-layout">
            <div class="billing-left-col">
                <!-- Acts on whichever bill is selected below - see
                     printableBill/billToPrintableOrder() and the click
                     handlers wired after renderBillDetail() resolves it. -->
                <div class="billing-print-panel">
                    <h2 style="font-size:11px; font-weight:bold; letter-spacing:.18em; margin:0 0 10px; text-transform:uppercase; color:var(--color-accent);">Print / Reprint</h2>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <button type="button" id="billing-print-kot-btn" class="billing-print-btn" ${selectedBill ? "" : "disabled"}>[ Print KOT ]</button>
                        <button type="button" id="billing-print-bill-btn" class="billing-print-btn" ${selectedBill ? "" : "disabled"}>[ Print bill ]</button>
                    </div>
                </div>

                <div class="billing-list-col">
                    <h2 style="font-size:12.5px; font-weight:bold; letter-spacing:.2em; margin:0 0 10px; text-transform:uppercase; color:var(--color-accent);">Open bills (${openBills.length})</h2>
                    <div class="billing-list-scroll">
                        ${
                            pageBills.length === 0
                                ? `<p style="color:var(--color-text-muted); font-size:9pt;">Nothing open right now.</p>`
                                : pageBills
                                      .map(
                                          (b) => `
                            <button type="button" class="billing-list-item${selectedBill && selectedBill.kind === b.kind && selectedBill.id === b.id ? " active" : ""}" data-kind="${b.kind}" data-id="${escapeHtml(String(b.id))}">
                                <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(b.label)} <span style="color:var(--color-text-muted); font-weight:normal;">&middot; ${escapeHtml(b.sub)}</span></span>
                                <span style="flex:none; font-weight:bold;">${money(b.total)}</span>
                            </button>
                        `
                                      )
                                      .join("")
                        }
                    </div>
                    ${pagerHtml}
                </div>
            </div>
            <div class="billing-detail-col" id="billing-detail"></div>
        </div>
    `;

    root.querySelectorAll(".billing-list-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            selectedBill = { kind: btn.dataset.kind, id: btn.dataset.kind === "table" ? btn.dataset.id : btn.dataset.id };
            selectedMethod = "Cash";
            renderBillingPage();
        });
    });
    root.querySelectorAll(".billing-list-col [data-page]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const page = Number(btn.dataset.page);
            if (!page || page < 1 || page > totalPages) return;
            billingPage = page;
            renderBillingPage();
        });
    });

    await renderBillDetail();

    // Wired here (not in the markup above) since printableBill is only set
    // once renderBillDetail() resolves the selection.
    document.getElementById("billing-print-kot-btn")?.addEventListener("click", () => {
        if (printableBill) window.printKOT?.(printableBill);
    });
    document.getElementById("billing-print-bill-btn")?.addEventListener("click", () => {
        if (printableBill) window.printBill?.(printableBill);
    });
}

async function renderBillDetail() {
    const detail = document.getElementById("billing-detail");
    if (!detail) return;
    if (!selectedBill) {
        printableBill = null;
        detail.innerHTML = `<p style="color:var(--color-text-muted); font-size:9pt; padding:20px 0;">Select a bill to settle it.</p>`;
        return;
    }

    let bill;
    let order = null; // only set for a standalone order bill - see the tag-info section below
    if (selectedBill.kind === "table") {
        bill = await TableSessionsSystem.get(selectedBill.id);
        if (!bill) {
            printableBill = null;
            detail.innerHTML = `<p style="color:var(--color-danger); font-size:9pt;">That table was closed elsewhere. Pick another bill.</p>`;
            selectedBill = null;
            return;
        }
        printableBill = billToPrintableOrder(bill, "table");
    } else {
        order = KitchenSystem.orders.find((o) => o.id === selectedBill.id);
        if (!order) {
            printableBill = null;
            detail.innerHTML = `<p style="color:var(--color-danger); font-size:9pt;">That order was already settled elsewhere. Pick another bill.</p>`;
            selectedBill = null;
            return;
        }
        bill = { id: order.id, orderNumber: order.orderNumber, tableNumber: null, items: order.items, subtotal: order.subtotal, cgst: order.cgst, sgst: order.sgst, serviceCharge: order.serviceCharge, tipAmount: order.tipAmount, total: order.total };
        // The raw order (not the trimmed `bill` above) already matches what
        // window.printBill()/printKOT() expect exactly - orderNumber,
        // createdAt, method, promo/coupon fields and all - so print from
        // that directly instead of re-deriving a lossier copy.
        printableBill = order;
    }

    // Tag who a standalone order is for (phone/username - a guest order or a
    // staff typo may have left this blank/wrong) and which physical table,
    // if any - not shown for a table-session bill, which already has both
    // from when the tab was opened. No separate save button - whatever's in
    // these fields is picked up when Settle is clicked (see below), same as
    // any other bill detail that's read fresh at settle time.
    const tagInfoHtml = order
        ? `
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px; flex-wrap:wrap;">
            <div style="flex:0 1 100px;">
                <label style="display:block; font-size:8px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase; margin-bottom:3px;">Table</label>
                <input id="billing-tag-table" type="text" maxlength="20" value="${escapeHtml(order.tableNumber || "")}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit; font-size:10px;" />
            </div>
            <div style="flex:0 1 220px;">
                <label style="display:block; font-size:8px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase; margin-bottom:3px;">Phone / Username</label>
                <input id="billing-tag-phone" type="text" maxlength="60" value="${escapeHtml(order.customerPhone || order.customerName || "")}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit; font-size:10px;" />
            </div>
        </div>`
        : "";

    detail.innerHTML = `
        <h1 style="font-size:22px; font-weight:bold; letter-spacing:2px; margin:0; text-transform:uppercase;">BILL<span style="color:var(--color-accent);">#</span>${escapeHtml(String(bill.tableNumber != null ? "T" + bill.tableNumber : bill.orderNumber || bill.id))}</h1>
        ${tagInfoHtml}
        <div style="background:var(--color-surface); border:1px solid var(--color-border); margin-top:14px;">
            <div style="display:flex; gap:12px; padding:9px 14px; background:var(--color-bg); border-bottom:1px solid var(--color-border); font-size:9px; letter-spacing:.12em; color:var(--color-text-muted); text-transform:uppercase;">
                <span style="flex:1 1 100px; min-width:80px;">Item</span><span style="flex:none; width:32px; text-align:center;">Qty</span><span style="flex:none; width:64px; text-align:right;">Amount</span>
            </div>
            ${bill.items
                .map(
                    (l) => `
                <div style="display:flex; gap:12px; align-items:center; padding:10px 14px; border-bottom:1px dashed var(--color-border); font-size:11px;">
                    <span style="flex:1 1 100px; min-width:80px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(l.name)}</span>
                    <span style="flex:none; width:32px; text-align:center; color:var(--color-accent); font-weight:bold;">${l.quantity}</span>
                    <span style="flex:none; width:64px; text-align:right; font-weight:bold;">${money(l.price * l.quantity)}</span>
                </div>
            `
                )
                .join("")}
            <div style="padding:13px 14px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; justify-content:space-between; font-size:10.5px; color:var(--color-text-muted);"><span>SUBTOTAL</span><span>${money(bill.subtotal)}</span></div>
                <div style="display:flex; justify-content:space-between; font-size:10.5px; color:var(--color-text-muted);"><span>CGST + SGST</span><span>${money((bill.cgst || 0) + (bill.sgst || 0))}</span></div>
                ${bill.serviceCharge ? `<div style="display:flex; justify-content:space-between; font-size:10.5px; color:var(--color-text-muted);"><span>SERVICE CHARGE</span><span>${money(bill.serviceCharge)}</span></div>` : ""}
                ${bill.tipAmount ? `<div style="display:flex; justify-content:space-between; font-size:10.5px; color:var(--color-cyan);"><span>TIP</span><span>${money(bill.tipAmount)}</span></div>` : ""}
                <div style="display:flex; justify-content:space-between; align-items:baseline; border-top:1px solid var(--color-border); margin-top:4px; padding-top:11px;">
                    <span style="font-size:11px; font-weight:bold; letter-spacing:.1em;">AMOUNT PAYABLE</span>
                    <span style="font-size:24px; font-weight:bold; color:var(--color-accent);">${money(bill.total)}</span>
                </div>
            </div>
        </div>

        <div style="background:var(--color-surface); border:1px solid var(--color-border); margin-top:12px; padding:16px;">
            <div style="font-size:9px; letter-spacing:.14em; color:var(--color-text-muted); text-transform:uppercase; border-left:4px solid var(--color-accent); padding-left:10px;">Settle payment</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:8px; margin-top:13px;">
                ${PAYMENT_METHODS.map(
                    (p) => `
                    <button type="button" class="billing-pay-method${selectedMethod === p.key ? " active" : ""}" data-method="${p.key}">
                        <div style="font-size:11px; font-weight:bold; letter-spacing:.08em; text-transform:uppercase;">${p.key}</div>
                        <div style="font-size:9px; color:var(--color-text-muted); margin-top:4px; text-transform:uppercase;">${p.note}</div>
                    </button>
                `
                ).join("")}
            </div>
            <button type="button" id="billing-settle-btn" style="width:100%; margin-top:14px; padding:13px; background:var(--color-accent); color:var(--color-accent-contrast); border:none; font-size:11.5px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; cursor:pointer; min-height:44px;">[ Settle ${money(bill.total)} by ${selectedMethod} ]</button>
        </div>
    `;

    detail.querySelectorAll(".billing-pay-method").forEach((btn) => {
        btn.addEventListener("click", () => {
            selectedMethod = btn.dataset.method;
            // Toggles the active method + settle button label in place
            // instead of a full renderBillDetail() - a full re-render would
            // read the table/phone fields back from the (still-unsaved)
            // order object and silently discard whatever staff just typed.
            detail.querySelectorAll(".billing-pay-method").forEach((b) => b.classList.toggle("active", b === btn));
            const settleBtn = detail.querySelector("#billing-settle-btn");
            if (settleBtn) settleBtn.textContent = `[ Settle ${money(bill.total)} by ${selectedMethod} ]`;
        });
    });
    detail.querySelector("#billing-settle-btn")?.addEventListener("click", async () => {
        const btn = detail.querySelector("#billing-settle-btn");
        btn.disabled = true;
        try {
            // Whatever's currently in the table/phone fields is saved as part
            // of settling - no separate save step for a standalone order.
            if (order) {
                await KitchenSystem.tagOrderInfo(order.id, {
                    contact: detail.querySelector("#billing-tag-phone").value,
                    tableNumber: detail.querySelector("#billing-tag-table").value
                });
            }
            if (selectedBill.kind === "table") {
                await TableSessionsSystem.close(selectedBill.id, true, selectedMethod);
            } else {
                await KitchenSystem.markPaid(selectedBill.id, selectedMethod);
            }
            window.showToast?.(`Settled ${money(bill.total)} by ${selectedMethod}`);
            selectedBill = null;
            await renderBillingPage();
        } catch (e) {
            window.showToast?.(e.message || "Could not settle", "error");
            btn.disabled = false;
        }
    });
}
