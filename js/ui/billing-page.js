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

    root.innerHTML = `
        <div style="display:grid; grid-template-columns:minmax(0,1fr); gap:16px;" class="billing-layout">
            <div class="billing-list-col">
                <h2 style="font-size:12.5px; font-weight:bold; letter-spacing:.2em; margin:0 0 10px; text-transform:uppercase; color:var(--color-accent);">Open bills (${openBills.length})</h2>
                ${
                    openBills.length === 0
                        ? `<p style="color:var(--color-text-muted); font-size:9pt;">Nothing open right now.</p>`
                        : openBills
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

    await renderBillDetail();
}

async function renderBillDetail() {
    const detail = document.getElementById("billing-detail");
    if (!detail) return;
    if (!selectedBill) {
        detail.innerHTML = `<p style="color:var(--color-text-muted); font-size:9pt; padding:20px 0;">Select a bill to settle it.</p>`;
        return;
    }

    let bill;
    if (selectedBill.kind === "table") {
        bill = await TableSessionsSystem.get(selectedBill.id);
        if (!bill) {
            detail.innerHTML = `<p style="color:var(--color-danger); font-size:9pt;">That table was closed elsewhere. Pick another bill.</p>`;
            selectedBill = null;
            return;
        }
    } else {
        const order = KitchenSystem.orders.find((o) => o.id === selectedBill.id);
        if (!order) {
            detail.innerHTML = `<p style="color:var(--color-danger); font-size:9pt;">That order was already settled elsewhere. Pick another bill.</p>`;
            selectedBill = null;
            return;
        }
        bill = { id: order.id, tableNumber: null, items: order.items, subtotal: order.subtotal, cgst: order.cgst, sgst: order.sgst, serviceCharge: order.serviceCharge, tipAmount: order.tipAmount, total: order.total };
    }

    detail.innerHTML = `
        <h1 style="font-size:22px; font-weight:bold; letter-spacing:2px; margin:0; text-transform:uppercase;">BILL<span style="color:var(--color-accent);">#</span>${escapeHtml(String(bill.tableNumber != null ? "T" + bill.tableNumber : bill.id))}</h1>
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
            renderBillDetail();
        });
    });
    detail.querySelector("#billing-settle-btn")?.addEventListener("click", async () => {
        const btn = detail.querySelector("#billing-settle-btn");
        btn.disabled = true;
        try {
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
