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
import { AdminConfig, currencySymbol } from "../features/config-logic.js";
import { AuthSystem } from "../features/auth-logic.js";
import { StoreSystem } from "../features/store-logic.js";
import { PayrollSystem } from "../features/payroll-logic.js";

export const PAYMENT_METHODS = [
    { key: "UPI", note: "Scan / VPA" },
    { key: "Card", note: "Tap / insert" },
    { key: "Cash", note: "Drawer" },
    { key: "Wallet", note: "7Bits credit" }
];

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function money(n) {
    return currencySymbol() + Number(n || 0).toFixed(2);
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

/** Same store switcher concept as the Orders/Kitchen page (see app.js's
 *  ensureKitchenStoreSwitcher) - a multi-store account (owner, unrestricted/
 *  Global Admin, or a Local Admin whose storeAccess spans more than one
 *  store) narrows Billing down to one store at a time via the same shared
 *  StoreSystem.getStaffSelectedStoreId() value, so picking a store on
 *  either page carries over to the other. A manager/employee never sees
 *  this - they're always pinned to their own single store server-side. */
async function buildStoreSwitcherHtml(session) {
    if (!StoreSystem.isMultiStoreStaff(session)) return "";
    const allStores = await PayrollSystem.fetchStores();
    const stores = session.role === "admin" && session.storeAccess ? allStores.filter((s) => session.storeAccess.includes(s.id)) : allStores;
    if (stores.length <= 1) return "";
    const currentId = StoreSystem.getStaffSelectedStoreId();
    return `
        <select id="billing-store-select" aria-label="Store" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px 10px; font-family:inherit; font-size:11px; margin-bottom:12px;">
            <option value="">ALL MY STORES</option>
            ${stores.map((s) => `<option value="${s.id}" ${currentId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
        </select>
    `;
}

/** Client-side mirror of server.js's computeOrderGroupBill()/
 *  splitDueSettled() - merges a root order + everything staff have attached
 *  to it (see attachedToOrderId) into one combined bill for display/print,
 *  same shape a table-session bill already has (items tagged per-line with
 *  orderId/isPaid, dueTotal/settledTotal split) so both bill kinds can share
 *  one rendering path below. */
function mergeOrderGroup(orders) {
    const root = orders[0];
    const dueOrders = orders.filter((o) => !o.isPaid);
    const paidOrders = orders.filter((o) => o.isPaid);
    const mergedItems = [];
    orders.forEach((o) => o.items.forEach((i) => mergedItems.push({ ...i, orderId: o.id, isPaid: o.isPaid })));
    const sum = (list, f) => round2(list.reduce((s, o) => s + (o[f] || 0), 0));
    return {
        ...root,
        items: mergedItems,
        subtotal: sum(orders, "subtotal"),
        cgst: sum(orders, "cgst"),
        sgst: sum(orders, "sgst"),
        serviceCharge: sum(orders, "serviceCharge"),
        tipAmount: sum(orders, "tipAmount"),
        total: sum(orders, "total"),
        dueTotal: sum(dueOrders, "total"),
        settledTotal: sum(paidOrders, "total"),
        dueOrderCount: dueOrders.length
    };
}

let selectedBill = null; // { kind: "table"|"order", id }
let selectedMethod = "Cash";
let billingPage = 1; // 1-based; open-bills list pagination
const BILLING_PAGE_SIZE = 10;
let printableBill = null; // set by renderBillDetail() once a bill resolves - what the Print panel's buttons act on
let menuItemsCache = null; // lazy-loaded once for the "add item" picker below
async function loadMenuItems() {
    if (!menuItemsCache) {
        const res = await fetch("/api/menu", { credentials: "include" });
        const data = res.ok ? await res.json() : { items: [] };
        menuItemsCache = (data.items || []).filter((i) => i.available !== false);
    }
    return menuItemsCache;
}

/** Converts one of THIS order's own already-priced lines back into the raw
 *  cart shape KitchenSystem.editItems()/computeOrder() expect (id/quantity/
 *  customization) - the server re-prices from scratch rather than trusting
 *  whatever price the line currently shows, same as a fresh order. A combo
 *  line's grouping doesn't survive this round-trip (its exploded component
 *  lines get resubmitted as plain items at their own price, not the combo's
 *  bundle price) - an accepted gap for now, since this editor exists to fix
 *  a discrepancy on ordinary lines, not to rebuild a combo. */
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
    root.innerHTML = `<p style="color:var(--color-text-muted); font-size:12px;">Loading open bills…</p>`;

    const [openTables, allOrders, session] = await Promise.all([TableSessionsSystem.list("open"), KitchenSystem.fetchOrders(), AuthSystem.getSession()]);
    const storeSwitcherHtml = await buildStoreSwitcherHtml(session);
    // Attached (non-root) orders aren't a separate bill of their own - they
    // only ever show up merged into their root's detail view (see
    // renderBillDetail()'s group handling) - listing them here too would
    // show the same money twice. A root that's personally already paid
    // still belongs in this list if something ATTACHED to it is still due -
    // otherwise a staff-attached follow-up order would have nowhere to be
    // found/settled from (its own root never appears in the list to select).
    const standaloneOrders = KitchenSystem.orders.filter((o) => {
        if (o.tableSessionId || o.attachedToOrderId) return false;
        if (!o.isPaid) return true;
        return KitchenSystem.orders.some((x) => x.attachedToOrderId === o.id && !x.isPaid);
    });

    const openBills = [
        ...openTables.map((t) => ({ kind: "table", id: t.id, label: `TABLE ${t.tableNumber}`, sub: t.customerName || `${t.orderCount} order${t.orderCount === 1 ? "" : "s"}`, total: t.total })),
        ...standaloneOrders.map((o) => {
            const linked = KitchenSystem.orders.filter((x) => x.attachedToOrderId === o.id);
            return {
                kind: "order",
                id: o.id,
                label: `#${o.orderNumber || o.id}`,
                sub: linked.length > 0 ? `+${linked.length} linked order${linked.length === 1 ? "" : "s"}` : o.method === "ONLINE" ? "Online order" : o.method || "Counter",
                total: round2(o.total + linked.reduce((s, x) => s + x.total, 0))
            };
        })
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
            <button type="button" class="admin-pg-btn" data-page="1" ${billingPage <= 1 ? "disabled" : ""} title="First page" aria-label="First page">«</button>
            <button type="button" class="admin-pg-btn" data-page="${billingPage - 1}" ${billingPage <= 1 ? "disabled" : ""} title="Previous page" aria-label="Previous page">‹</button>
            <span class="menu-pager-label"><strong style="color:var(--color-accent);">${pageStart + 1}-${Math.min(pageStart + BILLING_PAGE_SIZE, openBills.length)}</strong> of ${openBills.length}</span>
            <button type="button" class="admin-pg-btn" data-page="${billingPage + 1}" ${billingPage >= totalPages ? "disabled" : ""} title="Next page" aria-label="Next page">›</button>
            <button type="button" class="admin-pg-btn" data-page="${totalPages}" ${billingPage >= totalPages ? "disabled" : ""} title="Last page" aria-label="Last page">»</button>
        </div>`
            : "";

    root.innerHTML = `
        ${storeSwitcherHtml}
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
                    <h2 style="font-size:13px; font-weight:bold; letter-spacing:.2em; margin:0 0 10px; text-transform:uppercase; color:var(--color-accent);">Open bills (${openBills.length})</h2>
                    <div class="billing-list-scroll">
                        ${
                            pageBills.length === 0
                                ? `<p style="color:var(--color-text-muted); font-size:12px;">Nothing open right now.</p>`
                                : pageBills
                                      .map((b) => {
                                          const isActive = !!(selectedBill && selectedBill.kind === b.kind && selectedBill.id === b.id);
                                          return `
                            <button type="button" class="billing-list-item${isActive ? " active" : ""}" aria-current="${isActive ? "true" : "false"}" data-kind="${b.kind}" data-id="${escapeHtml(String(b.id))}">
                                <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(b.label)} <span style="color:var(--color-text-muted); font-weight:normal;">&middot; ${escapeHtml(b.sub)}</span></span>
                                <span style="flex:none; font-weight:bold;">${money(b.total)}</span>
                            </button>
                        `;
                                      })
                                      .join("")
                        }
                    </div>
                    ${pagerHtml}
                </div>
            </div>
            <div class="billing-detail-col" id="billing-detail"></div>
        </div>
    `;

    document.getElementById("billing-store-select")?.addEventListener("change", (e) => {
        StoreSystem.setStaffSelectedStoreId(e.target.value ? Number(e.target.value) : null);
        selectedBill = null;
        billingPage = 1;
        renderBillingPage();
    });

    root.querySelectorAll(".billing-list-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            // dataset.id is always a string - a table session's own id really
            // is a string (TBL-XXXXXX), but an order's id is a real number
            // now, so only that branch needs coercion or every KitchenSystem
            // lookup against selectedBill.id below silently returns undefined.
            selectedBill = { kind: btn.dataset.kind, id: btn.dataset.kind === "order" ? Number(btn.dataset.id) : btn.dataset.id };
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
        detail.innerHTML = `<p style="color:var(--color-text-muted); font-size:12px; padding:20px 0;">Select a bill to settle it.</p>`;
        return;
    }

    let bill;
    let order = null; // the single order, OR the ROOT order of a group - tag-info/adjust-bill act on this alone, never the group as a whole
    let group = null; // [order, ...attachedOrders] when there's more than one order on this bill, else null
    if (selectedBill.kind === "table") {
        bill = await TableSessionsSystem.get(selectedBill.id);
        if (!bill) {
            printableBill = null;
            detail.innerHTML = `<p style="color:var(--color-danger); font-size:12px;">That table was closed elsewhere. Pick another bill.</p>`;
            selectedBill = null;
            return;
        }
        printableBill = billToPrintableOrder(bill, "table");
    } else {
        const found = KitchenSystem.orders.find((o) => o.id === selectedBill.id);
        if (!found) {
            printableBill = null;
            detail.innerHTML = `<p style="color:var(--color-danger); font-size:12px;">That order was already settled elsewhere. Pick another bill.</p>`;
            selectedBill = null;
            return;
        }
        // Always resolve to the ROOT of an attach chain, so selecting either
        // the root or something attached to it lands on the same combined
        // view - there's no separate "just the attached order" view.
        order = found.attachedToOrderId ? KitchenSystem.orders.find((o) => o.id === found.attachedToOrderId) || found : found;
        const attached = KitchenSystem.orders.filter((o) => o.attachedToOrderId === order.id);
        if (attached.length > 0) {
            group = [order, ...attached];
            bill = mergeOrderGroup(group);
            printableBill = bill;
        } else {
            bill = {
                id: order.id,
                orderNumber: order.orderNumber,
                tableNumber: null,
                items: order.items,
                subtotal: order.subtotal,
                discountAmount: order.discountAmount,
                couponCode: order.couponCode,
                cgst: order.cgst,
                sgst: order.sgst,
                serviceCharge: order.serviceCharge,
                tipAmount: order.tipAmount,
                total: order.total
            };
            // The raw order (not the trimmed `bill` above) already matches what
            // window.printBill()/printKOT() expect exactly - orderNumber,
            // createdAt, method, promo/coupon fields and all - so print from
            // that directly instead of re-deriving a lossier copy.
            printableBill = order;
        }
    }

    // Tag who a standalone order is for (phone/username - a guest order or a
    // staff typo may have left this blank/wrong) and which physical table,
    // if any - not shown for a table-session bill, which already has both
    // from when the tab was opened. No separate save button - whatever's in
    // these fields is picked up when Settle is clicked (see below), same as
    // any other bill detail that's read fresh at settle time.
    // An employee session gets customerPhone back pre-masked from the
    // server (e.g. "9876XXXXXX" - see server.js's redactCustomerPhones()) -
    // that string must never round-trip back into a save. It fails the
    // server's own phone-shape check (contains letters), so tagInfo's
    // auto-detect would misfile it as a NAME instead and overwrite the real
    // one - readonly here, and skipped entirely from the settle payload
    // below, rather than relying on the server rejecting it after the fact.
    const phoneIsMasked = /^\d{4}X+$/.test(order?.customerPhone || "");
    const tagInfoHtml = order && !group
        ? `
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px; flex-wrap:wrap;">
            <div style="flex:0 1 100px;">
                <label style="display:block; font-size:8px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase; margin-bottom:3px;">Table</label>
                <input id="billing-tag-table" type="text" maxlength="20" value="${escapeHtml(order.tableNumber || "")}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit; font-size:10px;" />
            </div>
            <div style="flex:0 1 220px;">
                <label style="display:block; font-size:8px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase; margin-bottom:3px;">Phone / Username${phoneIsMasked ? " (manager+ only)" : ""}</label>
                <input id="billing-tag-phone" type="text" maxlength="60" value="${escapeHtml(order.customerPhone || order.customerName || "")}" ${phoneIsMasked ? "readonly" : ""} autocomplete="off" spellcheck="false" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:${phoneIsMasked ? "var(--color-text-muted)" : "var(--color-text)"}; padding:6px 8px; font-family:inherit; font-size:10px;" />
            </div>
        </div>`
        : "";

    // A staff member settling a bill needs a way to fix a discrepancy
    // (wrong quantity, an item that shouldn't have made it on, a forgotten
    // one) before locking it in - only possible for a standalone order that
    // hasn't been paid yet, not a table-session bill (its .items are merged
    // from several separate order records, each needing its own edit
    // target - out of scope for this pass, see renderTablesPanel's own
    // "+ ADD ITEMS" instead for adding more to an open table).
    // With a group, "+ Add item" needs exactly ONE unpaid order to target -
    // if staff have attached more than one still-unsettled order to the same
    // root (rare), adding a brand new line is ambiguous, so the control is
    // hidden until only one is left due; per-LINE qty/remove editing doesn't
    // have this problem since each existing line already know which order
    // it belongs to (see lineEditable below).
    const unpaidInGroup = group ? group.filter((o) => !o.isPaid) : null;
    const addItemTargetOrder = group ? (unpaidInGroup.length === 1 ? unpaidInGroup[0] : null) : order && !order.isPaid ? order : null;
    const menuItemsForPicker = addItemTargetOrder ? await loadMenuItems() : [];

    const cfg = AdminConfig.settings || {};
    const cgstPct = ((cfg.cgstRate ?? 0.05) * 100).toFixed(1);
    const sgstPct = ((cfg.sgstRate ?? 0.05) * 100).toFixed(1);

    // Service charge/tip toggles, coupon, and loyalty redemption - only for
    // a standalone order (not a table-session bill, which settles through
    // its own existing close flow) and only once the order hasn't been
    // settled yet.
    const adjustBillHtml =
        order && !group && !order.isPaid
            ? `
        <div style="background:var(--color-surface); border:1px solid var(--color-border); margin-top:12px; padding:16px;">
            <div style="font-size:9px; letter-spacing:.14em; color:var(--color-text-muted); text-transform:uppercase; border-left:4px solid var(--color-accent); padding-left:10px;">Adjust bill</div>
            <label style="display:flex; align-items:center; gap:8px; font-size:11px; margin-top:13px; cursor:pointer;">
                <input type="checkbox" id="billing-adjust-service" ${order.serviceChargeActive ? "checked" : ""} />
                Service charge (${((cfg.serviceChargeRate ?? 0.02) * 100).toFixed(1)}%)
            </label>
            ${
                cfg.tipEnabled
                    ? `
            <label style="display:flex; align-items:center; gap:8px; font-size:11px; margin-top:10px; cursor:pointer;">
                <input type="checkbox" id="billing-adjust-tip" ${order.tipApplied ? "checked" : ""} />
                Tip (${money(cfg.tipAmount || 0)})
            </label>`
                    : ""
            }
            <div style="display:flex; gap:8px; align-items:flex-end; margin-top:13px;">
                <div style="flex:1;">
                    <label style="display:block; font-size:8px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase; margin-bottom:3px;">Coupon code</label>
                    <input id="billing-adjust-coupon" type="text" maxlength="24" value="${escapeHtml(order.couponCode || "")}" placeholder="OPTIONAL" autocomplete="off" spellcheck="false" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:10px; text-transform:uppercase;" />
                </div>
                ${
                    order.customerId
                        ? `
                <div style="flex:0 0 110px;">
                    <label style="display:block; font-size:8px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase; margin-bottom:3px;">Redeem pts</label>
                    <input id="billing-adjust-points" type="number" min="0" value="${order.loyaltyPointsRedeemed || ""}" placeholder="0" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:10px;" />
                </div>`
                        : ""
                }
            </div>
            <p id="billing-adjust-error" style="color:var(--color-danger); font-size:9px; min-height:12px; margin:8px 0 0;"></p>
            <button type="button" id="billing-adjust-apply" style="width:100%; margin-top:6px; padding:11px; background:var(--color-border); color:var(--color-text); border:none; font-size:11px; font-weight:bold; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; min-height:40px;">Update bill</button>
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
                .map((l, i) => {
                    // A group line knows its own paid state (l.isPaid, see
                    // mergeOrderGroup()); a plain single-order bill's lines
                    // don't carry that field at all, so they're all editable
                    // or none are, matching the whole order's own isPaid. A
                    // table bill has neither group nor order set at all
                    // (item editing was never supported for table bills here
                    // - see the file's own header comment) - never editable.
                    const lineEditable = group ? !l.isPaid : order ? !order.isPaid : false;
                    return `
                <div style="display:flex; gap:12px; align-items:center; padding:10px 14px; border-bottom:1px dashed var(--color-border); font-size:11px;">
                    <span style="flex:1 1 100px; min-width:80px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(l.name)}</span>
                    ${
                        lineEditable
                            ? `<span style="flex:none; display:flex; align-items:center; gap:4px;">
                            <button type="button" class="billing-item-qty-btn" data-index="${i}" data-delta="-1" aria-label="Remove one ${escapeHtml(l.name)}" style="width:22px; height:22px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); cursor:pointer; font-family:inherit;">-</button>
                            <span style="width:18px; text-align:center; color:var(--color-accent); font-weight:bold;">${l.quantity}</span>
                            <button type="button" class="billing-item-qty-btn" data-index="${i}" data-delta="1" aria-label="Add one ${escapeHtml(l.name)}" style="width:22px; height:22px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); cursor:pointer; font-family:inherit;">+</button>
                        </span>`
                            : `<span style="flex:none; width:32px; text-align:center; color:var(--color-accent); font-weight:bold;">${l.quantity}</span>`
                    }
                    <span style="flex:none; width:64px; text-align:right; font-weight:bold;">${money(l.price * l.quantity)}</span>
                    ${lineEditable ? `<button type="button" class="billing-item-remove-btn" data-index="${i}" title="Remove ${escapeHtml(l.name)}" aria-label="Remove ${escapeHtml(l.name)}" style="flex:none; background:none; border:none; color:var(--color-danger); font-size:14px; cursor:pointer; padding:0 2px;">&times;</button>` : ""}
                </div>
            `;
                })
                .join("")}
            ${
                group && !addItemTargetOrder && unpaidInGroup.length > 1
                    ? `<p style="font-size:10px; color:var(--color-text-muted); padding:10px 14px 0; margin:0;">More than one order on this bill is still unpaid - open each order's own bill to add items to it.</p>`
                    : ""
            }
            ${
                addItemTargetOrder
                    ? `
            <div id="billing-add-item-row" style="padding:10px 14px; display:flex; justify-content:flex-end;">
                <button type="button" id="billing-add-item-toggle" style="padding:7px 14px; background:var(--color-border); color:var(--color-text); border:none; font-size:10px; font-weight:bold; letter-spacing:.06em; text-transform:uppercase; cursor:pointer;">+ Add item</button>
            </div>`
                    : ""
            }
            <div style="padding:13px 14px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--color-text-muted);"><span>SUBTOTAL</span><span>${money(bill.subtotal)}</span></div>
                ${bill.discountAmount ? `<div style="display:flex; justify-content:space-between; font-size:11px; color:var(--color-success);"><span>DISCOUNT${bill.couponCode ? ` (${escapeHtml(bill.couponCode)})` : ""}</span><span>-${money(bill.discountAmount)}</span></div>` : ""}
                <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--color-text-muted);"><span>CGST (${cgstPct}%)</span><span>${money(bill.cgst || 0)}</span></div>
                <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--color-text-muted);"><span>SGST (${sgstPct}%)</span><span>${money(bill.sgst || 0)}</span></div>
                ${bill.serviceCharge ? `<div style="display:flex; justify-content:space-between; font-size:11px; color:var(--color-text-muted);"><span>SERVICE CHARGE</span><span>${money(bill.serviceCharge)}</span></div>` : ""}
                ${bill.tipAmount ? `<div style="display:flex; justify-content:space-between; font-size:11px; color:var(--color-cyan);"><span>TIP</span><span>${money(bill.tipAmount)}</span></div>` : ""}
                ${
                    bill.settledTotal > 0
                        ? `
                <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--color-success);"><span>ALREADY SETTLED</span><span>${money(bill.settledTotal)}</span></div>
                <div style="display:flex; justify-content:space-between; align-items:baseline; border-top:1px solid var(--color-border); margin-top:4px; padding-top:11px;">
                    <span style="font-size:11px; font-weight:bold; letter-spacing:.1em;">DUE NOW</span>
                    <span style="font-size:24px; font-weight:bold; color:var(--color-accent);">${money(bill.dueTotal || 0)}</span>
                </div>`
                        : `
                <div style="display:flex; justify-content:space-between; align-items:baseline; border-top:1px solid var(--color-border); margin-top:4px; padding-top:11px;">
                    <span style="font-size:11px; font-weight:bold; letter-spacing:.1em;">AMOUNT PAYABLE</span>
                    <span style="font-size:24px; font-weight:bold; color:var(--color-accent);">${money(bill.total)}</span>
                </div>`
                }
            </div>
        </div>
        ${
            selectedBill.kind === "order"
                ? `<button type="button" id="billing-new-order-for-bill" style="width:100%; margin-top:10px; padding:10px; background:none; border:1px dashed var(--color-accent); color:var(--color-accent); font-size:10px; font-weight:bold; letter-spacing:.06em; text-transform:uppercase; cursor:pointer;">+ New order for this bill</button>`
                : ""
        }
        ${adjustBillHtml}

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
            <button type="button" id="billing-settle-btn" style="width:100%; margin-top:14px; padding:13px; background:var(--color-accent); color:var(--color-accent-contrast); border:none; font-size:12px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; cursor:pointer; min-height:44px;">[ Settle ${money(bill.settledTotal > 0 ? bill.dueTotal || 0 : bill.total)} by ${selectedMethod} ]</button>
        </div>
    `;

    // A line's edit target is whichever underlying order it actually belongs
    // to - a plain single-order bill only ever has one (order.id itself); a
    // merged group tags each line with its own orderId (see
    // mergeOrderGroup()), same idea as table-modal.js's editLine().
    async function editLine(index, mutate) {
        const line = bill.items[index];
        const targetOrderId = line.orderId || order.id;
        const targetOrder = group ? group.find((o) => o.id === targetOrderId) : order;
        const siblingLines = bill.items.filter((i) => (i.orderId || order.id) === targetOrderId);
        const rawItems = siblingLines.map(lineToRawItem);
        const posInOrder = siblingLines.indexOf(line);
        mutate(rawItems, posInOrder);
        try {
            await KitchenSystem.editItems(targetOrder.id, rawItems);
            window.showToast?.("Items updated");
            await renderBillDetail();
        } catch (e) {
            window.showToast?.(e.message || "Could not update items", "error");
        }
    }
    detail.querySelectorAll(".billing-item-qty-btn").forEach((btn) => {
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
    detail.querySelectorAll(".billing-item-remove-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const index = Number(btn.dataset.index);
            const line = bill.items[index];
            const targetOrderId = line.orderId || order.id;
            const remainingInOrder = bill.items.filter((i) => (i.orderId || order.id) === targetOrderId).length;
            if (remainingInOrder <= 1) {
                window.showToast?.("That's the only item left on its order - remove the whole order instead.", "error");
                return;
            }
            editLine(index, (items, pos) => items.splice(pos, 1));
        });
    });
    // The add-item control starts as just a right-aligned button - expanding
    // it into a search field + qty + confirm only on click keeps the bill
    // detail visually calm when nobody's actively adding anything, matching
    // every other "EDIT" section in this app that opens a form on demand
    // rather than always showing one.
    const addItemRow = detail.querySelector("#billing-add-item-row");
    addItemRow?.querySelector("#billing-add-item-toggle")?.addEventListener("click", () => {
        addItemRow.innerHTML = `
            <div style="flex:1 1 160px; min-width:140px; position:relative;">
                <input id="billing-add-item-search" type="text" autocomplete="off" placeholder="Search item..." style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:10px;" />
                <div id="billing-add-item-results" style="display:none; position:absolute; top:100%; left:0; right:0; margin-top:2px; z-index:20; background:var(--color-surface); border:1px solid var(--color-accent); box-shadow:4px 4px 0 rgba(0,0,0,0.4); max-height:180px; overflow-y:auto;"></div>
            </div>
            <input id="billing-add-item-qty" type="number" min="1" value="1" style="width:52px; flex:none; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:10px;" />
            <button type="button" id="billing-add-item-btn" style="flex:none; padding:7px 14px; background:var(--color-accent); color:var(--color-accent-contrast); border:none; font-size:10px; font-weight:bold; letter-spacing:.06em; text-transform:uppercase; cursor:pointer;">Add</button>
            <button type="button" id="billing-add-item-cancel" style="flex:none; padding:7px 10px; background:none; border:none; color:var(--color-text-muted); font-size:10px; text-transform:uppercase; cursor:pointer;">Cancel</button>
        `;
        addItemRow.style.cssText = "padding:10px 14px; display:flex; gap:8px; align-items:flex-start; flex-wrap:wrap;";

        const searchInput = addItemRow.querySelector("#billing-add-item-search");
        const resultsEl = addItemRow.querySelector("#billing-add-item-results");
        let selectedItem = null;

        const renderResults = (query) => {
            const q = query.trim().toLowerCase();
            const matches = (q ? menuItemsForPicker.filter((m) => m.name.toLowerCase().includes(q)) : menuItemsForPicker).slice(0, 8);
            if (!matches.length) {
                resultsEl.style.display = "none";
                resultsEl.innerHTML = "";
                return;
            }
            resultsEl.innerHTML = matches
                .map(
                    (m) => `
                <button type="button" class="billing-add-item-result" data-id="${m.id}" style="display:block; width:100%; text-align:left; padding:8px 10px; background:none; border:none; border-bottom:1px solid var(--color-border); color:var(--color-text); font-family:inherit; font-size:10px; cursor:pointer;">${escapeHtml(m.name)} <span style="color:var(--color-text-muted);">(${money(m.price)})</span></button>
            `
                )
                .join("");
            resultsEl.style.display = "block";
            resultsEl.querySelectorAll(".billing-add-item-result").forEach((btn) => {
                // mousedown (not click) fires before the input's blur, so the
                // dropdown doesn't close itself out from under the click.
                btn.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    selectedItem = menuItemsForPicker.find((m) => m.id === Number(btn.dataset.id));
                    searchInput.value = selectedItem?.name || "";
                    resultsEl.style.display = "none";
                });
            });
        };

        searchInput.addEventListener("input", () => {
            selectedItem = null; // typing invalidates whatever was picked before
            renderResults(searchInput.value);
        });
        searchInput.addEventListener("focus", () => renderResults(searchInput.value));
        searchInput.addEventListener("blur", () => {
            setTimeout(() => (resultsEl.style.display = "none"), 150);
        });

        addItemRow.querySelector("#billing-add-item-cancel").addEventListener("click", () => renderBillDetail());
        addItemRow.querySelector("#billing-add-item-btn").addEventListener("click", () => {
            const qtyInput = addItemRow.querySelector("#billing-add-item-qty");
            const quantity = Math.max(1, parseInt(qtyInput?.value, 10) || 1);
            if (!selectedItem) {
                searchInput.style.borderColor = "var(--color-danger)";
                searchInput.focus();
                return;
            }
            const rawItems = addItemTargetOrder.items.map(lineToRawItem);
            // "regular"/"regular", no extras/notes - the same default shape the
            // customer-facing ADD BIT stepper uses (see defaultCartKey() in
            // app.js) - merges into an existing plain line for the same item
            // instead of always adding a new row, matching that same behavior.
            const isDefault = (c) => (c.size === "regular" || !c.size) && (c.milk === "regular" || !c.milk) && !(c.extras || []).length && !c.notes;
            const existing = rawItems.find((r) => r.id === selectedItem.id && isDefault(r.customization));
            if (existing) existing.quantity += quantity;
            else rawItems.push({ id: selectedItem.id, quantity, customization: { size: "regular", milk: "regular", extras: [], notes: "" } });
            KitchenSystem.editItems(addItemTargetOrder.id, rawItems)
                .then(() => {
                    window.showToast?.("Items updated");
                    renderBillDetail();
                })
                .catch((e) => window.showToast?.(e.message || "Could not update items", "error"));
        });
        searchInput.focus();
    });

    // Enter in either field applies the same update as clicking the button -
    // neither field has its own save action, and there's no surrounding
    // <form> here (this whole detail panel is a div tree) to submit on Enter
    // for free. Deliberately not wired for the table/phone fields above,
    // since those sit next to Settle - an accidental Enter there should not
    // risk settling a payment.
    detail.querySelectorAll("#billing-adjust-coupon, #billing-adjust-points").forEach((el) => {
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                detail.querySelector("#billing-adjust-apply")?.click();
            }
        });
    });
    detail.querySelector("#billing-adjust-apply")?.addEventListener("click", async () => {
        const btn = detail.querySelector("#billing-adjust-apply");
        const errorEl = detail.querySelector("#billing-adjust-error");
        errorEl.textContent = "";
        btn.disabled = true;
        try {
            await KitchenSystem.adjustBill(order.id, {
                serviceChargeActive: detail.querySelector("#billing-adjust-service").checked,
                tipApplied: detail.querySelector("#billing-adjust-tip")?.checked || false,
                couponCode: detail.querySelector("#billing-adjust-coupon").value.trim(),
                redeemPoints: parseInt(detail.querySelector("#billing-adjust-points")?.value, 10) || 0
            });
            window.showToast?.("Bill updated");
            await renderBillDetail();
        } catch (e) {
            errorEl.textContent = e.message || "Could not update bill";
            btn.disabled = false;
        }
    });
    detail.querySelectorAll(".billing-pay-method").forEach((btn) => {
        btn.addEventListener("click", () => {
            selectedMethod = btn.dataset.method;
            // Toggles the active method + settle button label in place
            // instead of a full renderBillDetail() - a full re-render would
            // read the table/phone fields back from the (still-unsaved)
            // order object and silently discard whatever staff just typed.
            detail.querySelectorAll(".billing-pay-method").forEach((b) => b.classList.toggle("active", b === btn));
            const settleBtn = detail.querySelector("#billing-settle-btn");
            if (settleBtn) settleBtn.textContent = `[ Settle ${money(bill.settledTotal > 0 ? bill.dueTotal || 0 : bill.total)} by ${selectedMethod} ]`;
        });
    });
    detail.querySelector("#billing-new-order-for-bill")?.addEventListener("click", () => {
        // Mirror of selectBillForOrder() (this file) - that one pre-selects a
        // bill in Billing after checkout creates an order; this stores the
        // reverse intent so checkout-modal.js can pre-fill its own "attach
        // to existing bill" picker with THIS bill once it opens.
        KitchenSystem.pendingAttachTarget = { id: order.id, orderNumber: order.orderNumber };
        window.showPage?.("menu");
    });
    detail.querySelector("#billing-settle-btn")?.addEventListener("click", async () => {
        const btn = detail.querySelector("#billing-settle-btn");
        btn.disabled = true;
        try {
            // Whatever's currently in the table/phone fields is saved as part
            // of settling - no separate save step for a standalone order.
            // Only rendered (and thus only relevant) for a plain single
            // order, never a table or a multi-order group - see tagInfoHtml.
            if (order && !group) {
                await KitchenSystem.tagOrderInfo(order.id, {
                    // Omitted (not re-sent) when masked, rather than sent as-is -
                    // server.js's tagInfo leaves customerPhone untouched when
                    // contact is omitted; sending the masked placeholder back
                    // would fail the phone-shape check and get misfiled as a
                    // NAME instead, overwriting the real one. See phoneIsMasked.
                    contact: phoneIsMasked ? undefined : detail.querySelector("#billing-tag-phone").value.trim(),
                    tableNumber: detail.querySelector("#billing-tag-table").value.trim()
                });
            }
            const settledAmount = bill.settledTotal > 0 ? bill.dueTotal || 0 : bill.total;
            if (selectedBill.kind === "table") {
                await TableSessionsSystem.close(selectedBill.id, true, selectedMethod);
            } else if (group) {
                await KitchenSystem.settleGroup(order.id, selectedMethod);
            } else {
                await KitchenSystem.markPaid(selectedBill.id, selectedMethod);
            }
            window.showToast?.(`Settled ${money(settledAmount)} by ${selectedMethod}`);
            selectedBill = null;
            await renderBillingPage();
        } catch (e) {
            window.showToast?.(e.message || "Could not settle", "error");
            btn.disabled = false;
        }
    });
}
