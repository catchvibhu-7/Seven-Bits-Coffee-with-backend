/**
 * SEVEN BITS COFFEE - ADMIN PORTAL UI
 * Location: /js/ui/admin-portal.js
 *
 * Every mutation here (add/edit/delete item, save config, staff actions)
 * calls server.js, which re-checks the admin session cookie and role itself -
 * so even if someone bypasses these buttons and calls fetch() by hand, they
 * still need a valid login with the right role.
 */
import { AdminConfig } from "../features/config-logic.js";
import { AuthSystem } from "../features/auth-logic.js";
import { PayrollSystem } from "../features/payroll-logic.js";
import { KitchenSystem } from "../features/kitchen-logic.js";
import { renderAddStaffModal, renderEditStaffModal } from "./staff-modal.js";
import { renderInfoModal } from "./info-modal.js";
import { renderItemModal } from "./item-modal.js";
import { renderComboModal } from "./combo-modal.js";
import { renderAccountSettingsModal } from "./account-settings-modal.js";
import { renderImagePickerModal } from "./image-picker-modal.js";

// Reorganized from the original 5 groups, which had grown into two
// unrelated grab-bags: "Global Settings" mixed shop-identity copy
// (name/badge/about text) with tax rates, UPI, AND arcade config, while
// "Branding" mixed colors/images with multi-location store management
// that has nothing to do with branding. Each group below now has one clear
// job: content owners look in BRANDING & CONTENT, money/tax people look in
// PAYMENTS, day-to-day operational toggles are in OPERATIONS, and
// business-structure/data tools (locations, backup) are in STORE SETUP.
function tabGroupsForRole(role) {
    const isManagerOnly = role === "manager";
    const groups = [
        { label: "OVERVIEW", tabs: [{ id: "kpi", label: "Dashboard" }] },
        {
            label: "MENU",
            tabs: [
                { id: "menu", label: "Menu Items" },
                { id: "combos", label: "Combos" },
                { id: "customization", label: "Customization Pricing" }
            ]
        },
        {
            label: "SALES",
            tabs: [
                { id: "discounts", label: "Discounts & Loyalty" },
                { id: "orders", label: "Order History" },
                { id: "reports", label: "Reports & Export" }
            ]
        },
        {
            label: "STAFF",
            tabs: [
                { id: "payroll", label: "Payroll" },
                { id: "staff", label: "User Management" }
            ]
        },
        {
            // Everything here is shop-wide/business-critical, so owner/admin
            // only - not part of what a manager gets. Group disappears
            // entirely for a manager.
            label: "BRANDING & CONTENT",
            tabs: isManagerOnly
                ? []
                : [{ id: "branding", label: "Branding" }]
        },
        {
            label: "PAYMENTS",
            tabs: isManagerOnly ? [] : [{ id: "payments", label: "Payments & Tax" }]
        },
        {
            label: "OPERATIONS",
            tabs: isManagerOnly ? [] : [{ id: "operations", label: "Operations" }]
        },
        {
            label: "STORE SETUP",
            tabs: isManagerOnly
                ? []
                : [
                      { id: "stores", label: "Locations" },
                      { id: "data", label: "Data & Backup" }
                  ]
        }
    ];
    return groups.filter((g) => g.tabs.length > 0);
}

const THEME_PRESETS = {
    dark: { accent: "#d97706", background: "#0a0a0a", surface: "#111111", text: "#f9fafb", textMuted: "#888888", secondary: "#22d3ee" },
    light: { accent: "#d97706", background: "#f5f5f0", surface: "#ffffff", text: "#1a1a1a", textMuted: "#666666", secondary: "#0891b2" }
};

function ok(message) {
    if (window.showToast) window.showToast(message);
}
function fail(message) {
    if (window.showToast) window.showToast(message, "error");
}
function escapeHtmlAttr(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const AdminPortal = {
    menu: { sections: [], items: [] },
    combos: [],
    customizationOptions: { sizeOptions: [], milkOptions: [], extraOptions: [] },
    session: { role: null },
    activeTab: "kpi",

    async init() {
        await this.loadMenu();
        await this.loadCombos();
        await this.loadCustomizationOptions();
        await AdminConfig.loadSettings();
        this.session = await AuthSystem.getSession();
        // A manager landing on a tab they no longer have access to (e.g.
        // Global Settings, remembered from a previous admin session in the
        // same browser) falls back to the dashboard instead of a blank tab.
        if (!tabGroupsForRole(this.session.role).some((g) => g.tabs.some((t) => t.id === this.activeTab))) {
            this.activeTab = "kpi";
        }
        this.renderTabs();
        await this.renderActiveTab();
    },

    async loadMenu() {
        const res = await fetch("/api/menu?includeDeleted=true");
        this.menu = await res.json();
    },

    async loadCombos() {
        const res = await fetch("/api/combos");
        this.combos = res.ok ? await res.json() : [];
    },

    async loadCustomizationOptions() {
        const res = await fetch("/api/customization-options");
        this.customizationOptions = res.ok ? await res.json() : { sizeOptions: [], milkOptions: [], extraOptions: [] };
    },

    renderTabs() {
        const root = document.getElementById("admin-tabs");
        if (!root) return;
        const groups = tabGroupsForRole(this.session.role);
        root.innerHTML = groups.map((g) => `
            <div class="admin-tab-group">
                <div class="admin-tab-group-label">${g.label}</div>
                <div class="admin-tab-group-btns">
                    ${g.tabs.map(
                        (t) => `<button class="admin-tab-btn ${t.id === this.activeTab ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
                    ).join("")}
                </div>
            </div>
        `).join("");
        root.querySelectorAll(".admin-tab-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                this.activeTab = btn.dataset.tab;
                this.renderTabs();
                await this.renderActiveTab();
            });
        });
    },

    async renderActiveTab() {
        const root = document.getElementById("admin-tab-content");
        if (!root) return;
        if (this.activeTab === "kpi") return this.renderKpiDashboard(root);
        if (this.activeTab === "payments") return this.renderPayments(root);
        if (this.activeTab === "operations") return this.renderOperations(root);
        if (this.activeTab === "stores") return this.renderStores(root);
        if (this.activeTab === "data") return this.renderDataBackup(root);
        if (this.activeTab === "reports") return this.renderReportsExport(root);
        if (this.activeTab === "menu") {
            await this.loadMenu(); // pending staff disable-requests can arrive between tab switches
            return this.renderMenuItems(root);
        }
        if (this.activeTab === "combos") return this.renderCombos(root);
        if (this.activeTab === "customization") return this.renderCustomizationPricing(root);
        if (this.activeTab === "discounts") return this.renderDiscountsLoyalty(root);
        if (this.activeTab === "orders") return this.renderOrderHistory(root);
        if (this.activeTab === "payroll") return this.renderPayroll(root);
        if (this.activeTab === "staff") return this.renderStaffManagement(root);
        if (this.activeTab === "branding") return this.renderBranding(root);
    },

    // ---------------------------------------------------------------- GLOBAL
    // ---------------------------------------------------------------- PAYMENTS & TAX
    async renderPayments(root) {
        const c = AdminConfig.settings;

        root.innerHTML = `
            <div class="config-controls">
                <h3 style="margin-top:0;">TAX &amp; GST (INDIAN SUBCONTINENT)</h3>
                <div class="control-group">
                    <label>GST NUMBER (GSTIN) - printed on bills when set. Leave blank if not GST-registered.</label>
                    <input type="text" id="cfg-gst-number" maxlength="20" value="${escapeHtmlAttr(c.gstNumber || "")}" placeholder="22AAAAA0000A1Z5" />
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div class="control-group">
                        <label>CGST RATE (%)</label>
                        <input type="text" id="cfg-cgst" value="${(c.cgstRate * 100).toFixed(2)}" />
                    </div>
                    <div class="control-group">
                        <label>SGST RATE (%)</label>
                        <input type="text" id="cfg-sgst" value="${(c.sgstRate * 100).toFixed(2)}" />
                    </div>
                </div>
                <div class="control-group">
                    <label>SERVICE CHARGE RATE (%)</label>
                    <input type="text" id="cfg-service-charge" value="${(c.serviceChargeRate * 100).toFixed(2)}" />
                </div>
                <div class="control-group" style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="cfg-tip-enabled" ${c.tipEnabled ? "checked" : ""} style="width:auto;" />
                    <label style="margin:0;" for="cfg-tip-enabled">ENABLE GINGER TIP</label>
                </div>
                <div class="control-group">
                    <label>TIP AMOUNT (\u20b9)</label>
                    <input type="text" id="cfg-tip-amount" value="${c.tipAmount ?? 0}" />
                </div>
                <p class="admin-help-text">Tax, service charge, and tip are calculated and shown at checkout, on the Billing page, and on the printed bill - not while someone's still browsing/adding to their cart.</p>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">UPI PAYMENT</h3>
                <div class="control-group">
                    <label>UPI ID (VPA) - shown as a QR code for "Pay Online" orders. Leave blank to disable online payment and show "pay at counter" instead.</label>
                    <input type="text" id="cfg-upi-vpa" value="${c.upiVpa || ""}" placeholder="yourshop@upi" />
                </div>
                <div class="control-group">
                    <label>PAYEE NAME (shown to the customer in their UPI app)</label>
                    <input type="text" id="cfg-upi-payee-name" value="${c.upiPayeeName || ""}" placeholder="${c.shopName || "Your Shop"}" />
                </div>

                <p id="payments-error" style="color:var(--color-danger); font-size:8pt; min-height:12px;"></p>
                <button class="admin-btn-primary" id="cfg-save">SAVE SETTINGS</button>
            </div>
        `;

        document.getElementById("cfg-save").addEventListener("click", async () => {
            const errorEl = document.getElementById("payments-error");
            errorEl.textContent = "";
            const cgst = parseFloat(document.getElementById("cfg-cgst").value) / 100;
            const sgst = parseFloat(document.getElementById("cfg-sgst").value) / 100;
            const serviceCharge = parseFloat(document.getElementById("cfg-service-charge").value) / 100;
            const tipAmount = parseFloat(document.getElementById("cfg-tip-amount").value);

            if ([cgst, sgst, serviceCharge, tipAmount].some((n) => !Number.isFinite(n) || n < 0)) {
                errorEl.textContent = "Rates and amounts must be positive numbers.";
                return;
            }

            try {
                await AdminConfig.saveSettings({
                    gstNumber: document.getElementById("cfg-gst-number").value,
                    tipEnabled: document.getElementById("cfg-tip-enabled").checked,
                    tipAmount,
                    cgstRate: cgst,
                    sgstRate: sgst,
                    serviceChargeRate: serviceCharge,
                    upiVpa: document.getElementById("cfg-upi-vpa").value.trim(),
                    upiPayeeName: document.getElementById("cfg-upi-payee-name").value.trim()
                });
                if (window.applyBranding) window.applyBranding(AdminConfig.settings);
                ok("Settings saved");
            } catch (e) {
                errorEl.textContent = e.message;
                fail(e.message);
            }
        });
    },

    // ---------------------------------------------------------------- OPERATIONS
    async renderOperations(root) {
        const c = AdminConfig.settings;

        root.innerHTML = `
            <div class="config-controls">
                <h3 style="margin-top:0;">TABLES</h3>
                <div class="control-group">
                    <label>NUMBER OF TABLES (0 = only Online/Counter, no physical tabs)</label>
                    <input type="text" id="cfg-table-count" value="${c.tableCount ?? 10}" />
                    <p class="admin-help-text" style="margin-top:4px;">Staff can open a tab for tables numbered 1 through this count. Table "0" always means Online/Counter (no tab).</p>
                </div>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">ARCADE (GAMES TAB)</h3>
                <p class="admin-help-text" style="margin-bottom:10px;">In-store only: a customer/guest unlocks the arcade for the session length below, starting from their most recent order.</p>
                <div class="control-group" style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="cfg-arcade-enabled" ${(c.arcade?.enabled ?? true) ? "checked" : ""} style="width:auto;" />
                    <label style="margin:0;" for="cfg-arcade-enabled">ENABLE ARCADE</label>
                </div>
                <div class="control-group">
                    <label>SESSION LENGTH (hours)</label>
                    <input type="text" id="cfg-arcade-hours" value="${c.arcade?.sessionHours ?? 2}" />
                </div>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">NOTIFICATIONS</h3>
                <p class="admin-help-text">Order-ready and low-stock alerts currently only show in-app (staff dashboard, order status widget). SMS/WhatsApp delivery is planned but not built yet - see README-BACKEND.md for the tracked feature request once you're ready to wire up a provider (e.g. Twilio, MSG91, or Meta's WhatsApp Business API).</p>

                <p id="operations-error" style="color:var(--color-danger); font-size:8pt; min-height:12px;"></p>
                <button class="admin-btn-primary" id="cfg-save">SAVE SETTINGS</button>
            </div>
        `;

        document.getElementById("cfg-save").addEventListener("click", async () => {
            const errorEl = document.getElementById("operations-error");
            errorEl.textContent = "";
            const tableCount = parseInt(document.getElementById("cfg-table-count").value, 10);
            const arcadeHours = parseFloat(document.getElementById("cfg-arcade-hours").value);

            if (!Number.isFinite(tableCount) || tableCount < 0) {
                errorEl.textContent = "Number of tables must be zero or a positive whole number.";
                return;
            }
            if (!Number.isFinite(arcadeHours) || arcadeHours <= 0) {
                errorEl.textContent = "Arcade session length must be a positive number of hours.";
                return;
            }

            try {
                await AdminConfig.saveSettings({
                    tableCount,
                    arcade: { enabled: document.getElementById("cfg-arcade-enabled").checked, sessionHours: arcadeHours }
                });
                if (window.applyBranding) window.applyBranding(AdminConfig.settings);
                ok("Settings saved");
            } catch (e) {
                errorEl.textContent = e.message;
                fail(e.message);
            }
        });
    },

    // ---------------------------------------------------------------- LOCATIONS (STORES)
    // Pulled out of the Branding tab, where it had nothing to do with
    // colors/copy - multi-location structure belongs with the other
    // business-structure tools in Store Setup.
    async renderStores(root) {
        const isOwner = this.session.role === "owner";
        root.innerHTML = `
            <div class="config-controls">
                <h3 style="margin-top:0;">STORES</h3>
                <p class="admin-help-text">Right now everything runs as one store - add another here when you're ready to expand, then assign managers/employees to it from User Management.</p>
                <div id="stores-list" style="margin-bottom:10px;"></div>
                ${
                    isOwner
                        ? `
                <div style="display:flex; gap:8px;">
                    <input type="text" id="new-store-name" placeholder="Store name" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;" />
                    <input type="text" id="new-store-address" placeholder="Address (optional)" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;" />
                    <button class="admin-btn" id="add-store">ADD STORE</button>
                </div>`
                        : `<p class="admin-help-text">Only the owner can add stores.</p>`
                }
            </div>
        `;

        const renderStoresList = async () => {
            const stores = await PayrollSystem.fetchStores();
            document.getElementById("stores-list").innerHTML = stores
                .map((s) => `<div style="padding:6px 0; border-bottom:1px solid var(--color-border); font-size:8pt;">${s.name}${s.address ? ` — ${s.address}` : ""}</div>`)
                .join("");
        };
        await renderStoresList();

        if (isOwner) {
            document.getElementById("add-store").addEventListener("click", async () => {
                const name = document.getElementById("new-store-name").value.trim();
                const address = document.getElementById("new-store-address").value.trim();
                if (!name) return fail("Enter a store name");
                try {
                    await PayrollSystem.addStore({ name, address });
                    document.getElementById("new-store-name").value = "";
                    document.getElementById("new-store-address").value = "";
                    await renderStoresList();
                    ok("Store added");
                } catch (e) {
                    fail(e.message);
                }
            });
        }
    },

    // ---------------------------------------------------------------- DATA & BACKUP
    async renderDataBackup(root) {
        const isOwner = this.session.role === "owner";
        root.innerHTML = `
            <div class="config-controls">
                <h3 style="margin-top:0;">BACKUP</h3>
                <p class="admin-help-text">Downloads every record this app stores (menu, orders, staff accounts, config, etc.) as one JSON file. Uploaded images themselves aren't included, only their filenames/metadata - keep the "uploads" folder alongside any backup you keep long-term.</p>
                ${isOwner ? `<button class="admin-btn-primary" id="backup-download">DOWNLOAD BACKUP</button>` : `<p class="admin-help-text">Only the owner can download or restore a backup.</p>`}

                ${
                    isOwner
                        ? `
                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">RESTORE</h3>
                <p class="admin-help-text" style="color:var(--color-danger);">Overwrites current data with whatever's in the backup file - menu, orders, staff accounts, everything it contains. This can't be undone. Only restore a backup you trust.</p>
                <input type="file" id="restore-file-input" accept="application/json" style="margin-bottom:10px;" />
                <br />
                <button class="admin-btn-secondary" id="restore-upload" style="border-color:var(--color-danger); color:var(--color-danger);" disabled>RESTORE FROM BACKUP</button>
                `
                        : ""
                }
                <p id="backup-error" style="color:var(--color-danger); font-size:8pt; min-height:12px; margin-top:10px;"></p>
            </div>
        `;

        if (!isOwner) return;

        document.getElementById("backup-download").addEventListener("click", () => {
            // A plain navigation (not fetch+blob) so the browser's own
            // download handling (Content-Disposition) takes over - simplest
            // way to trigger a real file save from a GET endpoint.
            window.open("/api/admin/backup", "_blank");
        });

        let restoreFile = null;
        const restoreBtn = document.getElementById("restore-upload");
        document.getElementById("restore-file-input").addEventListener("change", (e) => {
            restoreFile = e.target.files[0] || null;
            restoreBtn.disabled = !restoreFile;
        });

        restoreBtn.addEventListener("click", () => {
            if (!restoreFile) return;
            renderInfoModal({
                title: "RESTORE FROM BACKUP",
                message: `This will overwrite current menu, orders, staff accounts, and settings with the contents of "${restoreFile.name}". This can't be undone. Continue?`,
                confirmText: "RESTORE",
                cancelText: "CANCEL",
                onConfirm: async () => {
                    const errorEl = document.getElementById("backup-error");
                    errorEl.textContent = "";
                    try {
                        const text = await restoreFile.text();
                        const parsed = JSON.parse(text);
                        const res = await fetch("/api/admin/restore", {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ...parsed, confirmYes: true })
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || "Restore failed");
                        ok(`Restored ${data.restoredCount} file(s) - reloading...`);
                        setTimeout(() => window.location.reload(), 1200);
                    } catch (e) {
                        errorEl.textContent = e.message || "Could not restore backup";
                    }
                }
            });
        });
    },

    // ---------------------------------------------------------------- REPORTS & EXPORT
    async renderReportsExport(root) {
        root.innerHTML = `
            <div class="config-controls">
                <h3 style="margin-top:0;">EXPORT ORDERS (CSV)</h3>
                <p class="admin-help-text">Downloads a spreadsheet-ready CSV of orders for bookkeeping/tax filing - one row per order with items, tax, and totals.</p>
                <div style="display:flex; gap:15px; flex-wrap:wrap; margin-bottom:14px;">
                    <div class="control-group" style="flex:1; min-width:160px;">
                        <label>FROM (optional)</label>
                        <input type="date" id="report-from" />
                    </div>
                    <div class="control-group" style="flex:1; min-width:160px;">
                        <label>TO (optional)</label>
                        <input type="date" id="report-to" />
                    </div>
                </div>
                <button class="admin-btn-primary" id="report-export-csv">EXPORT CSV</button>
                <p id="report-error" style="color:var(--color-danger); font-size:8pt; min-height:12px; margin-top:10px;"></p>
            </div>
        `;

        document.getElementById("report-export-csv").addEventListener("click", async () => {
            const errorEl = document.getElementById("report-error");
            errorEl.textContent = "";
            try {
                const res = await fetch("/api/orders", { credentials: "include" });
                if (!res.ok) throw new Error("Could not load orders");
                let orders = await res.json();

                const fromVal = document.getElementById("report-from").value;
                const toVal = document.getElementById("report-to").value;
                if (fromVal) orders = orders.filter((o) => new Date(o.createdAt) >= new Date(fromVal));
                if (toVal) orders = orders.filter((o) => new Date(o.createdAt) <= new Date(toVal + "T23:59:59"));

                if (orders.length === 0) {
                    errorEl.textContent = "No orders in that range.";
                    return;
                }

                const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
                const header = ["Order #", "Date", "Method", "Customer Phone", "Items", "Subtotal", "CGST", "SGST", "Service Charge", "Tip", "Discount", "Total", "Paid"];
                const rows = orders.map((o) => [
                    o.orderNumber || o.id,
                    new Date(o.createdAt).toLocaleString(),
                    o.method || "",
                    o.customerPhone || "",
                    o.items.map((i) => `${i.quantity}x ${i.name}`).join("; "),
                    (o.subtotal || 0).toFixed(2),
                    (o.cgst || 0).toFixed(2),
                    (o.sgst || 0).toFixed(2),
                    (o.serviceCharge || 0).toFixed(2),
                    (o.tipAmount || 0).toFixed(2),
                    (o.discountAmount || 0).toFixed(2),
                    (o.total || 0).toFixed(2),
                    o.isPaid ? "Yes" : "No"
                ]);
                const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                ok(`Exported ${orders.length} order(s)`);
            } catch (e) {
                errorEl.textContent = e.message || "Export failed";
            }
        });
    },

    // ---------------------------------------------------------------- KPI DASHBOARD
    kpiRange: "7d",

    async renderKpiDashboard(root) {
        const [kpi, roster] = await Promise.all([PayrollSystem.fetchKpi(this.kpiRange), PayrollSystem.fetchTimeclockRoster()]);
        if (!kpi) {
            root.innerHTML = `<p style="color:var(--color-danger); font-size:9pt;">Could not load dashboard data.</p>`;
            return;
        }
        await KitchenSystem.fetchOrders();
        const pendingByStation = { BARISTA: 0, KITCHEN: 0, DESSERTS: 0 };
        KitchenSystem.orders.forEach((o) =>
            o.items.forEach((i) => {
                if (!i.isDone) pendingByStation[i.station || KitchenSystem.getStation(i)]++;
            })
        );

        const maxDaily = Math.max(1, ...kpi.chart.map((d) => d.revenue));
        const maxSeller = Math.max(1, ...kpi.bestSellers.map((s) => s.quantity));
        const rangeLabels = { "7d": "LAST 7 DAYS", "1m": "LAST 30 DAYS", "1y": "LAST 12 MONTHS" };
        const filters = [
            { id: "7d", label: "7 DAYS" },
            { id: "1m", label: "1 MONTH" },
            { id: "1y", label: "1 YEAR" }
        ];

        root.innerHTML = `
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
                <div class="stat-card"><div class="stat-label">TODAY</div><div class="stat-value">\u20b9${kpi.today.revenue.toFixed(0)}</div><div style="font-size:7pt; color:var(--color-text-muted);">${kpi.today.orders} orders</div></div>
                <div class="stat-card"><div class="stat-label">THIS WEEK</div><div class="stat-value">\u20b9${kpi.week.revenue.toFixed(0)}</div><div style="font-size:7pt; color:var(--color-text-muted);">${kpi.week.orders} orders</div></div>
                <div class="stat-card"><div class="stat-label">THIS MONTH</div><div class="stat-value">\u20b9${kpi.month.revenue.toFixed(0)}</div><div style="font-size:7pt; color:var(--color-text-muted);">${kpi.month.orders} orders</div></div>
                <div class="stat-card"><div class="stat-label">ALL TIME</div><div class="stat-value">\u20b9${kpi.allTime.revenue.toFixed(0)}</div><div style="font-size:7pt; color:var(--color-text-muted);">${kpi.allTime.orders} orders</div></div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
                ${filters
                    .map(
                        (f) => `<button class="admin-btn kpi-range-btn ${f.id === this.kpiRange ? "active" : ""}" data-range="${f.id}">${f.label}</button>`
                    )
                    .join("")}
            </div>

            <div style="display:grid; grid-template-columns: 2fr 1fr; gap:20px; margin-top:10px;">
                <div>
                    <h3 style="font-size:9pt; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">REVENUE - ${rangeLabels[this.kpiRange]}</h3>
                    <div style="display:flex; align-items:flex-end; gap:${kpi.chart.length > 20 ? "2px" : "8px"}; height:140px; border-bottom:1px solid var(--color-border); padding-bottom:4px;">
                        ${kpi.chart
                            .map(
                                (d) => `
                            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;" title="${d.label}: \u20b9${d.revenue.toFixed(2)} (${d.count} orders)">
                                ${kpi.chart.length <= 14 ? `<div style="font-size:7pt; color:var(--color-text-muted); margin-bottom:4px;">\u20b9${d.revenue.toFixed(0)}</div>` : ""}
                                <div style="width:100%; background:var(--color-accent); height:${Math.max(2, (d.revenue / maxDaily) * 100)}%; min-height:2px;"></div>
                            </div>
                        `
                            )
                            .join("")}
                    </div>
                    <div style="display:flex; gap:${kpi.chart.length > 20 ? "2px" : "8px"}; margin-top:4px;">
                        ${kpi.chart
                            .map(
                                (d, i) =>
                                    `<div style="flex:1; text-align:center; font-size:6.5pt; color:var(--color-text-muted); ${kpi.chart.length > 14 && i % Math.ceil(kpi.chart.length / 10) !== 0 ? "visibility:hidden;" : ""}">${this.kpiRange === "1y" ? d.label.slice(2) : d.label.slice(5)}</div>`
                            )
                            .join("")}
                    </div>
                </div>
                <div>
                    <h3 style="font-size:9pt; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">TOP SELLERS (${rangeLabels[this.kpiRange]})</h3>
                    ${
                        kpi.bestSellers.length === 0
                            ? `<p class="admin-help-text">No orders yet.</p>`
                            : kpi.bestSellers
                                  .map(
                                      (s) => `
                            <div style="margin-bottom:10px;">
                                <div style="display:flex; justify-content:space-between; font-size:8pt; margin-bottom:3px;">
                                    <span>${s.name}</span><span style="color:var(--color-text-muted);">${s.quantity}</span>
                                </div>
                                <div style="height:5px; background:var(--color-border);"><div style="height:100%; width:${(s.quantity / maxSeller) * 100}%; background:var(--color-cyan);"></div></div>
                            </div>
                        `
                                  )
                                  .join("")
                    }
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:20px; margin-top:20px;">
                <div>
                    <h3 style="font-size:9pt; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">CREW</h3>
                    ${
                        roster.length === 0
                            ? `<p class="admin-help-text">No staff to show.</p>`
                            : roster
                                  .map((p) => {
                                      const initials = (p.name || "?")
                                          .split(" ")
                                          .map((w) => w[0])
                                          .filter(Boolean)
                                          .slice(0, 2)
                                          .join("")
                                          .toUpperCase();
                                      return `
                                <div style="display:flex; align-items:center; gap:12px; padding:9px 0; border-top:1px dashed var(--color-border);">
                                    <span style="width:30px; height:30px; flex:none; border:1px solid var(--color-accent); color:var(--color-accent); display:flex; align-items:center; justify-content:center; font-size:10pt; font-weight:bold;">${initials}</span>
                                    <div style="flex:1; min-width:0;">
                                        <div style="font-size:9pt; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.name}</div>
                                        <div style="font-size:7pt; color:var(--color-text-muted); margin-top:2px; letter-spacing:.06em; text-transform:uppercase;">${p.role}${p.tag ? " &middot; " + p.tag : ""}</div>
                                    </div>
                                    <span style="flex:none; font-size:7pt; font-weight:bold; letter-spacing:.06em; text-transform:uppercase; color:${p.clockedIn ? "var(--color-success)" : "var(--color-text-muted)"};">${p.clockedIn ? "● ON SHIFT" : "OFF SHIFT"}</span>
                                </div>
                            `;
                                  })
                                  .join("")
                    }
                </div>
                <div>
                    <h3 style="font-size:9pt; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">STATIONS</h3>
                    ${Object.entries(pendingByStation)
                        .map(
                            ([name, pending]) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:9px 0; border-top:1px dashed var(--color-border);">
                            <div style="min-width:0;">
                                <div style="font-size:9pt; font-weight:bold; letter-spacing:.06em; text-transform:uppercase;">${name}</div>
                                <div style="font-size:7pt; color:var(--color-text-muted); margin-top:2px; letter-spacing:.08em; text-transform:uppercase;">Pending items</div>
                            </div>
                            <span style="font-size:16pt; font-weight:bold; color:${pending > 0 ? "var(--color-accent)" : "var(--color-success)"};">${pending}</span>
                        </div>
                    `
                        )
                        .join("")}
                </div>
            </div>
        `;

        root.querySelectorAll(".kpi-range-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                this.kpiRange = btn.dataset.range;
                await this.renderKpiDashboard(root);
            });
        });
    },

    // ---------------------------------------------------------------- PAYROLL
    async renderPayroll(root) {
        const staff = await PayrollSystem.fetchPayroll();
        const history = await PayrollSystem.fetchPayrollHistory();
        const allStaff = (await fetch("/api/users", { credentials: "include" }).then((r) => r.json())).filter((u) =>
            ["employee", "manager"].includes(u.role)
        );
        const attendance = await PayrollSystem.fetchAttendance();

        root.innerHTML = `
            <h3 style="font-size:9pt; letter-spacing:1px; color:var(--color-accent); margin-bottom:5px;">CURRENT PAY PERIOD</h3>
            <p class="admin-help-text" style="margin-bottom:10px;">
                Periods run on a fixed calendar cycle - hourly and weekly-rate staff are paid Monday-Sunday, monthly-rate staff on the calendar month.
                Hours are capped at ${8} per day unless overtime is approved.
            </p>
            ${
                staff.length === 0
                    ? `<p class="admin-help-text">No staff have a pay rate set yet - add one from User Management.</p>`
                    : `
            <table class="admin-table">
                <thead><tr><th>NAME</th><th>TAG</th><th>RATE</th><th>HOURS</th><th>PERIOD EARNED</th><th>STATUS</th><th style="text-align:right;">ACTION</th></tr></thead>
                <tbody>
                    ${staff
                        .map(
                            (s) => `
                        <tr>
                            <td>${s.name}</td>
                            <td style="font-size:8pt; color:var(--color-text-muted);">${s.tag || "\u2014"}</td>
                            <td style="font-size:8pt;">\u20b9${s.payRate}/${s.payRateType === "hourly" ? "hr" : s.payRateType === "weekly" ? "wk" : "mo"}</td>
                            <td>
                                ${s.hoursWorked !== null ? s.hoursWorked : "\u2014"}
                                ${
                                    s.hasUnapprovedOvertime
                                        ? `<div style="color:var(--color-danger); font-size:7pt; margin-top:2px;">\u26a0 ${s.rawHours}h worked, capped at ${s.hoursWorked}h</div>`
                                        : ""
                                }
                            </td>
                            <td>\u20b9${s.amount.toFixed(2)}</td>
                            <td>${s.isPaid ? `<span style="color:var(--color-success);">\u2713 PAID</span>` : `<span style="color:var(--color-cyan);">PENDING</span>`}</td>
                            <td style="text-align:right;">
                                ${s.hasUnapprovedOvertime ? `<button class="admin-btn" data-approve-ot="${s.userId}" data-name="${s.name}">APPROVE OT</button>` : ""}
                                ${s.isPaid ? "" : `<button class="admin-btn" data-mark-paid="${s.userId}" data-name="${s.name}" data-amount="${s.amount.toFixed(2)}">MARK PAID</button>`}
                            </td>
                        </tr>
                    `
                        )
                        .join("")}
                </tbody>
            </table>`
            }

            <h3 style="margin-top:30px; border-top:1px solid var(--color-border); padding-top:20px;">MARK ATTENDANCE</h3>
            <p class="admin-help-text" style="margin-bottom:10px;">
                For staff who don't log into the system themselves (e.g. table service) - record their hours directly.
                Entries over 8 hours for one day are still capped until you separately approve overtime for that day.
            </p>
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:15px;">
                <div>
                    <label class="admin-field-label" style="display:block; margin-bottom:3px;">STAFF</label>
                    <select id="att-user" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;">
                        ${allStaff.map((u) => `<option value="${u.id}">${u.name}${u.tag ? ` (${u.tag})` : ""}</option>`).join("")}
                    </select>
                </div>
                <div>
                    <label class="admin-field-label" style="display:block; margin-bottom:3px;">DATE</label>
                    <input type="date" id="att-date" value="${new Date().toISOString().slice(0, 10)}" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;" />
                </div>
                <div>
                    <label class="admin-field-label" style="display:block; margin-bottom:3px;">HOURS</label>
                    <input type="number" id="att-hours" min="0.5" max="24" step="0.5" value="8" style="width:80px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;" />
                </div>
                <button class="admin-btn-primary" id="att-submit">MARK</button>
            </div>
            <p id="attendance-error" style="color:var(--color-danger); font-size:8pt; min-height:12px;"></p>

            ${
                attendance.length === 0
                    ? ""
                    : `
            <table class="admin-table">
                <thead><tr><th>NAME</th><th>DATE</th><th>HOURS</th><th>MARKED BY</th><th style="text-align:right;">ACTION</th></tr></thead>
                <tbody>
                    ${attendance
                        .slice(0, 20)
                        .map(
                            (a) => `
                        <tr>
                            <td>${a.name}</td>
                            <td style="font-size:8pt;">${a.date}</td>
                            <td>${a.hours}${a.hours > 8 ? ` <span style="color:var(--color-danger); font-size:7pt;">(OT)</span>` : ""}</td>
                            <td style="font-size:8pt; color:var(--color-text-muted);">${a.markedBy}</td>
                            <td style="text-align:right;"><button class="admin-btn admin-btn-danger" data-delete-attendance="${a.id}">REMOVE</button></td>
                        </tr>
                    `
                        )
                        .join("")}
                </tbody>
            </table>`
            }

            <h3 style="margin-top:30px; border-top:1px solid var(--color-border); padding-top:20px;">PAYOUT HISTORY</h3>
            ${
                history.length === 0
                    ? `<p class="admin-help-text">No payouts recorded yet.</p>`
                    : `
            <table class="admin-table">
                <thead><tr><th>NAME</th><th>PERIOD</th><th>HOURS</th><th>AMOUNT</th><th>PAID</th></tr></thead>
                <tbody>
                    ${history
                        .slice(0, 30)
                        .map(
                            (h) => `
                        <tr>
                            <td>${h.name}</td>
                            <td style="font-size:8pt;">${h.periodStart.slice(0, 10)} \u2192 ${h.periodEnd.slice(0, 10)}</td>
                            <td>${h.hoursWorked !== null ? h.hoursWorked : "\u2014"}</td>
                            <td>\u20b9${h.amountPaid.toFixed(2)}</td>
                            <td style="font-size:8pt; color:var(--color-text-muted);">${new Date(h.paidAt).toLocaleString()} by ${h.paidBy}</td>
                        </tr>
                    `
                        )
                        .join("")}
                </tbody>
            </table>`
            }
        `;

        root.querySelectorAll("[data-mark-paid]").forEach((btn) =>
            btn.addEventListener("click", () => {
                renderInfoModal({
                    title: "MARK AS PAID",
                    message: `Confirm ${btn.dataset.name} has been paid \u20b9${btn.dataset.amount} for this period? This can't be undone.`,
                    confirmText: "CONFIRM PAID",
                    cancelText: "CANCEL",
                    onConfirm: async () => {
                        try {
                            await PayrollSystem.markPaid(Number(btn.dataset.markPaid));
                            ok(`Marked ${btn.dataset.name} as paid`);
                            await this.renderActiveTab();
                        } catch (e) {
                            fail(e.message);
                        }
                    }
                });
            })
        );

        root.querySelectorAll("[data-approve-ot]").forEach((btn) =>
            btn.addEventListener("click", () => {
                const staffMember = staff.find((s) => s.userId === Number(btn.dataset.approveOt));
                renderInfoModal({
                    title: "APPROVE OVERTIME",
                    message: `${btn.dataset.name} worked ${staffMember?.rawHours}h against the ${8}h daily cap this period. Approve the extra hours to count toward pay?`,
                    confirmText: "APPROVE",
                    cancelText: "CANCEL",
                    onConfirm: async () => {
                        // Overtime is approved per calendar day, but the payroll view only
                        // has the period total - find the specific day(s) over the cap by
                        // re-checking attendance for a matching entry, or fall back to
                        // approving today (the common case: someone clocked long today).
                        const today = new Date().toISOString().slice(0, 10);
                        try {
                            await PayrollSystem.approveOvertime(Number(btn.dataset.approveOt), today);
                            ok("Overtime approved");
                            await this.renderActiveTab();
                        } catch (e) {
                            fail(e.message);
                        }
                    }
                });
            })
        );

        document.getElementById("att-submit").addEventListener("click", async () => {
            const errorEl = document.getElementById("attendance-error");
            errorEl.textContent = "";
            try {
                await PayrollSystem.markAttendance({
                    userId: Number(document.getElementById("att-user").value),
                    date: document.getElementById("att-date").value,
                    hours: Number(document.getElementById("att-hours").value)
                });
                ok("Attendance marked");
                await this.renderActiveTab();
            } catch (e) {
                errorEl.textContent = e.message;
            }
        });

        root.querySelectorAll("[data-delete-attendance]").forEach((btn) =>
            btn.addEventListener("click", () => {
                renderInfoModal({
                    title: "REMOVE ATTENDANCE ENTRY",
                    message: "Remove this attendance record?",
                    confirmText: "REMOVE",
                    cancelText: "CANCEL",
                    onConfirm: async () => {
                        try {
                            await PayrollSystem.deleteAttendance(Number(btn.dataset.deleteAttendance));
                            ok("Entry removed");
                            await this.renderActiveTab();
                        } catch (e) {
                            fail(e.message);
                        }
                    }
                });
            })
        );
    },

    // ------------------------------------------------------------ MENU ITEMS
    menuItemPages: {}, // per-section current page number, keyed by section id
    showDeletedMenuItems: false, // toggled via the SHOW INACTIVE checkbox on Menu Items

    renderMenuItems(root) {
        const sectionById = Object.fromEntries(this.menu.sections.map((s) => [s.id, s.title]));
        const customIcons = AdminConfig.settings.customIcons || {};
        const PAGE_SIZE = 10;

        const pendingRequestItems = this.menu.items.filter((i) => (i.disableRequests || []).length > 0);

        const iconHtml = (item) =>
            item.imageUrl
                ? `<img src="${item.imageUrl}" style="width:22px; height:22px; object-fit:cover; border-radius:4px;" />`
                : customIcons[item.icon]
                  ? `<img src="${customIcons[item.icon]}" style="width:22px; height:22px; object-fit:contain;" />`
                  : `<span class="icon icon-${item.icon}" style="display:inline-block; width:22px; height:22px;"></span>`;

        const rowHtml = (item) => {
            if (item.deleted) {
                return `
            <tr style="opacity:0.5;">
                <td>${iconHtml(item)}</td>
                <td>${escapeHtmlAttr(item.name)} <span style="color:var(--color-danger); font-size:7pt;">DELETED</span></td>
                <td>\u20b9${item.price}</td>
                <td></td>
                <td style="text-align:right;">
                    <button class="admin-btn" data-restore="${item.id}">RESTORE</button>
                </td>
            </tr>
        `;
            }
            const stockCell =
                item.stockCount == null
                    ? `<span style="color:var(--color-text-muted); font-size:8pt;">\u221e</span>`
                    : item.stockCount === 0
                      ? `<span style="color:var(--color-danger); font-size:8pt;">OUT OF STOCK</span>`
                      : `<span style="${item.stockCount <= 5 ? "color:var(--color-danger);" : ""} font-size:8pt;">${item.stockCount}</span>`;
            return `
            <tr style="${item.available === false ? "opacity:0.5;" : ""}">
                <td>${iconHtml(item)}</td>
                <td>${escapeHtmlAttr(item.name)}${item.available === false ? ' <span style="color:var(--color-danger); font-size:7pt;">UNAVAILABLE</span>' : ""}</td>
                <td>\u20b9${item.price}${
                    item.promoDiscount
                        ? `<br><span style="color: var(--color-accent); font-size: 7pt;">${item.promoDiscount.type === "percent" ? `${item.promoDiscount.value}% OFF` : `\u20b9${item.promoDiscount.value} OFF`}</span>`
                        : ""
                }</td>
                <td>${stockCell}</td>
                <td style="text-align:right;">
                    <button class="admin-btn" data-edit="${item.id}">EDIT</button>
                    <button class="admin-btn" data-toggle-available="${item.id}">${item.available === false ? "MARK AVAILABLE" : "MARK UNAVAILABLE"}</button>
                    <button class="admin-btn admin-btn-danger" data-delete="${item.id}">DELETE</button>
                </td>
            </tr>
        `;
        };

        const sectionBlockHtml = (section) => {
            const rawItems = this.menu.items.filter((i) => i.section === section.id);
            // SHOW INACTIVE off (default): deleted items are excluded entirely -
            // they don't count toward the section total or take up a page slot.
            // SHOW INACTIVE on: deleted items are appended, but active items
            // always sort first so they still fill page 1 rather than being
            // interleaved with restore-only rows.
            const items = this.showDeletedMenuItems
                ? [...rawItems].sort((a, b) => (a.deleted === b.deleted ? 0 : a.deleted ? 1 : -1))
                : rawItems.filter((i) => !i.deleted);
            if (items.length === 0) {
                return `
                    <div class="menu-section-block" style="margin-bottom:26px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <h3 style="font-size:10pt; letter-spacing:1px; color:var(--color-accent);">${escapeHtmlAttr(section.title)}</h3>
                            <button class="admin-btn admin-btn-danger" data-delete-section="${section.id}">DELETE SECTION</button>
                        </div>
                        <p class="admin-help-text">No items in this section yet.</p>
                    </div>
                `;
            }
            const page = this.menuItemPages[section.id] || 1;
            const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
            const clampedPage = Math.min(page, totalPages);
            const pageItems = items.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

            return `
                <div class="menu-section-block" data-section="${section.id}" style="margin-bottom:26px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <h3 style="font-size:10pt; letter-spacing:1px; color:var(--color-accent);">${escapeHtmlAttr(section.title)} <span style="color:var(--color-text-muted); font-size:8pt;">(${items.length})</span></h3>
                        <button class="admin-btn admin-btn-danger" data-delete-section="${section.id}">DELETE SECTION</button>
                    </div>
                    <table class="admin-table">
                        <thead><tr><th>ICON</th><th>NAME</th><th>PRICE</th><th>STOCK</th><th style="text-align:right;">ACTION</th></tr></thead>
                        <tbody>${pageItems.map(rowHtml).join("")}</tbody>
                    </table>
                    ${
                        totalPages > 1
                            ? `<div style="display:flex; align-items:center; gap:2px; margin-top:8px; justify-content:flex-end;">
                            <button class="admin-pg-btn menu-page-first" data-section="${section.id}" ${clampedPage <= 1 ? "disabled" : ""} title="First page">\u00ab</button>
                            <button class="admin-pg-btn menu-page-prev" data-section="${section.id}" ${clampedPage <= 1 ? "disabled" : ""} title="Previous page">\u2039</button>
                            <span style="font-size:8pt; color:var(--color-text-muted); margin:0 6px;">${(clampedPage - 1) * PAGE_SIZE + 1}-${Math.min(clampedPage * PAGE_SIZE, items.length)} of ${items.length}</span>
                            <button class="admin-pg-btn menu-page-next" data-section="${section.id}" ${clampedPage >= totalPages ? "disabled" : ""} title="Next page">\u203a</button>
                            <button class="admin-pg-btn menu-page-last" data-section="${section.id}" ${clampedPage >= totalPages ? "disabled" : ""} title="Last page">\u00bb</button>
                        </div>`
                            : ""
                    }
                </div>
            `;
        };

        root.innerHTML = `
            ${
                pendingRequestItems.length
                    ? `
                <div style="border-left:3px solid var(--color-danger); padding:10px 14px; margin-bottom:20px; background:var(--color-bg);">
                    <h3 style="font-size:9pt; color:var(--color-danger); margin-bottom:8px;">PENDING DISABLE REQUESTS (${pendingRequestItems.length})</h3>
                    ${pendingRequestItems
                        .map(
                            (item) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px dashed var(--color-border); font-size:8pt;">
                            <div>
                                <strong>${escapeHtmlAttr(item.name)}</strong>
                                ${item.disableRequests
                                    .map((r) => `<div style="color:var(--color-text-muted);">${escapeHtmlAttr(r.by)} (${r.role}): "${escapeHtmlAttr(r.note || "no note")}"</div>`)
                                    .join("")}
                            </div>
                            <div>
                                <button class="admin-btn" data-approve-disable="${item.id}">DISABLE ITEM</button>
                                <button class="admin-btn" data-dismiss-disable="${item.id}">DISMISS</button>
                            </div>
                        </div>
                    `
                        )
                        .join("")}
                </div>
            `
                    : ""
            }

            <div class="admin-toolbar" style="display:flex; align-items:center; flex-wrap:wrap; gap:14px;">
                <button class="admin-btn-primary" id="menu-add-item">+ ADD ITEM</button>
                <button class="admin-btn" id="menu-add-section">+ ADD SECTION</button>
                <label style="display:flex; align-items:center; gap:5px; font-size: var(--admin-help-font-size, 7.5pt); color: var(--admin-help-color, var(--color-text-muted)); cursor:pointer; font-family: 'Courier New', monospace; margin-left:auto;">
                    <input type="checkbox" id="menu-show-deleted" ${this.showDeletedMenuItems ? "checked" : ""} style="width:auto;" />
                    SHOW INACTIVE
                </label>
            </div>

            ${this.menu.sections.map(sectionBlockHtml).join("")}
        `;

        document.getElementById("menu-add-item").addEventListener("click", () => this.openItemModal(null));
        document.getElementById("menu-add-section").addEventListener("click", () => this.addMenuSection(root));
        document.getElementById("menu-show-deleted").addEventListener("change", (e) => {
            this.showDeletedMenuItems = e.target.checked;
            this.menuItemPages = {}; // page numbers may no longer be valid once the item counts change
            this.renderMenuItems(root);
        });

        root.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => this.openItemModal(Number(btn.dataset.edit))));
        root.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => this.deleteItem(Number(btn.dataset.delete))));
        root.querySelectorAll("[data-restore]").forEach((btn) => btn.addEventListener("click", () => this.restoreItem(Number(btn.dataset.restore), root)));
        root.querySelectorAll("[data-toggle-available]").forEach((btn) =>
            btn.addEventListener("click", () => this.toggleItemAvailable(Number(btn.dataset.toggleAvailable), root))
        );
        root.querySelectorAll("[data-delete-section]").forEach((btn) => btn.addEventListener("click", () => this.deleteMenuSection(btn.dataset.deleteSection, root)));
        root.querySelectorAll("[data-approve-disable]").forEach((btn) =>
            btn.addEventListener("click", () => this.toggleItemAvailable(Number(btn.dataset.approveDisable), root, false))
        );
        root.querySelectorAll("[data-dismiss-disable]").forEach((btn) => btn.addEventListener("click", () => this.dismissDisableRequest(Number(btn.dataset.dismissDisable), root)));
        root.querySelectorAll(".menu-page-first").forEach((btn) =>
            btn.addEventListener("click", () => {
                this.menuItemPages[btn.dataset.section] = 1;
                this.renderMenuItems(root);
            })
        );
        root.querySelectorAll(".menu-page-prev").forEach((btn) =>
            btn.addEventListener("click", () => {
                const sec = btn.dataset.section;
                this.menuItemPages[sec] = Math.max(1, (this.menuItemPages[sec] || 1) - 1);
                this.renderMenuItems(root);
            })
        );
        root.querySelectorAll(".menu-page-next").forEach((btn) =>
            btn.addEventListener("click", () => {
                const sec = btn.dataset.section;
                this.menuItemPages[sec] = (this.menuItemPages[sec] || 1) + 1;
                this.renderMenuItems(root);
            })
        );
        root.querySelectorAll(".menu-page-last").forEach((btn) =>
            btn.addEventListener("click", () => {
                const sec = btn.dataset.section;
                const count = this.menu.items.filter((i) => i.section === sec).length;
                this.menuItemPages[sec] = Math.max(1, Math.ceil(count / PAGE_SIZE));
                this.renderMenuItems(root);
            })
        );
    },

    async addMenuSection(root) {
        const title = prompt("New section name (e.g. Seasonal Specials):");
        if (!title || !title.trim()) return;
        try {
            const res = await fetch("/api/menu/sections", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: title.trim() })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not add section");
            await this.loadMenu();
            this.renderMenuItems(root);
            ok("Section added");
        } catch (e) {
            fail(e.message);
        }
    },

    async deleteMenuSection(sectionId, root) {
        renderInfoModal({
            title: "DELETE SECTION",
            message: "This only works if the section has no items left. Continue?",
            confirmText: "DELETE",
            cancelText: "CANCEL",
            onConfirm: async () => {
                try {
                    const res = await fetch(`/api/menu/sections/${sectionId}`, { method: "DELETE", credentials: "include" });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Could not delete section");
                    await this.loadMenu();
                    this.renderMenuItems(root);
                    ok("Section deleted");
                } catch (e) {
                    fail(e.message);
                }
            }
        });
    },

    /** Toggles (or sets, via explicit `makeAvailable`) an item's availability.
     *  Used both by the direct MARK UNAVAILABLE/AVAILABLE row button and by
     *  DISABLE ITEM on a pending staff request (which always disables). */
    async toggleItemAvailable(itemId, root, makeAvailable = null) {
        const item = this.menu.items.find((i) => i.id === itemId);
        if (!item) return;
        const nextAvailable = makeAvailable !== null ? makeAvailable : item.available === false;
        try {
            const res = await fetch(`/api/menu/${itemId}`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ available: nextAvailable })
            });
            if (!res.ok) throw new Error((await res.json()).error || "Could not update item");
            await this.loadMenu();
            this.renderMenuItems(root);
            ok(nextAvailable ? "Item marked available" : "Item marked unavailable");
        } catch (e) {
            fail(e.message);
        }
    },

    async dismissDisableRequest(itemId, root) {
        try {
            const res = await fetch(`/api/menu/${itemId}/disable-request`, { method: "DELETE", credentials: "include" });
            if (!res.ok) throw new Error((await res.json()).error || "Could not dismiss request");
            await this.loadMenu();
            this.renderMenuItems(root);
            ok("Request dismissed");
        } catch (e) {
            fail(e.message);
        }
    },

    openItemModal(itemId) {
        const item = itemId ? this.menu.items.find((i) => i.id === itemId) : null;
        renderItemModal({
            sections: this.menu.sections,
            customIcons: AdminConfig.settings.customIcons || {},
            item,
            onSave: async (payload) => {
                const url = item ? `/api/menu/${item.id}` : "/api/menu";
                const res = await fetch(url, {
                    method: item ? "PATCH" : "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Could not save item");
                await this.loadMenu();
                await this.renderActiveTab();
                ok(item ? "Item updated" : "Item added");
            }
        });
    },

    async deleteItem(id) {
        renderInfoModal({
            title: "DELETE ITEM",
            message: "This hides the item from customers immediately. It stays on file (and can be restored later) rather than being permanently erased. Continue?",
            confirmText: "DELETE",
            cancelText: "CANCEL",
            onConfirm: async () => {
                const res = await fetch(`/api/menu/${id}`, { method: "DELETE", credentials: "include" });
                if (res.ok) {
                    await this.loadMenu();
                    await this.renderActiveTab();
                    ok("Item deleted");
                } else {
                    fail("Could not delete item");
                }
            }
        });
    },

    async restoreItem(id, root) {
        const res = await fetch(`/api/menu/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deleted: false })
        });
        if (res.ok) {
            await this.loadMenu();
            this.renderMenuItems(root);
            ok("Item restored (still marked unavailable - use MARK AVAILABLE to show it to customers)");
        } else {
            fail("Could not restore item");
        }
    },

    // ------------------------------------------------------------ CUSTOMIZATION PRICING
    renderCustomizationPricing(root) {
        const groups = [
            { key: "sizeOptions", title: "SIZES", note: "Applies only to drink items (fast-sellers, limited, classics sections)." },
            { key: "milkOptions", title: "MILK OPTIONS", note: "Applies only to drink items." },
            { key: "extraOptions", title: "EXTRAS", note: "Available on any item." }
        ];

        root.innerHTML = `
            <p class="admin-help-text" style="margin-bottom: 20px;">
                These are the size/milk/extra choices customers see in the CUSTOMIZE popup, and what each one adds to the price.
                Changes apply to new orders immediately - existing orders already placed are unaffected.
            </p>
            ${groups
                .map(
                    (g) => `
                <div class="cp-group" data-group="${g.key}" style="margin-bottom: 30px;">
                    <h3 style="font-size: 10pt; letter-spacing: 1px; color: var(--color-accent); margin-bottom: 4px;">${g.title}</h3>
                    <p class="admin-help-text" style="margin-bottom: 10px;">${g.note}</p>
                    <table class="admin-table">
                        <thead><tr><th>LABEL</th><th>KEY</th><th>PRICE ADD-ON (\u20b9)</th><th></th></tr></thead>
                        <tbody class="cp-rows"></tbody>
                    </table>
                    <button class="admin-btn cp-add-row" style="margin-top:8px;">+ ADD OPTION</button>
                    <button class="admin-btn admin-btn-primary cp-save" style="margin-top:8px; margin-left:8px;">SAVE ${g.title}</button>
                    <p class="cp-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 6px 0 0;"></p>
                </div>
            `
                )
                .join("")}
        `;

        groups.forEach((g) => this.renderCustomizationRows(root, g.key));

        root.querySelectorAll(".cp-group").forEach((groupEl) => {
            const groupKey = groupEl.dataset.group;
            groupEl.querySelector(".cp-add-row").addEventListener("click", () => {
                this.customizationOptions[groupKey] = [...this.customizationOptions[groupKey], { key: "", label: "", priceDelta: 0 }];
                this.renderCustomizationRows(root, groupKey);
            });
            groupEl.querySelector(".cp-save").addEventListener("click", () => this.saveCustomizationGroup(root, groupKey));
        });
    },

    renderCustomizationRows(root, groupKey) {
        const groupEl = root.querySelector(`.cp-group[data-group="${groupKey}"]`);
        if (!groupEl) return;
        const rows = this.customizationOptions[groupKey] || [];
        const tbody = groupEl.querySelector(".cp-rows");
        tbody.innerHTML = rows
            .map(
                (opt, idx) => `
                <tr data-idx="${idx}">
                    <td><input class="cp-label" type="text" value="${escapeHtmlAttr(opt.label)}" style="width:100%; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:5px; font-family:inherit;" /></td>
                    <td><input class="cp-key" type="text" value="${escapeHtmlAttr(opt.key)}" placeholder="auto from label" style="width:100%; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text-muted); padding:5px; font-family:inherit; font-size:8pt;" /></td>
                    <td><input class="cp-price" type="number" min="0" step="1" value="${opt.priceDelta}" style="width:90px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:5px; font-family:inherit;" /></td>
                    <td><button class="admin-btn admin-btn-danger cp-remove-row">REMOVE</button></td>
                </tr>
            `
            )
            .join("");

        tbody.querySelectorAll("tr").forEach((tr) => {
            const idx = Number(tr.dataset.idx);
            tr.querySelector(".cp-remove-row").addEventListener("click", () => {
                this.customizationOptions[groupKey] = this.customizationOptions[groupKey].filter((_, i) => i !== idx);
                this.renderCustomizationRows(root, groupKey);
            });
        });
    },

    async saveCustomizationGroup(root, groupKey) {
        const groupEl = root.querySelector(`.cp-group[data-group="${groupKey}"]`);
        const errorEl = groupEl.querySelector(".cp-error");
        errorEl.textContent = "";

        const rows = [...groupEl.querySelectorAll(".cp-rows tr")].map((tr) => {
            const label = tr.querySelector(".cp-label").value.trim();
            const rawKey = tr.querySelector(".cp-key").value.trim();
            const priceDelta = Number(tr.querySelector(".cp-price").value);
            // A blank key auto-derives from the label (lowercase, hyphenated) - the
            // server does the same normalization, this just saves manual typing.
            const key = rawKey || label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            return { key, label, priceDelta };
        });

        try {
            const res = await fetch("/api/customization-options", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [groupKey]: rows })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not save");
            this.customizationOptions = { ...this.customizationOptions, [groupKey]: data[groupKey] };
            this.renderCustomizationRows(root, groupKey);
            ok("Pricing updated");
        } catch (e) {
            errorEl.textContent = e.message || "Could not save";
        }
    },

    // ------------------------------------------------------------ DISCOUNTS & LOYALTY
    async renderDiscountsLoyalty(root) {
        const config = AdminConfig.settings;
        const loyalty = config.loyalty || { enabled: true, pointsPerRupeeSpent: 0.1, rupeeValuePerPoint: 0.5 };
        const couponsRes = await fetch("/api/coupons", { credentials: "include" });
        const coupons = couponsRes.ok ? await couponsRes.json() : [];

        root.innerHTML = `
            <h3 style="font-size:10pt; letter-spacing:1px; color:var(--color-accent); margin-bottom:10px;">LOYALTY PROGRAM</h3>
            <p class="admin-help-text" style="margin-bottom:14px;">
                Customers earn points automatically when they check out logged in, and can redeem points for a discount on a later order. Guests don't have a persistent account, so points don't apply to guest checkouts.
            </p>
            <div class="config-controls" style="margin-bottom:30px;">
                <div class="control-group" style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="loyalty-enabled" ${loyalty.enabled ? "checked" : ""} style="width:auto;" />
                    <label style="margin:0;" for="loyalty-enabled">ENABLE LOYALTY PROGRAM</label>
                </div>
                <div class="control-group">
                    <label>POINTS EARNED PER \u20b91 SPENT</label>
                    <input type="text" id="loyalty-earn-rate" value="${loyalty.pointsPerRupeeSpent}" />
                    <p class="admin-help-text" style="margin-top:4px;">e.g. 0.1 = 1 point per \u20b910 spent (industry-typical "1 point per \u20b910" rate)</p>
                </div>
                <div class="control-group">
                    <label>\u20b9 VALUE PER POINT REDEEMED</label>
                    <input type="text" id="loyalty-redeem-rate" value="${loyalty.rupeeValuePerPoint}" />
                    <p class="admin-help-text" style="margin-top:4px;">e.g. 0.5 = each point is worth \u20b90.50 off when redeemed</p>
                </div>
                <p id="loyalty-error" style="color:var(--color-danger); font-size:8pt; min-height:12px;"></p>
                <button class="admin-btn-primary" id="loyalty-save">SAVE LOYALTY SETTINGS</button>
            </div>

            <h3 style="font-size:10pt; letter-spacing:1px; color:var(--color-accent); margin-bottom:10px; border-top:1px solid var(--color-border); padding-top:20px;">COUPONS</h3>
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px; background:var(--color-bg); padding:12px; border:1px solid var(--color-border);">
                <div>
                    <label class="admin-field-label" style="display:block; margin-bottom:4px;">CODE</label>
                    <input type="text" id="coupon-code" placeholder="WELCOME10" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit; width:130px;" />
                </div>
                <div>
                    <label class="admin-field-label" style="display:block; margin-bottom:4px;">TYPE</label>
                    <select id="coupon-type" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit;">
                        <option value="percent">% OFF</option>
                        <option value="flat">\u20b9 FLAT OFF</option>
                    </select>
                </div>
                <div>
                    <label class="admin-field-label" style="display:block; margin-bottom:4px;">VALUE</label>
                    <input type="text" id="coupon-value" placeholder="10" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit; width:80px;" />
                </div>
                <div>
                    <label class="admin-field-label" style="display:block; margin-bottom:4px;">USE LIMIT (blank = until stopped)</label>
                    <input type="text" id="coupon-limit" placeholder="e.g. 50" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit; width:140px;" />
                </div>
                <label style="display:flex; align-items:center; gap:5px; font-size: 8pt; cursor:pointer;">
                    <input type="checkbox" id="coupon-private" style="width:auto;" />
                    PRIVATE
                </label>
                <button class="admin-btn-primary" id="coupon-add">+ ADD COUPON</button>
            </div>
            <p id="coupon-error" style="color:var(--color-danger); font-size:8pt; min-height:12px;"></p>
            <table class="admin-table">
                <thead><tr><th>CODE</th><th>DISCOUNT</th><th>VISIBILITY</th><th>USAGE</th><th>STATUS</th><th style="text-align:right;">ACTION</th></tr></thead>
                <tbody>
                    ${
                        coupons.length
                            ? coupons
                                  .map(
                                      (c) => `
                        <tr>
                            <td><strong>${escapeHtmlAttr(c.code)}</strong></td>
                            <td>${c.type === "percent" ? `${c.value}% off` : `\u20b9${c.value} off`}</td>
                            <td style="font-size:8pt; color:var(--color-text-muted);">${c.private ? "PRIVATE" : "PUBLIC"}</td>
                            <td>${c.usedCount} / ${c.usageLimit === null ? "\u221e (until stopped)" : c.usageLimit}</td>
                            <td style="color:${c.active ? "var(--color-success)" : "var(--color-text-muted)"};">${c.active ? "ACTIVE" : "STOPPED"}</td>
                            <td style="text-align:right;">
                                <button class="admin-btn" data-toggle-coupon="${c.id}">${c.active ? "STOP" : "RESUME"}</button>
                                <button class="admin-btn" data-toggle-private="${c.id}">${c.private ? "MAKE PUBLIC" : "MAKE PRIVATE"}</button>
                                <button class="admin-btn admin-btn-danger" data-delete-coupon="${c.id}">DELETE</button>
                            </td>
                        </tr>
                    `
                                  )
                                  .join("")
                            : `<tr><td colspan="6" style="text-align:center; color:var(--color-text-muted); padding:20px;">No coupons yet.</td></tr>`
                    }
                </tbody>
            </table>
        `;

        document.getElementById("loyalty-save").addEventListener("click", async () => {
            const errorEl = document.getElementById("loyalty-error");
            errorEl.textContent = "";
            const earnRate = parseFloat(document.getElementById("loyalty-earn-rate").value);
            const redeemRate = parseFloat(document.getElementById("loyalty-redeem-rate").value);
            if (!Number.isFinite(earnRate) || earnRate < 0 || !Number.isFinite(redeemRate) || redeemRate < 0) {
                errorEl.textContent = "Both rates must be zero or positive numbers.";
                return;
            }
            try {
                await AdminConfig.saveSettings({
                    loyalty: { enabled: document.getElementById("loyalty-enabled").checked, pointsPerRupeeSpent: earnRate, rupeeValuePerPoint: redeemRate }
                });
                ok("Loyalty settings saved");
            } catch (e) {
                errorEl.textContent = e.message || "Could not save";
            }
        });

        document.getElementById("coupon-add").addEventListener("click", async () => {
            const errorEl = document.getElementById("coupon-error");
            errorEl.textContent = "";
            const code = document.getElementById("coupon-code").value.trim();
            const type = document.getElementById("coupon-type").value;
            const value = Number(document.getElementById("coupon-value").value);
            const limitRaw = document.getElementById("coupon-limit").value.trim();
            const usageLimit = limitRaw === "" ? null : parseInt(limitRaw, 10);
            const isPrivate = document.getElementById("coupon-private").checked;

            try {
                const res = await fetch("/api/coupons", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code, type, value, usageLimit, private: isPrivate })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Could not add coupon");
                await this.renderDiscountsLoyalty(root);
                ok("Coupon added");
            } catch (e) {
                errorEl.textContent = e.message;
            }
        });

        root.querySelectorAll("[data-toggle-coupon]").forEach((btn) =>
            btn.addEventListener("click", async () => {
                const coupon = coupons.find((c) => c.id === Number(btn.dataset.toggleCoupon));
                await fetch(`/api/coupons/${coupon.id}`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ active: !coupon.active })
                });
                await this.renderDiscountsLoyalty(root);
                ok(coupon.active ? "Coupon stopped" : "Coupon resumed");
            })
        );
        root.querySelectorAll("[data-toggle-private]").forEach((btn) =>
            btn.addEventListener("click", async () => {
                const coupon = coupons.find((c) => c.id === Number(btn.dataset.togglePrivate));
                await fetch(`/api/coupons/${coupon.id}`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ private: !coupon.private })
                });
                await this.renderDiscountsLoyalty(root);
                ok(coupon.private ? "Coupon made public" : "Coupon made private");
            })
        );
        root.querySelectorAll("[data-delete-coupon]").forEach((btn) =>
            btn.addEventListener("click", () => {
                renderInfoModal({
                    title: "DELETE COUPON",
                    message: "Confirm permanent deletion of this coupon?",
                    confirmText: "DELETE",
                    cancelText: "CANCEL",
                    onConfirm: async () => {
                        await fetch(`/api/coupons/${btn.dataset.deleteCoupon}`, { method: "DELETE", credentials: "include" });
                        await this.renderDiscountsLoyalty(root);
                        ok("Coupon deleted");
                    }
                });
            })
        );
    },

    renderCombos(root) {
        const itemById = Object.fromEntries(this.menu.items.map((i) => [i.id, i]));

        root.innerHTML = `
            <div class="admin-toolbar">
                <button class="admin-btn-primary" id="combo-add">+ ADD COMBO</button>
            </div>
            <table class="admin-table">
                <thead>
                    <tr><th>NAME</th><th>ITEMS</th><th>PRICE</th><th>STATUS</th><th style="text-align:right;">ACTION</th></tr>
                </thead>
                <tbody>
                    ${
                        this.combos.length
                            ? this.combos
                                  .map((combo) => {
                                      const lines = combo.items.map((i) => `${i.quantity}x ${itemById[i.id] ? itemById[i.id].name : "(removed item)"}`).join(", ");
                                      const baseTotal = combo.items.reduce((sum, i) => sum + (itemById[i.id] ? itemById[i.id].price * i.quantity : 0), 0);
                                      const savings = baseTotal - combo.price;
                                      return `
                                <tr>
                                    <td>${combo.name}</td>
                                    <td style="color: var(--color-text-muted); font-size: 8pt;">${lines}</td>
                                    <td>\u20b9${combo.price} ${savings > 0 ? `<span style="color: var(--color-accent); font-size: 7pt;">(save \u20b9${savings.toFixed(0)})</span>` : ""}</td>
                                    <td style="font-size: 8pt; color: ${combo.active !== false ? "var(--color-accent)" : "var(--color-text-muted)"};">${combo.active !== false ? "ACTIVE" : "HIDDEN"}</td>
                                    <td style="text-align:right;">
                                        <button class="admin-btn" data-combo-edit="${combo.id}">EDIT</button>
                                        <button class="admin-btn" data-combo-toggle="${combo.id}">${combo.active !== false ? "HIDE" : "SHOW"}</button>
                                        <button class="admin-btn admin-btn-danger" data-combo-delete="${combo.id}">DELETE</button>
                                    </td>
                                </tr>
                            `;
                                  })
                                  .join("")
                            : `<tr><td colspan="5" style="text-align:center; color: var(--color-text-muted); padding: 20px;">No combos yet.</td></tr>`
                    }
                </tbody>
            </table>
        `;

        document.getElementById("combo-add").addEventListener("click", () => this.openComboModal(null));
        root.querySelectorAll("[data-combo-edit]").forEach((btn) => btn.addEventListener("click", () => this.openComboModal(Number(btn.dataset.comboEdit))));
        root.querySelectorAll("[data-combo-toggle]").forEach((btn) => btn.addEventListener("click", () => this.toggleCombo(Number(btn.dataset.comboToggle))));
        root.querySelectorAll("[data-combo-delete]").forEach((btn) => btn.addEventListener("click", () => this.deleteCombo(Number(btn.dataset.comboDelete))));
    },

    openComboModal(comboId) {
        const combo = comboId ? this.combos.find((c) => c.id === comboId) : null;
        if (this.menu.items.length < 2) {
            fail("Add at least 2 menu items before creating a combo");
            return;
        }
        renderComboModal({
            menuItems: this.menu.items,
            combo,
            onSave: async (payload) => {
                const url = combo ? `/api/combos/${combo.id}` : "/api/combos";
                const res = await fetch(url, {
                    method: combo ? "PATCH" : "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Could not save combo");
                await this.loadCombos();
                await this.renderActiveTab();
                ok(combo ? "Combo updated" : "Combo added");
            }
        });
    },

    async toggleCombo(id) {
        const combo = this.combos.find((c) => c.id === id);
        if (!combo) return;
        const res = await fetch(`/api/combos/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: combo.active === false })
        });
        if (res.ok) {
            await this.loadCombos();
            await this.renderActiveTab();
            ok(combo.active === false ? "Combo shown on menu" : "Combo hidden from menu");
        } else {
            fail("Could not update combo");
        }
    },

    async deleteCombo(id) {
        renderInfoModal({
            title: "DELETE COMBO",
            message: "Confirm permanent deletion of this combo?",
            confirmText: "DELETE",
            cancelText: "CANCEL",
            onConfirm: async () => {
                const res = await fetch(`/api/combos/${id}`, { method: "DELETE", credentials: "include" });
                if (res.ok) {
                    await this.loadCombos();
                    await this.renderActiveTab();
                    ok("Combo deleted");
                } else {
                    fail("Could not delete combo");
                }
            }
        });
    },

    // ------------------------------------------------------------ ORDER HISTORY
    orderHistorySort: "newest",
    orderHistoryFilter: "all",

    orderHistoryPage: 1,
    orderHistorySelectedId: null,

    async renderOrderHistory(root) {
        const res = await fetch("/api/orders", { credentials: "include" });
        const orders = res.ok ? await res.json() : [];
        const PAGE_SIZE = 10;

        root.innerHTML = `
            <div class="admin-toolbar" style="justify-content: space-between;">
                <div style="display:flex; gap:6px;">
                    <button class="admin-btn ${this.orderHistoryFilter === "all" ? "active" : ""}" data-history-filter="all">ALL</button>
                    <button class="admin-btn ${this.orderHistoryFilter === "active" ? "active" : ""}" data-history-filter="active">ACTIVE</button>
                    <button class="admin-btn ${this.orderHistoryFilter === "completed" ? "active" : ""}" data-history-filter="completed">COMPLETED</button>
                </div>
                <select id="order-history-sort" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px 10px; font-family:inherit; font-size:8pt;">
                    <option value="newest" ${this.orderHistorySort === "newest" ? "selected" : ""}>NEWEST FIRST</option>
                    <option value="oldest" ${this.orderHistorySort === "oldest" ? "selected" : ""}>OLDEST FIRST</option>
                </select>
            </div>
            <div class="order-history-layout">
                <div>
                    <table class="admin-table">
                        <thead><tr><th>ORDER #</th><th>DATE</th><th>CUSTOMER</th><th>AMOUNT</th><th>STATUS</th></tr></thead>
                        <tbody id="order-history-tbody"></tbody>
                    </table>
                    <div id="order-history-pager" style="display:flex; align-items:center; gap:2px; margin-top:10px; justify-content:flex-end;"></div>
                </div>
                <div id="order-history-detail" class="order-history-detail">
                    <p class="admin-help-text">Select an order from the list to see its details.</p>
                </div>
            </div>
        `;

        const renderList = () => {
            let filtered = orders.filter((o) => {
                const complete = o.items.every((i) => i.isDone);
                if (this.orderHistoryFilter === "active") return !complete;
                if (this.orderHistoryFilter === "completed") return complete;
                return true;
            });
            filtered = filtered.sort((a, b) => {
                const diff = new Date(a.createdAt) - new Date(b.createdAt);
                return this.orderHistorySort === "newest" ? -diff : diff;
            });

            const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
            this.orderHistoryPage = Math.min(this.orderHistoryPage, totalPages);
            const pageOrders = filtered.slice((this.orderHistoryPage - 1) * PAGE_SIZE, this.orderHistoryPage * PAGE_SIZE);

            const tbody = document.getElementById("order-history-tbody");
            tbody.innerHTML = pageOrders.length
                ? pageOrders
                      .map((o) => {
                          const complete = o.items.every((i) => i.isDone);
                          const customerLabel = o.customerName ? `${escapeHtmlAttr(o.customerName)} (${o.customerPhone || "-"})` : o.customerPhone || "-";
                          return `
                        <tr class="order-history-row ${o.id === this.orderHistorySelectedId ? "active" : ""}" data-order-id="${o.id}" style="cursor:pointer;">
                            <td>#${o.orderNumber || o.id}</td>
                            <td style="font-size:8pt;">${new Date(o.createdAt).toLocaleString()}</td>
                            <td style="font-size:8pt;">${customerLabel}</td>
                            <td>\u20b9${o.total.toFixed(2)}</td>
                            <td style="font-size:8pt;">
                                <span style="color:${o.isPaid ? "var(--color-success)" : "var(--color-danger)"};">${o.isPaid ? "PAID" : "UNPAID"}</span>
                                &middot; <span style="color:${complete ? "var(--color-success)" : "var(--color-cyan)"};">${complete ? "DONE" : "ACTIVE"}</span>
                            </td>
                        </tr>
                    `;
                      })
                      .join("")
                : `<tr><td colspan="5" style="text-align:center; color:var(--color-text-muted); padding:20px;">No orders match this filter.</td></tr>`;

            tbody.querySelectorAll(".order-history-row").forEach((row) => {
                row.addEventListener("click", () => {
                    this.orderHistorySelectedId = row.dataset.orderId;
                    renderList();
                    renderDetail(orders.find((o) => o.id === this.orderHistorySelectedId));
                });
            });

            const pager = document.getElementById("order-history-pager");
            pager.innerHTML =
                totalPages > 1
                    ? `
                <button class="admin-pg-btn" id="oh-first" ${this.orderHistoryPage <= 1 ? "disabled" : ""} title="First page">\u00ab</button>
                <button class="admin-pg-btn" id="oh-prev" ${this.orderHistoryPage <= 1 ? "disabled" : ""} title="Previous page">\u2039</button>
                <span style="font-size:8pt; color:var(--color-text-muted); margin:0 6px;">${(this.orderHistoryPage - 1) * PAGE_SIZE + 1}-${Math.min(this.orderHistoryPage * PAGE_SIZE, filtered.length)} of ${filtered.length}</span>
                <button class="admin-pg-btn" id="oh-next" ${this.orderHistoryPage >= totalPages ? "disabled" : ""} title="Next page">\u203a</button>
                <button class="admin-pg-btn" id="oh-last" ${this.orderHistoryPage >= totalPages ? "disabled" : ""} title="Last page">\u00bb</button>
            `
                    : "";
            const firstBtn = document.getElementById("oh-first");
            const prevBtn = document.getElementById("oh-prev");
            const nextBtn = document.getElementById("oh-next");
            const lastBtn = document.getElementById("oh-last");
            if (firstBtn) firstBtn.addEventListener("click", () => { this.orderHistoryPage = 1; renderList(); });
            if (prevBtn) prevBtn.addEventListener("click", () => { this.orderHistoryPage--; renderList(); });
            if (nextBtn) nextBtn.addEventListener("click", () => { this.orderHistoryPage++; renderList(); });
            if (lastBtn) lastBtn.addEventListener("click", () => { this.orderHistoryPage = totalPages; renderList(); });
        };

        const renderDetail = (order) => {
            const detailRoot = document.getElementById("order-history-detail");
            if (!order) {
                detailRoot.innerHTML = `<p class="admin-help-text">Select an order from the list to see its details.</p>`;
                return;
            }
            const complete = order.items.every((i) => i.isDone);
            const customerLabel = order.customerName ? `${escapeHtmlAttr(order.customerName)} (${order.customerPhone || "-"})` : order.customerPhone || "Walk-in";

            detailRoot.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                    <div>
                        <h3 style="margin:0; font-size:11pt;">#${order.orderNumber || order.id}</h3>
                        <div style="font-size:8pt; color:var(--color-text-muted);">${new Date(order.createdAt).toLocaleString()}</div>
                    </div>
                    <span style="font-size:8pt; color:${complete ? "var(--color-success)" : "var(--color-cyan)"};">${complete ? "COMPLETED" : "ACTIVE"}</span>
                </div>
                <div style="font-size:9pt; margin-bottom:10px;"><strong>Customer:</strong> ${customerLabel} &middot; ${order.method}</div>
                <div style="border-top:1px dashed var(--color-border); border-bottom:1px dashed var(--color-border); padding:10px 0; margin-bottom:10px;">
                    ${order.items
                        .map((i) => {
                            const tags = [];
                            if (i.sizeLabel && i.sizeLabel !== "Regular") tags.push(i.sizeLabel);
                            if (i.milkLabel && i.milkLabel !== "Regular Milk") tags.push(i.milkLabel);
                            (i.extras || []).forEach((e) => tags.push(`+${e.label}`));
                            return `
                            <div style="display:flex; justify-content:space-between; font-size:9pt; margin-bottom:4px;">
                                <span>${i.quantity}x ${escapeHtmlAttr(i.name)}${i.comboName ? ` <span style="color:var(--color-text-muted); font-size:7pt;">(${escapeHtmlAttr(i.comboName)})</span>` : ""}</span>
                                <span>\u20b9${(i.price * i.quantity).toFixed(2)}</span>
                            </div>
                            ${tags.length ? `<div style="font-size:7pt; color:var(--color-accent); margin-bottom:4px;">${tags.map(escapeHtmlAttr).join(" &middot; ")}</div>` : ""}
                            ${i.notes ? `<div style="font-size:7pt; color:var(--color-text-muted); font-style:italic; margin-bottom:4px;">"${escapeHtmlAttr(i.notes)}"</div>` : ""}
                        `;
                        })
                        .join("")}
                </div>
                <div style="font-size:8pt; color:var(--color-text-muted); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Subtotal</span><span>\u20b9${order.subtotal.toFixed(2)}</span></div>
                ${order.promoDiscountTotal ? `<div style="font-size:8pt; color:var(--color-accent); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Promo Savings</span><span>-\u20b9${order.promoDiscountTotal.toFixed(2)}</span></div>` : ""}
                ${order.discountAmount ? `<div style="font-size:8pt; color:var(--color-accent); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Discount${order.couponCode ? ` (${escapeHtmlAttr(order.couponCode)})` : ""}</span><span>-\u20b9${order.discountAmount.toFixed(2)}</span></div>` : ""}
                <div style="font-size:8pt; color:var(--color-text-muted); margin-bottom:4px; display:flex; justify-content:space-between;"><span>CGST + SGST</span><span>\u20b9${(order.cgst + order.sgst).toFixed(2)}</span></div>
                ${order.serviceCharge ? `<div style="font-size:8pt; color:var(--color-text-muted); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Service Charge</span><span>\u20b9${order.serviceCharge.toFixed(2)}</span></div>` : ""}
                ${order.tipAmount ? `<div style="font-size:8pt; color:var(--color-text-muted); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Tip</span><span>\u20b9${order.tipAmount.toFixed(2)}</span></div>` : ""}
                <div style="font-size:11pt; font-weight:bold; display:flex; justify-content:space-between; border-top:1px solid var(--color-accent); padding-top:8px; margin-top:6px;"><span>TOTAL</span><span>\u20b9${order.total.toFixed(2)}</span></div>
                <div style="margin-top:16px; display:flex; gap:8px; align-items:center;">
                    <span style="font-size:8pt;">Payment: <strong style="color:${order.isPaid ? "var(--color-success)" : "var(--color-danger)"};">${order.isPaid ? "PAID" : "UNPAID"}</strong></span>
                    ${!order.isPaid ? `<button class="admin-btn admin-btn-primary" id="oh-mark-paid">MARK PAID</button>` : ""}
                </div>
                ${
                    order.rating
                        ? `<div style="margin-top:10px; font-size:8pt; color:var(--color-accent);">
                    CUSTOMER RATING: ${"★".repeat(order.rating)}${"☆".repeat(5 - order.rating)}
                    ${order.feedbackComment ? `<div style="color:var(--color-text-muted); font-style:italic; margin-top:2px;">"${escapeHtmlAttr(order.feedbackComment)}"</div>` : ""}
                </div>`
                        : ""
                }
            `;

            const markPaidBtn = document.getElementById("oh-mark-paid");
            if (markPaidBtn) {
                markPaidBtn.addEventListener("click", async () => {
                    const r = await fetch(`/api/orders/${order.id}`, {
                        method: "PATCH",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "markPaid" })
                    });
                    if (r.ok) {
                        order.isPaid = true;
                        renderDetail(order);
                        renderList();
                        ok("Order marked paid");
                    } else {
                        fail("Could not update order");
                    }
                });
            }
        };

        renderList();
        if (this.orderHistorySelectedId) renderDetail(orders.find((o) => o.id === this.orderHistorySelectedId));

        root.querySelectorAll("[data-history-filter]").forEach((btn) => {
            btn.addEventListener("click", () => {
                this.orderHistoryFilter = btn.dataset.historyFilter;
                this.orderHistoryPage = 1;
                root.querySelectorAll("[data-history-filter]").forEach((b) => b.classList.toggle("active", b === btn));
                renderList();
            });
        });
        document.getElementById("order-history-sort").addEventListener("change", (e) => {
            this.orderHistorySort = e.target.value;
            renderList();
        });
    },

    // ------------------------------------------------------------ STAFF
    async renderStaffManagement(root) {
        const res = await fetch("/api/users", { credentials: "include" });
        const staff = res.ok ? await res.json() : [];
        const isOwner = this.session.role === "owner";
        const isManager = this.session.role === "manager";
        const myUserId = this.session.userId;

        let auditLogHtml = "";
        if (isOwner) {
            const auditRes = await fetch("/api/audit-log", { credentials: "include" });
            const log = auditRes.ok ? await auditRes.json() : [];
            const actionLabels = { reset_password: "Reset password", remove_account: "Removed account", payroll_paid: "Marked payroll paid" };
            auditLogHtml = `
                <h3 style="margin-top:30px; border-top:1px solid var(--color-border); padding-top:20px;">ACCOUNT ACTIVITY LOG</h3>
                <p class="admin-help-text" style="margin-bottom:10px;">Password resets, removals, and payroll actions performed by admins/managers - visible only to the owner.</p>
                ${
                    log.length === 0
                        ? `<p class="admin-help-text">No activity recorded yet.</p>`
                        : `
                <table class="admin-table">
                    <thead><tr><th>WHEN</th><th>ACTION</th><th>BY</th><th>TARGET</th></tr></thead>
                    <tbody>
                        ${log
                            .slice(0, 50)
                            .map(
                                (e) => `
                            <tr>
                                <td style="font-size:8pt;">${new Date(e.timestamp).toLocaleString()}</td>
                                <td style="font-size:8pt;">${actionLabels[e.action] || e.action}</td>
                                <td style="font-size:8pt;">${e.actorName} (${e.actorRole})</td>
                                <td style="font-size:8pt;">${e.targetUsername || "\u2014"}</td>
                            </tr>
                        `
                            )
                            .join("")}
                    </tbody>
                </table>`
                }
            `;
        }

        root.innerHTML = `
            <div class="admin-toolbar">
                <button class="admin-btn-primary" id="staff-add">+ ADD ${isOwner ? "STAFF" : "EMPLOYEE"}</button>
            </div>
            <table class="admin-table">
                <thead>
                    <tr><th>USERNAME</th><th>NAME</th><th>ROLE</th><th>TAG</th><th>PAY RATE</th><th style="text-align:right;">ACTION</th></tr>
                </thead>
                <tbody>
                    ${staff
                        .map((u) => {
                            const isSelf = u.id === myUserId;
                            const canManage =
                                !isSelf &&
                                (isOwner ||
                                    (this.session.role === "admin" && ["employee", "manager"].includes(u.role)) ||
                                    (isManager && u.role === "employee" && u.storeId === this.session.storeId));
                            return `
                        <tr>
                            <td>${u.username}${isSelf ? ' <span style="color:var(--color-text-muted); font-size:7pt;">(you)</span>' : ""}</td>
                            <td>${u.name}</td>
                            <td style="color: var(--color-accent);">${u.role.toUpperCase()}</td>
                            <td style="font-size:8pt; color:var(--color-text-muted);">${u.tag || "\u2014"}</td>
                            <td style="font-size:8pt;">${u.payRateType ? `\u20b9${u.payRate}/${u.payRateType === "hourly" ? "hr" : u.payRateType === "weekly" ? "wk" : "mo"}` : "\u2014"}</td>
                            <td style="text-align:right;">
                                ${
                                    canManage
                                        ? `
                                    <button class="admin-btn" data-edit-staff="${u.id}">EDIT</button>
                                    <button class="admin-btn" data-reset="${u.id}" data-name="${u.name}">RESET PW</button>
                                    <button class="admin-btn admin-btn-danger" data-remove="${u.id}" data-name="${u.name}">REMOVE</button>
                                `
                                        : isSelf
                                          ? `<button class="admin-btn" id="self-account-settings">ACCOUNT SETTINGS</button>`
                                          : `<span style="color:var(--color-text-muted); font-size:7pt;">\u2014</span>`
                                }
                            </td>
                        </tr>
                    `;
                        })
                        .join("")}
                </tbody>
            </table>
            <p class="admin-help-text" style="margin-top: 10px;">
                ${
                    isOwner
                        ? "You can create and manage employee, manager, admin, and owner accounts."
                        : isManager
                          ? "You can create and manage employee accounts at your own store."
                          : "You can create and manage employee and manager accounts. Only the owner can manage admin/owner accounts."
                }
            </p>
            ${auditLogHtml}
        `;

        document.getElementById("staff-add").addEventListener("click", () => {
            renderAddStaffModal(this.session.role, async () => {
                await this.renderActiveTab();
                ok("Staff account created");
            });
        });

        document.getElementById("self-account-settings")?.addEventListener("click", () => {
            renderAccountSettingsModal(this.session);
        });

        root.querySelectorAll("[data-edit-staff]").forEach((btn) =>
            btn.addEventListener("click", () => this.editStaffDetails(Number(btn.dataset.editStaff), staff))
        );
        root.querySelectorAll("[data-reset]").forEach((btn) =>
            btn.addEventListener("click", () => this.resetStaffPassword(Number(btn.dataset.reset), btn.dataset.name))
        );
        root.querySelectorAll("[data-remove]").forEach((btn) =>
            btn.addEventListener("click", () => this.removeStaff(Number(btn.dataset.remove), btn.dataset.name))
        );
    },

    /** Edit an existing staff member's tag and pay rate via a proper modal (not a browser prompt). */
    async editStaffDetails(userId, staffList) {
        const user = staffList.find((u) => u.id === userId);
        renderEditStaffModal(user, async () => {
            await this.renderActiveTab();
            ok("Staff details updated");
        });
    },

    async resetStaffPassword(userId, name) {
        renderInfoModal({
            title: "RESET PASSWORD",
            message: `Generate a new temporary password for ${name}? They'll be required to set their own password the next time they log in.`,
            confirmText: "GENERATE",
            cancelText: "CANCEL",
            onConfirm: async () => {
                const res = await fetch(`/api/users/${userId}/reset-password`, { method: "POST", credentials: "include" });
                const data = await res.json();
                if (!res.ok) return renderInfoModal({ title: "ERROR", message: data.error || "Could not reset password" });
                renderInfoModal({
                    title: "TEMPORARY PASSWORD",
                    message: `Give this to ${name}. It only works once - they'll be asked to set their own password on first login.`,
                    monospaceValue: data.tempPassword,
                    onConfirm: () => this.renderActiveTab() // refresh so the audit log reflects this action immediately
                });
            }
        });
    },

    async removeStaff(userId, name) {
        renderInfoModal({
            title: "REMOVE STAFF ACCOUNT",
            message: `Remove ${name}'s account? This can't be undone.`,
            confirmText: "REMOVE",
            cancelText: "CANCEL",
            onConfirm: async () => {
                const res = await fetch(`/api/users/${userId}`, { method: "DELETE", credentials: "include" });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) return renderInfoModal({ title: "ERROR", message: data.error || "Could not remove account" });
                await this.renderActiveTab();
                ok("Account removed");
            }
        });
    },

    // ------------------------------------------------------------ BRANDING
    async renderBranding(root) {
        const c = AdminConfig.settings;
        const colors = c.colors || {};
        const textStyles = c.textStyles || {};
        const customIcons = c.customIcons || {};
        const profilesRes = await fetch("/api/branding-profiles", { credentials: "include" });
        const profiles = profilesRes.ok ? await profilesRes.json() : {};

        root.innerHTML = `
            <div class="config-controls">
                <h3 style="margin-top:0;">SHOP IDENTITY</h3>
                <div class="control-group">
                    <label>SHOP NAME</label>
                    <input type="text" id="cfg-shop-name" value="${escapeHtmlAttr(c.shopName || "")}" />
                </div>
                <div class="control-group">
                    <label>HOME PAGE BADGE (small line above the hero heading, e.g. "Est. 2019 &middot; 8-bit roastery")</label>
                    <input type="text" id="cfg-hero-badge" maxlength="80" value="${escapeHtmlAttr(c.heroBadgeText || "")}" />
                </div>
                <div class="control-group">
                    <label>HOME PAGE ABOUT TEXT</label>
                    <textarea id="cfg-hero-tagline" rows="3" maxlength="400" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit;">${escapeHtmlAttr(c.heroTagline || "")}</textarea>
                </div>
                <div class="control-group">
                    <label>RECEIPT FOOTER MESSAGE (printed at the bottom of the customer bill - the logo above it comes from LOGO IMAGE below)</label>
                    <input type="text" id="cfg-receipt-footer" maxlength="120" value="${escapeHtmlAttr(c.receiptFooterText || "")}" />
                </div>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">THEME</h3>
                <div class="control-group">
                    <label>THEME (choosing a preset fills in its standard colors below - tweak them after, or pick CUSTOM to leave your own colors alone)</label>
                    <select id="brand-theme" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; width:100%; box-sizing:border-box; font-family:inherit;">
                        <option value="dark" ${c.theme !== "light" && c.theme !== "custom" ? "selected" : ""}>DARK</option>
                        <option value="light" ${c.theme === "light" ? "selected" : ""}>LIGHT</option>
                        <option value="custom" ${c.theme === "custom" ? "selected" : ""}>CUSTOM</option>
                    </select>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div class="control-group">
                        <label>ACCENT COLOR</label>
                        <input type="color" id="brand-accent" value="${colors.accent || "#d97706"}" />
                    </div>
                    <div class="control-group">
                        <label>BACKGROUND COLOR</label>
                        <input type="color" id="brand-background" value="${colors.background || "#0a0a0a"}" />
                    </div>
                    <div class="control-group">
                        <label>SURFACE COLOR (CARDS)</label>
                        <input type="color" id="brand-surface" value="${colors.surface || "#111111"}" />
                    </div>
                    <div class="control-group">
                        <label>TEXT COLOR</label>
                        <input type="color" id="brand-text" value="${colors.text || "#f9fafb"}" />
                    </div>
                    <div class="control-group">
                        <label>SECONDARY / INFO COLOR (used for "preparing" status, station tabs, etc.)</label>
                        <input type="color" id="brand-secondary" value="${colors.secondary || "#22d3ee"}" />
                    </div>
                </div>

                <div class="control-group">
                    <label>HERO / STOREFRONT IMAGE (shown on the home page - leave blank to keep the default icon)</label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="brand-hero" value="${c.heroImageUrl || ""}" placeholder="https://... or pick from the bucket" style="flex:1;" />
                        <button type="button" id="brand-hero-pick" class="admin-btn-secondary" style="white-space:nowrap;">BROWSE</button>
                    </div>
                </div>
                <div class="control-group">
                    <label>LOGO IMAGE (shown in the top nav - leave blank to hide)</label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="brand-logo" value="${c.logoUrl || ""}" placeholder="https://... or pick from the bucket" style="flex:1;" />
                        <button type="button" id="brand-logo-pick" class="admin-btn-secondary" style="white-space:nowrap;">BROWSE</button>
                    </div>
                </div>
                <p class="admin-help-text">Paste a URL, or BROWSE to upload a new image or pick one already in the bucket (shared with menu item photos).</p>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">HOME PAGE CONTENT</h3>
                <p class="admin-help-text">Section headings, this week's picks, and the roast-process story on the home page - all were fixed text before, now editable per shop.</p>

                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px;">
                    <div class="control-group">
                        <label>PICKS SECTION HEADING</label>
                        <input type="text" id="cfg-home-heading-picks" maxlength="60" value="${escapeHtmlAttr((c.homeHeadings && c.homeHeadings.picks) || "This week's picks")}" />
                    </div>
                    <div class="control-group">
                        <label>ROAST SECTION HEADING</label>
                        <input type="text" id="cfg-home-heading-roast" maxlength="60" value="${escapeHtmlAttr((c.homeHeadings && c.homeHeadings.roast) || "How we roast")}" />
                    </div>
                    <div class="control-group">
                        <label>CONTACT SECTION HEADING</label>
                        <input type="text" id="cfg-home-heading-findus" maxlength="60" value="${escapeHtmlAttr((c.homeHeadings && c.homeHeadings.findUs) || "Find us")}" />
                    </div>
                </div>

                <label style="display:block; font-size:9px; letter-spacing:.14em; color:var(--color-text-muted); text-transform:uppercase; margin-top:18px;">This week's picks</label>
                <p class="admin-help-text">Choose which items feature on the home page and the tag shown on each (e.g. "House favourite"). Leave nothing checked to fall back to the first few items in your top menu section.</p>
                <div id="home-picks-list" style="display:flex; flex-direction:column; gap:6px; max-height:280px; overflow-y:auto; border:1px solid var(--color-border); padding:10px; margin-bottom:10px;"></div>

                <label style="display:block; font-size:9px; letter-spacing:.14em; color:var(--color-text-muted); text-transform:uppercase; margin-top:18px;">Roast process story</label>
                <p class="admin-help-text">The step-by-step "how we roast" story - name and detail line per step, in order. Add up to 6.</p>
                <div id="home-roast-editor" style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;"></div>
                <button type="button" class="admin-btn-secondary" id="home-roast-add" style="margin-bottom:14px;">+ ADD STEP</button>
                <br />
                <button class="admin-btn-primary" id="home-content-save">SAVE HOME PAGE CONTENT</button>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">ADMIN PANEL TEXT</h3>
                <p class="admin-help-text">Font size and color for the admin panel's own sub-tab navigation row (Dashboard / Menu Items / etc.), its small muted helper/description text (like this line), and its form field labels (ACCENT COLOR, STAFF, DATE, etc.) - staff/admin-facing only, not shown to customers.</p>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div class="control-group">
                        <label>TAB NAVIGATION - FONT SIZE (PT)</label>
                        <input type="number" id="brand-admintabs-size" min="5" max="24" step="0.5" value="${(textStyles.adminTabs && textStyles.adminTabs.fontSize) || 9}" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; width:100%; box-sizing:border-box; font-family:inherit;" />
                    </div>
                    <div class="control-group">
                        <label>TAB NAVIGATION - COLOR</label>
                        <input type="color" id="brand-admintabs-color" value="${(textStyles.adminTabs && textStyles.adminTabs.color) || "#888888"}" />
                    </div>
                    <div class="control-group">
                        <label>HELPER TEXT - FONT SIZE (PT)</label>
                        <input type="number" id="brand-adminhelp-size" min="5" max="24" step="0.5" value="${(textStyles.adminHelp && textStyles.adminHelp.fontSize) || 7.5}" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; width:100%; box-sizing:border-box; font-family:inherit;" />
                    </div>
                    <div class="control-group">
                        <label>HELPER TEXT - COLOR</label>
                        <input type="color" id="brand-adminhelp-color" value="${(textStyles.adminHelp && textStyles.adminHelp.color) || "#888888"}" />
                    </div>
                    <div class="control-group">
                        <label>FIELD LABELS - FONT SIZE (PT)</label>
                        <input type="number" id="brand-adminlabels-size" min="5" max="24" step="0.5" value="${(textStyles.adminLabels && textStyles.adminLabels.fontSize) || 8}" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; width:100%; box-sizing:border-box; font-family:inherit;" />
                    </div>
                    <div class="control-group">
                        <label>FIELD LABELS - COLOR</label>
                        <input type="color" id="brand-adminlabels-color" value="${(textStyles.adminLabels && textStyles.adminLabels.color) || "#888888"}" />
                    </div>
                </div>

                <p id="branding-error" style="color:var(--color-danger); font-size:8pt; min-height:12px;"></p>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button class="admin-btn-primary" id="branding-save">SAVE BRANDING</button>
                    <button class="admin-btn-secondary" id="branding-reset">RESET TO DEFAULT</button>
                </div>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">CUSTOM ICONS</h3>
                <p class="admin-help-text">Add your own icon (by image URL) to make it available in the menu item editor, alongside the built-in icon set.</p>
                <div id="custom-icons-list" style="margin-bottom:10px;">
                    ${
                        Object.keys(customIcons).length === 0
                            ? `<p class="admin-help-text">No custom icons added yet.</p>`
                            : Object.entries(customIcons)
                                  .map(
                                      ([key, url]) => `
                                <div style="display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--color-border);">
                                    <img src="${url}" style="width:24px; height:24px; object-fit:contain;" />
                                    <span style="flex:1; font-size:8pt;">${key}</span>
                                    <button class="admin-btn admin-btn-danger" data-remove-icon="${key}">REMOVE</button>
                                </div>
                            `
                                  )
                                  .join("")
                    }
                </div>
                <div style="display:flex; gap:8px;">
                    <input type="text" id="new-icon-key" placeholder="icon name (e.g. pumpkin-spice)" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;" />
                    <input type="text" id="new-icon-url" placeholder="image URL" style="flex:2; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;" />
                    <button class="admin-btn" id="add-custom-icon">ADD</button>
                </div>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">SAVED THEMES (e.g. HOLIDAY PROFILES)</h3>
                <p class="admin-help-text">Save the branding above as a named profile (Diwali, Christmas, etc.) to switch back to instantly later.</p>
                <div id="branding-profiles-list" style="margin-bottom:10px;">
                    ${
                        Object.keys(profiles).length === 0
                            ? `<p class="admin-help-text">No saved profiles yet.</p>`
                            : Object.keys(profiles)
                                  .map(
                                      (name) => `
                                <div style="display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--color-border);">
                                    <span style="flex:1; font-size:8pt;">${name}</span>
                                    <button class="admin-btn" data-activate-profile="${name}">ACTIVATE</button>
                                    <button class="admin-btn admin-btn-danger" data-delete-profile="${name}">DELETE</button>
                                </div>
                            `
                                  )
                                  .join("")
                    }
                </div>
                <div style="display:flex; gap:8px;">
                    <input type="text" id="new-profile-name" placeholder="profile name (e.g. Diwali)" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;" />
                    <button class="admin-btn" id="save-profile">SAVE CURRENT AS PROFILE</button>
                </div>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">STORE DETAILS (HOME PAGE FOOTER)</h3>
                <div class="control-group">
                    <label>TAGLINE</label>
                    <input type="text" id="brand-footer-tagline" value="${(c.footer && c.footer.tagline) || ""}" placeholder="e.g. Hand-brewed since 2024" />
                </div>
                <div class="control-group">
                    <label>ADDRESS</label>
                    <input type="text" id="brand-footer-address" value="${(c.footer && c.footer.address) || ""}" placeholder="Street, City, State, PIN" />
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div class="control-group">
                        <label>PHONE</label>
                        <input type="text" id="brand-footer-phone" value="${(c.footer && c.footer.phone) || ""}" placeholder="+91 ..." />
                    </div>
                    <div class="control-group">
                        <label>EMAIL</label>
                        <input type="text" id="brand-footer-email" value="${(c.footer && c.footer.email) || ""}" placeholder="hello@..." />
                    </div>
                </div>
                <div class="control-group">
                    <label>HOURS</label>
                    <input type="text" id="brand-footer-hours" value="${(c.footer && c.footer.hours) || ""}" placeholder="Mon-Sat: 8am - 8pm" />
                </div>

                <button class="admin-btn-primary" id="branding-save-2">SAVE BRANDING</button>
            </div>
        `;

        const collectColors = () => ({
            accent: document.getElementById("brand-accent").value,
            background: document.getElementById("brand-background").value,
            surface: document.getElementById("brand-surface").value,
            text: document.getElementById("brand-text").value,
            secondary: document.getElementById("brand-secondary").value
        });

        // Choosing a DARK/LIGHT preset fills in that theme's standard colors
        // immediately - CUSTOM leaves whatever's currently in the pickers alone.
        document.getElementById("brand-theme").addEventListener("change", (e) => {
            const preset = THEME_PRESETS[e.target.value];
            if (!preset) return; // "custom" - don't touch the pickers
            document.getElementById("brand-accent").value = preset.accent;
            document.getElementById("brand-background").value = preset.background;
            document.getElementById("brand-surface").value = preset.surface;
            document.getElementById("brand-text").value = preset.text;
            document.getElementById("brand-secondary").value = preset.secondary;
        });

        const homePicksById = Object.fromEntries((c.homePicks || []).map((p) => [p.itemId, p.tag]));
        const pickableItems = this.menu.items.filter((i) => !i.deleted);
        document.getElementById("home-picks-list").innerHTML =
            pickableItems.length === 0
                ? `<p style="color:var(--color-text-muted); font-size:9pt;">No menu items yet.</p>`
                : pickableItems
                      .map((item) => {
                          const checked = homePicksById[item.id] !== undefined;
                          const tag = homePicksById[item.id] || "";
                          return `
                <label style="display:flex; align-items:center; gap:8px; font-size:9pt;">
                    <input type="checkbox" class="home-pick-check" data-item-id="${item.id}" ${checked ? "checked" : ""} />
                    <span style="flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.name}</span>
                    <input type="text" class="home-pick-tag" data-item-id="${item.id}" placeholder="Tag (e.g. House favourite)" value="${tag.replace(/"/g, "&quot;")}" style="flex:0 0 220px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit; font-size:8pt;" ${checked ? "" : "disabled"} />
                </label>
            `;
                      })
                      .join("");
        document.querySelectorAll(".home-pick-check").forEach((cb) => {
            cb.addEventListener("change", () => {
                const tagInput = document.querySelector(`.home-pick-tag[data-item-id="${cb.dataset.itemId}"]`);
                tagInput.disabled = !cb.checked;
            });
        });
        const DEFAULT_ROAST_STEPS = [
            { name: "Sourced", detail: "Small-batch beans, bought direct, one sack at a time." },
            { name: "Drum roast", detail: "Twelve-minute profile, logged to the second." },
            { name: "Rested", detail: "A few days off-gas before the first pour." },
            { name: "Poured", detail: "Ground to order, never before you walk in." }
        ];
        const MAX_ROAST_STEPS = 6;
        const roastEditor = document.getElementById("home-roast-editor");

        function renderRoastEditor(steps) {
            roastEditor.innerHTML = steps
                .map(
                    (step, i) => `
                <div class="roast-step-row" style="display:flex; gap:8px; align-items:center;">
                    <input type="text" class="roast-step-name" placeholder="Step name" maxlength="40" value="${escapeHtmlAttr(step.name || "")}" style="flex:0 0 160px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;" />
                    <input type="text" class="roast-step-detail" placeholder="Detail line" maxlength="160" value="${escapeHtmlAttr(step.detail || "")}" style="flex:1; min-width:0; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:8pt;" />
                    <button type="button" class="roast-step-remove admin-btn-secondary" data-index="${i}" style="flex:none;">&times;</button>
                </div>
            `
                )
                .join("");
            roastEditor.querySelectorAll(".roast-step-remove").forEach((btn) => {
                btn.addEventListener("click", () => {
                    steps.splice(Number(btn.dataset.index), 1);
                    renderRoastEditor(steps);
                });
            });
        }

        const roastSteps = (c.roastSteps && c.roastSteps.length ? c.roastSteps : DEFAULT_ROAST_STEPS).map((s) => ({ ...s }));
        renderRoastEditor(roastSteps);

        document.getElementById("home-roast-add").addEventListener("click", () => {
            if (roastSteps.length >= MAX_ROAST_STEPS) return fail(`Up to ${MAX_ROAST_STEPS} steps`);
            roastSteps.push({ name: "", detail: "" });
            renderRoastEditor(roastSteps);
        });

        document.getElementById("home-content-save").addEventListener("click", async () => {
            const homePicks = Array.from(document.querySelectorAll(".home-pick-check"))
                .filter((cb) => cb.checked)
                .map((cb) => ({
                    itemId: Number(cb.dataset.itemId),
                    tag: document.querySelector(`.home-pick-tag[data-item-id="${cb.dataset.itemId}"]`).value.trim()
                }));
            const finalRoastSteps = Array.from(roastEditor.querySelectorAll(".roast-step-row"))
                .map((row) => ({
                    name: row.querySelector(".roast-step-name").value.trim(),
                    detail: row.querySelector(".roast-step-detail").value.trim()
                }))
                .filter((s) => s.name || s.detail);
            try {
                await AdminConfig.saveSettings({
                    homePicks,
                    roastSteps: finalRoastSteps,
                    homeHeadings: {
                        picks: document.getElementById("cfg-home-heading-picks").value.trim(),
                        roast: document.getElementById("cfg-home-heading-roast").value.trim(),
                        findUs: document.getElementById("cfg-home-heading-findus").value.trim()
                    }
                });
                ok("Home page content saved");
            } catch (e) {
                fail(e.message);
            }
        });

        document.getElementById("brand-hero-pick").addEventListener("click", () => {
            renderImagePickerModal({ onSelect: (url) => (document.getElementById("brand-hero").value = url) });
        });
        document.getElementById("brand-logo-pick").addEventListener("click", () => {
            renderImagePickerModal({ onSelect: (url) => (document.getElementById("brand-logo").value = url) });
        });

        const doSaveBranding = async () => {
            const errorEl = document.getElementById("branding-error");
            errorEl.textContent = "";
            try {
                const updated = await AdminConfig.saveSettings({
                    shopName: document.getElementById("cfg-shop-name").value,
                    heroBadgeText: document.getElementById("cfg-hero-badge").value,
                    heroTagline: document.getElementById("cfg-hero-tagline").value,
                    receiptFooterText: document.getElementById("cfg-receipt-footer").value,
                    theme: document.getElementById("brand-theme").value,
                    heroImageUrl: document.getElementById("brand-hero").value.trim(),
                    logoUrl: document.getElementById("brand-logo").value.trim(),
                    colors: collectColors(),
                    textStyles: {
                        adminTabs: {
                            fontSize: Number(document.getElementById("brand-admintabs-size").value) || 9,
                            color: document.getElementById("brand-admintabs-color").value
                        },
                        adminHelp: {
                            fontSize: Number(document.getElementById("brand-adminhelp-size").value) || 7.5,
                            color: document.getElementById("brand-adminhelp-color").value
                        },
                        adminLabels: {
                            fontSize: Number(document.getElementById("brand-adminlabels-size").value) || 8,
                            color: document.getElementById("brand-adminlabels-color").value
                        }
                    },
                    footer: {
                        tagline: document.getElementById("brand-footer-tagline").value.trim(),
                        address: document.getElementById("brand-footer-address").value.trim(),
                        phone: document.getElementById("brand-footer-phone").value.trim(),
                        email: document.getElementById("brand-footer-email").value.trim(),
                        hours: document.getElementById("brand-footer-hours").value.trim()
                    }
                });
                if (window.applyBranding) window.applyBranding(updated);
                if (window.renderFooter) window.renderFooter(updated);
                ok("Branding saved");
            } catch (e) {
                errorEl.textContent = e.message;
                fail(e.message);
            }
        };
        document.getElementById("branding-save").addEventListener("click", doSaveBranding);
        document.getElementById("branding-save-2").addEventListener("click", doSaveBranding);

        document.getElementById("branding-reset").addEventListener("click", () => {
            renderInfoModal({
                title: "RESET BRANDING",
                message: "Reset theme, colors, hero image, logo, and admin panel text size/color back to the original defaults? Store details (footer) and shop settings are not affected.",
                confirmText: "RESET",
                cancelText: "CANCEL",
                onConfirm: async () => {
                    const res = await fetch("/api/config/reset-branding", { method: "POST", credentials: "include" });
                    const updated = await res.json();
                    if (!res.ok) return fail("Could not reset branding");
                    AdminConfig.settings = updated;
                    if (window.applyBranding) window.applyBranding(updated);
                    await this.renderActiveTab();
                    ok("Branding reset to default");
                }
            });
        });

        document.getElementById("add-custom-icon").addEventListener("click", async () => {
            const key = document.getElementById("new-icon-key").value.trim().toLowerCase().replace(/\s+/g, "-");
            const url = document.getElementById("new-icon-url").value.trim();
            if (!key || !url) return fail("Enter both a name and an image URL");
            try {
                const updated = await AdminConfig.saveSettings({ customIcons: { [key]: url } });
                if (window.applyBranding) window.applyBranding(updated);
                await this.renderActiveTab();
                ok("Icon added");
            } catch (e) {
                fail(e.message);
            }
        });
        root.querySelectorAll("[data-remove-icon]").forEach((btn) =>
            btn.addEventListener("click", async () => {
                const res = await fetch(`/api/config/custom-icons/${encodeURIComponent(btn.dataset.removeIcon)}`, {
                    method: "DELETE",
                    credentials: "include"
                });
                if (res.ok) {
                    const updated = await res.json();
                    AdminConfig.settings = updated;
                    if (window.applyBranding) window.applyBranding(updated);
                    await this.renderActiveTab();
                    ok("Icon removed");
                }
            })
        );

        document.getElementById("save-profile").addEventListener("click", async () => {
            const name = document.getElementById("new-profile-name").value.trim();
            if (!name) return fail("Enter a profile name");
            // Save whatever is currently in the color pickers, not just what's
            // already persisted - so you can tweak then save in one step.
            await doSaveBranding();
            const res = await fetch("/api/branding-profiles", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name })
            });
            if (res.ok) {
                await this.renderActiveTab();
                ok(`Saved profile "${name}"`);
            } else {
                fail("Could not save profile");
            }
        });
        root.querySelectorAll("[data-activate-profile]").forEach((btn) =>
            btn.addEventListener("click", async () => {
                const res = await fetch(`/api/branding-profiles/${encodeURIComponent(btn.dataset.activateProfile)}/activate`, {
                    method: "POST",
                    credentials: "include"
                });
                if (res.ok) {
                    const updated = await res.json();
                    AdminConfig.settings = updated;
                    if (window.applyBranding) window.applyBranding(updated);
                    if (window.renderFooter) window.renderFooter(updated);
                    await this.renderActiveTab();
                    ok(`Activated "${btn.dataset.activateProfile}"`);
                }
            })
        );
        root.querySelectorAll("[data-delete-profile]").forEach((btn) =>
            btn.addEventListener("click", async () => {
                const res = await fetch(`/api/branding-profiles/${encodeURIComponent(btn.dataset.deleteProfile)}`, {
                    method: "DELETE",
                    credentials: "include"
                });
                if (res.ok) {
                    await this.renderActiveTab();
                    ok("Profile deleted");
                }
            })
        );
    },

    async logout() {
        await AuthSystem.logout();
        if (window.showPage) window.showPage("home");
    }
};

// Ensure the portal is accessible globally for the HTML "LOGOUT" button
window.AdminPortal = AdminPortal;
