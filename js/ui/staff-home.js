/**
 * SEVEN BITS COFFEE - STAFF HOME DASHBOARD
 * Location: /js/ui/staff-home.js
 *
 * New landing page for employee/manager/admin/owner sessions (see
 * js/ui/staff-shell.js and app.js's showPage('staff-home')). Every number
 * here comes from an endpoint that already exists - no new backend for
 * this page. Two things called out explicitly rather than invented:
 *  - "Orders Today" stands in for a "Covers" stat - this app doesn't track
 *    a per-guest/cover count today, so showing a real number beats making
 *    one up.
 *  - The KOT widget's "PRINTER ONLINE" line is a cosmetic status flourish,
 *    matching the app's existing terminal aesthetic - there's no real
 *    printer integration in this codebase (window.printBill/printKOT just
 *    open the browser's print dialog on a receipt).
 */
import { KitchenSystem } from "../features/kitchen-logic.js";
import { PayrollSystem } from "../features/payroll-logic.js";

const LOW_STOCK_THRESHOLD = 5; // matches admin-portal.js's Menu Items low-stock highlight

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function money(n) {
    return "₹" + Number(n || 0).toLocaleString("en-IN");
}

const orderStatus = (order) => KitchenSystem.statusOf(order);
const STATUS_COLORS = KitchenSystem.STATUS_COLORS;

function skeletonHtml() {
    // Mirrors the final layout's card shapes so there's no layout shift once
    // real data arrives.
    return `
        <div style="padding:30px 30px 46px; max-width:1240px;">
            <div style="height:90px; border-bottom:2px solid var(--color-border);"></div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(212px,1fr)); gap:14px; margin-top:26px;">
                ${Array(4).fill('<div style="height:96px; background:var(--color-surface); border:1px solid var(--color-border);"></div>').join("")}
            </div>
        </div>
    `;
}

export async function renderStaffHome(session) {
    const root = document.getElementById("page-staff-home");
    if (!root) return;

    root.innerHTML = skeletonHtml();

    const [kpi] = await Promise.all([PayrollSystem.fetchKpi("7d"), KitchenSystem.fetchOrders()]);
    const orders = KitchenSystem.orders;
    const openOrders = orders.filter((o) => !o.isPaid);
    const kotQueue = orders.filter((o) => !o.items.every((i) => i.isDone));

    const today = kpi?.today || { orders: 0, revenue: 0 };
    const avgTicket = today.orders > 0 ? Math.round(today.revenue / today.orders) : 0;

    let menuItems = [];
    try {
        const res = await fetch("/api/menu");
        if (res.ok) menuItems = (await res.json()).items || [];
    } catch (e) {
        menuItems = [];
    }
    const lowStock = menuItems
        .filter((m) => m.stockCount != null && m.stockCount <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => a.stockCount - b.stockCount)
        .slice(0, 5);

    const roleLabel = (session?.role || "").toUpperCase();
    const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
        .format(new Date())
        .toUpperCase();

    const liveRows = openOrders
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 6);

    root.innerHTML = `
        <div style="padding:30px 30px 46px; max-width:1240px;">
            <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap; border-bottom:2px solid var(--color-accent); padding-bottom:22px;">
                <div>
                    <div style="font-size:11px; letter-spacing:.2em; color:var(--color-text-muted); text-transform:uppercase;">${dateLabel}</div>
                    <h1 style="font-size:28px; font-weight:bold; letter-spacing:1px; line-height:1.2; margin:14px 0 0; text-transform:uppercase; font-family:'Courier New',monospace;">
                        &gt; BOOT.OK &mdash; ${escapeHtml(roleLabel)}<span class="staff-blink-cursor" style="color:var(--color-accent);" aria-hidden="true">_</span>
                    </h1>
                </div>
                <button type="button" id="staff-home-new-order" class="staff-logout-btn" style="background:var(--color-accent); color:var(--color-accent-contrast); border:2px solid var(--color-accent); padding:14px 24px; font-size:12.5px; min-height:44px;">[ NEW ORDER ]</button>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(212px,1fr)); gap:14px; margin-top:26px;">
                ${[
                    ["Sales today", kpi ? money(today.revenue) : null],
                    ["Orders today", kpi ? String(today.orders) : null],
                    ["Avg ticket", kpi ? money(avgTicket) : null],
                    ["Open bills", String(openOrders.length)]
                ]
                    .map(
                        ([label, value]) => `
                    <div class="staff-stat-card" style="padding:16px 18px;">
                        <div style="font-size:10px; letter-spacing:.16em; color:var(--color-text-muted); text-transform:uppercase;">${escapeHtml(label)}</div>
                        ${
                            value === null
                                ? `<div style="font-size:10.5px; color:var(--color-text-muted); margin-top:16px; text-transform:uppercase; letter-spacing:.06em;">Manager+ only</div>`
                                : `<div class="staff-stat-value" style="font-size:28px; font-weight:bold; letter-spacing:1px; margin-top:12px; color:var(--color-accent);">${value}</div>`
                        }
                    </div>
                `
                    )
                    .join("")}
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr)); gap:14px; margin-top:14px; align-items:start;">
                <div class="staff-widget-card" style="padding:18px 20px 8px; min-width:0;">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; border-left:5px solid var(--color-accent); padding-left:12px;">
                        <h2 style="font-size:13px; font-weight:bold; letter-spacing:.24em; margin:0; text-transform:uppercase; color:var(--color-accent);">Live pass</h2>
                        <button type="button" id="staff-home-all-orders" style="background:none; border:0; padding:0 0 0 12px; cursor:pointer; font-size:11.5px; font-weight:bold; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase; min-height:44px;">All &gt;</button>
                    </div>
                    <div style="margin-top:10px;">
                        ${
                            liveRows.length === 0
                                ? `<p style="padding:20px 2px; color:var(--color-text-muted); font-size:11.5px;">No live tickets right now.</p>`
                                : liveRows
                                      .map((o) => {
                                          const status = orderStatus(o);
                                          const summary = o.items.map((i) => `${i.quantity}x ${i.name}`).join(" · ");
                                          return `
                                <div class="staff-home-order-row" data-order-id="${escapeHtml(o.id)}" style="display:flex; align-items:center; gap:14px; padding:12px 2px; border-top:1px dashed var(--color-border); cursor:pointer; font-size:12.5px; min-height:44px;">
                                    <span style="flex:none; color:var(--color-text-muted); width:58px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(o.id)}</span>
                                    <span style="flex:none; font-weight:bold; width:92px; letter-spacing:.06em; text-transform:uppercase; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(o.tableSessionId ? "TABLE" : o.method || "ORDER")}</span>
                                    <span style="color:var(--color-text-muted); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(summary)}</span>
                                    <span style="flex:none; padding:4px 8px; font-size:10px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; white-space:nowrap; border:1px solid ${STATUS_COLORS[status]}; color:${STATUS_COLORS[status]};">${status}</span>
                                    <span class="staff-stat-number" style="flex:none; font-weight:bold; width:72px; text-align:right; color:var(--color-accent);">${money(o.total)}</span>
                                </div>
                            `;
                                      })
                                      .join("")
                        }
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div style="background:var(--color-surface); border:1px solid var(--color-accent); padding:18px 20px; box-shadow:inset 0 0 24px rgba(217,119,6,.09);">
                        <div style="font-size:10px; letter-spacing:.16em; color:var(--color-text-muted); text-transform:uppercase;">KOT queue</div>
                        <div style="display:flex; align-items:baseline; gap:10px; margin-top:14px;">
                            <span class="staff-stat-number" style="font-size:36px; font-weight:bold; color:var(--color-accent); letter-spacing:1px;">${kotQueue.length}</span>
                            <span style="font-size:12px; color:var(--color-text-muted); letter-spacing:.1em; text-transform:uppercase;">awaiting fire</span>
                        </div>
                        <!-- Was "PRINTER * ONLINE" - implied a real connected
                             printer that doesn't exist (there's no hardware
                             integration in this app; Billing's Print KOT/Bill
                             buttons open a browser print dialog, same as any
                             other webpage). Describes what's actually there
                             instead of a fake hardware status. -->
                        <div style="font-size:11px; color:var(--color-text-muted); margin-top:10px; line-height:1.6;">Print from Billing when a ticket's ready &middot; STATION 1 BARISTA &middot; STATION 2 KITCHEN &middot; STATION 3 DESSERTS</div>
                        <button type="button" id="staff-home-billing" style="margin-top:16px; width:100%; padding:11px; background:transparent; border:2px solid var(--color-accent); color:var(--color-accent); font-size:12px; font-weight:bold; letter-spacing:.12em; text-transform:uppercase; cursor:pointer; min-height:44px;">Open billing</button>
                    </div>
                    <div class="staff-widget-card" style="padding:18px 20px;">
                        <h2 style="font-size:12.5px; font-weight:bold; letter-spacing:.22em; margin:0 0 6px; text-transform:uppercase; color:var(--color-danger);">! Low stock</h2>
                        ${
                            lowStock.length === 0
                                ? `<p style="padding:14px 0 4px; color:var(--color-text-muted); font-size:11.5px;">All stocked.</p>`
                                : lowStock
                                      .map(
                                          (m) => `
                                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; border-top:1px dashed var(--color-border); font-size:12.5px;">
                                    <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(m.name)}</span>
                                    <span class="staff-stat-number" style="flex:none; font-weight:bold; white-space:nowrap; color:${m.stockCount === 0 ? "var(--color-danger)" : "var(--color-accent)"};">${m.stockCount === 0 ? "OUT OF STOCK" : `${m.stockCount} LEFT`}</span>
                                </div>
                            `
                                      )
                                      .join("")
                        }
                    </div>
                </div>
            </div>
        </div>
    `;

    root.querySelector("#staff-home-new-order")?.addEventListener("click", () => window.showPage("menu"));
    root.querySelector("#staff-home-all-orders")?.addEventListener("click", () => window.showPage("kitchen"));
    root.querySelector("#staff-home-billing")?.addEventListener("click", () => window.showPage("billing"));
    root.querySelectorAll(".staff-home-order-row").forEach((row) => {
        row.addEventListener("click", () => window.showPage("kitchen"));
    });
}
