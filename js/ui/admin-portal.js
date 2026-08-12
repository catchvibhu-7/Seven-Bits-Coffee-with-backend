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
import { renderAddStaffModal } from "./staff-modal.js";
import { renderInfoModal } from "./info-modal.js";
import { renderItemModal } from "./item-modal.js";
import { renderAccountSettingsModal } from "./account-settings-modal.js";

const TABS = [
    { id: "global", label: "Global Settings" },
    { id: "menu", label: "Menu Items" },
    { id: "orders", label: "Order History" },
    { id: "staff", label: "User Management" },
    { id: "branding", label: "Branding" }
];

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

export const AdminPortal = {
    menu: { sections: [], items: [] },
    session: { role: null },
    activeTab: "global",

    async init() {
        await this.loadMenu();
        await AdminConfig.loadSettings();
        this.session = await AuthSystem.getSession();
        this.renderTabs();
        await this.renderActiveTab();
    },

    async loadMenu() {
        const res = await fetch("/api/menu");
        this.menu = await res.json();
    },

    renderTabs() {
        const root = document.getElementById("admin-tabs");
        if (!root) return;
        root.innerHTML = TABS.map(
            (t) => `<button class="admin-tab-btn ${t.id === this.activeTab ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
        ).join("");
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
        if (this.activeTab === "global") return this.renderGlobalSettings(root);
        if (this.activeTab === "menu") return this.renderMenuItems(root);
        if (this.activeTab === "orders") return this.renderOrderHistory(root);
        if (this.activeTab === "staff") return this.renderStaffManagement(root);
        if (this.activeTab === "branding") return this.renderBranding(root);
    },

    // ---------------------------------------------------------------- GLOBAL
    async renderGlobalSettings(root) {
        const res = await fetch("/api/orders", { credentials: "include" });
        const orders = res.ok ? await res.json() : [];
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((acc, order) => acc + (order.total || 0), 0);
        const c = AdminConfig.settings;

        root.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">TOTAL_ORDERS</div>
                    <div class="stat-value">${totalOrders}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">REVENUE_BITS</div>
                    <div class="stat-value">\u20b9${totalRevenue.toFixed(2)}</div>
                </div>
            </div>

            <div class="config-controls">
                <div class="control-group">
                    <label>SHOP NAME</label>
                    <input type="text" id="cfg-shop-name" value="${c.shopName || ""}" />
                </div>
                <div class="control-group" style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="cfg-tip-enabled" ${c.tipEnabled ? "checked" : ""} style="width:auto;" />
                    <label style="margin:0;" for="cfg-tip-enabled">ENABLE GINGER TIP</label>
                </div>
                <div class="control-group">
                    <label>TIP AMOUNT (\u20b9)</label>
                    <input type="text" id="cfg-tip-amount" value="${c.tipAmount ?? 0}" />
                </div>
                <div class="control-group">
                    <label>CGST RATE (%)</label>
                    <input type="text" id="cfg-cgst" value="${(c.cgstRate * 100).toFixed(2)}" />
                </div>
                <div class="control-group">
                    <label>SGST RATE (%)</label>
                    <input type="text" id="cfg-sgst" value="${(c.sgstRate * 100).toFixed(2)}" />
                </div>
                <div class="control-group">
                    <label>SERVICE CHARGE RATE (%)</label>
                    <input type="text" id="cfg-service-charge" value="${(c.serviceChargeRate * 100).toFixed(2)}" />
                </div>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">PAYMENT SETTINGS</h3>
                <div class="control-group">
                    <label>UPI ID (VPA) - shown as a QR code for "Pay Online" orders. Leave blank to disable online payment and show "pay at counter" instead.</label>
                    <input type="text" id="cfg-upi-vpa" value="${c.upiVpa || ""}" placeholder="yourshop@upi" />
                </div>
                <div class="control-group">
                    <label>PAYEE NAME (shown to the customer in their UPI app)</label>
                    <input type="text" id="cfg-upi-payee-name" value="${c.upiPayeeName || ""}" placeholder="${c.shopName || "Your Shop"}" />
                </div>

                <p id="global-settings-error" style="color:var(--color-danger); font-size:8pt; min-height:12px;"></p>
                <button class="admin-btn-primary" id="cfg-save">SAVE SETTINGS</button>
            </div>
        `;

        document.getElementById("cfg-save").addEventListener("click", async () => {
            const errorEl = document.getElementById("global-settings-error");
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
                    shopName: document.getElementById("cfg-shop-name").value,
                    tipEnabled: document.getElementById("cfg-tip-enabled").checked,
                    tipAmount,
                    cgstRate: cgst,
                    sgstRate: sgst,
                    serviceChargeRate: serviceCharge,
                    upiVpa: document.getElementById("cfg-upi-vpa").value.trim(),
                    upiPayeeName: document.getElementById("cfg-upi-payee-name").value.trim()
                });
                ok("Settings saved");
            } catch (e) {
                errorEl.textContent = e.message;
                fail(e.message);
            }
        });
    },

    // ------------------------------------------------------------ MENU ITEMS
    renderMenuItems(root) {
        const sectionById = Object.fromEntries(this.menu.sections.map((s) => [s.id, s.title]));
        const customIcons = AdminConfig.settings.customIcons || {};

        root.innerHTML = `
            <div class="admin-toolbar">
                <button class="admin-btn-primary" id="menu-add-item">+ ADD ITEM</button>
            </div>
            <table class="admin-table">
                <thead>
                    <tr><th>ICON</th><th>NAME</th><th>SECTION</th><th>PRICE</th><th style="text-align:right;">ACTION</th></tr>
                </thead>
                <tbody>
                    ${this.menu.items
                        .map(
                            (item) => `
                        <tr>
                            <td>${
                                customIcons[item.icon]
                                    ? `<img src="${customIcons[item.icon]}" style="width:22px; height:22px; object-fit:contain;" />`
                                    : `<span class="icon icon-${item.icon}" style="display:inline-block; width:22px; height:22px;"></span>`
                            }</td>
                            <td>${item.name}</td>
                            <td style="color: var(--color-text-muted); font-size: 8pt;">${sectionById[item.section] || item.section}</td>
                            <td>\u20b9${item.price}</td>
                            <td style="text-align:right;">
                                <button class="admin-btn" data-edit="${item.id}">EDIT</button>
                                <button class="admin-btn admin-btn-danger" data-delete="${item.id}">DELETE</button>
                            </td>
                        </tr>
                    `
                        )
                        .join("")}
                </tbody>
            </table>
        `;

        document.getElementById("menu-add-item").addEventListener("click", () => this.openItemModal(null));
        root.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => this.openItemModal(Number(btn.dataset.edit))));
        root.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => this.deleteItem(Number(btn.dataset.delete))));
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
            message: "Confirm permanent deletion of this menu item?",
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

    // ------------------------------------------------------------ ORDER HISTORY
    orderHistorySort: "newest",
    orderHistoryFilter: "all",

    async renderOrderHistory(root) {
        const res = await fetch("/api/orders", { credentials: "include" });
        const orders = res.ok ? await res.json() : [];

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
            <div id="order-history-grid" class="order-history-grid"></div>
        `;

        const renderGrid = () => {
            const gridRoot = document.getElementById("order-history-grid");
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

            if (filtered.length === 0) {
                gridRoot.innerHTML = `<p style="color:var(--color-text-muted); font-size:9pt;">No orders match this filter.</p>`;
                return;
            }

            gridRoot.innerHTML = filtered
                .map((o) => {
                    const complete = o.items.every((i) => i.isDone);
                    return `
                    <div class="order-history-card">
                        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                            <strong>#${o.id}</strong>
                            <span style="color:${complete ? "var(--color-success)" : "var(--color-cyan)"};">${complete ? "COMPLETED" : "ACTIVE"}</span>
                        </div>
                        <div style="font-size:7pt; color:var(--color-text-muted); margin-bottom:6px;">${new Date(o.createdAt).toLocaleString()} \u00b7 ${o.method}</div>
                        <div style="font-size:8pt; color:var(--color-text-muted); margin-bottom:8px;">${o.items.map((i) => `${i.quantity}x ${i.name}`).join(", ")}</div>
                        <div style="display:flex; justify-content:space-between; font-size:9pt; border-top:1px solid var(--color-border); padding-top:6px;">
                            <span>${o.isPaid ? "\u2713 Paid" : "Unpaid"}</span>
                            <strong>\u20b9${o.total.toFixed(2)}</strong>
                        </div>
                    </div>
                `;
                })
                .join("");
        };

        renderGrid();

        root.querySelectorAll("[data-history-filter]").forEach((btn) => {
            btn.addEventListener("click", () => {
                this.orderHistoryFilter = btn.dataset.historyFilter;
                root.querySelectorAll("[data-history-filter]").forEach((b) => b.classList.toggle("active", b === btn));
                renderGrid();
            });
        });
        document.getElementById("order-history-sort").addEventListener("change", (e) => {
            this.orderHistorySort = e.target.value;
            renderGrid();
        });
    },

    // ------------------------------------------------------------ STAFF
    async renderStaffManagement(root) {
        const res = await fetch("/api/users", { credentials: "include" });
        const staff = res.ok ? await res.json() : [];
        const isOwner = this.session.role === "owner";
        const myUserId = this.session.userId;

        let auditLogHtml = "";
        if (isOwner) {
            const auditRes = await fetch("/api/audit-log", { credentials: "include" });
            const log = auditRes.ok ? await auditRes.json() : [];
            auditLogHtml = `
                <h3 style="margin-top:30px; border-top:1px solid var(--color-border); padding-top:20px;">ACCOUNT ACTIVITY LOG</h3>
                <p style="font-size:7pt; color:var(--color-text-muted); margin-bottom:10px;">Password resets and account removals performed by admins/owner - visible only to the owner.</p>
                ${
                    log.length === 0
                        ? `<p style="font-size:8pt; color:var(--color-text-muted);">No activity recorded yet.</p>`
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
                                <td style="font-size:8pt;">${e.action === "reset_password" ? "Reset password" : "Removed account"}</td>
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
                    <tr><th>USERNAME</th><th>NAME</th><th>ROLE</th><th style="text-align:right;">ACTION</th></tr>
                </thead>
                <tbody>
                    ${staff
                        .map((u) => {
                            const isSelf = u.id === myUserId;
                            const canManage = !isSelf && (isOwner || (this.session.role === "admin" && u.role === "employee"));
                            return `
                        <tr>
                            <td>${u.username}${isSelf ? ' <span style="color:var(--color-text-muted); font-size:7pt;">(you)</span>' : ""}</td>
                            <td>${u.name}</td>
                            <td style="color: var(--color-accent);">${u.role.toUpperCase()}</td>
                            <td style="text-align:right;">
                                ${
                                    canManage
                                        ? `
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
            <p style="font-size: 7pt; color: var(--color-text-muted); margin-top: 10px;">
                ${isOwner ? "You can create and manage employee, admin, and owner accounts." : "You can create and manage employee accounts. Only the owner can manage admin/owner accounts."}
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

        root.querySelectorAll("[data-reset]").forEach((btn) =>
            btn.addEventListener("click", () => this.resetStaffPassword(Number(btn.dataset.reset), btn.dataset.name))
        );
        root.querySelectorAll("[data-remove]").forEach((btn) =>
            btn.addEventListener("click", () => this.removeStaff(Number(btn.dataset.remove), btn.dataset.name))
        );
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
        const customIcons = c.customIcons || {};
        const profilesRes = await fetch("/api/branding-profiles", { credentials: "include" });
        const profiles = profilesRes.ok ? await profilesRes.json() : {};

        root.innerHTML = `
            <div class="config-controls">
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
                    <label>HERO IMAGE URL (shown on the home page - leave blank to keep the default icon)</label>
                    <input type="text" id="brand-hero" value="${c.heroImageUrl || ""}" placeholder="https://..." />
                </div>
                <div class="control-group">
                    <label>LOGO URL (shown in the top nav - leave blank to hide)</label>
                    <input type="text" id="brand-logo" value="${c.logoUrl || ""}" placeholder="https://..." />
                </div>
                <p style="font-size:7pt; color:var(--color-text-muted);">Images are linked by URL (hosted elsewhere) rather than uploaded here.</p>

                <p id="branding-error" style="color:var(--color-danger); font-size:8pt; min-height:12px;"></p>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button class="admin-btn-primary" id="branding-save">SAVE BRANDING</button>
                    <button class="admin-btn-secondary" id="branding-reset">RESET TO DEFAULT</button>
                </div>

                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">CUSTOM ICONS</h3>
                <p style="font-size:7pt; color:var(--color-text-muted);">Add your own icon (by image URL) to make it available in the menu item editor, alongside the built-in icon set.</p>
                <div id="custom-icons-list" style="margin-bottom:10px;">
                    ${
                        Object.keys(customIcons).length === 0
                            ? `<p style="font-size:8pt; color:var(--color-text-muted);">No custom icons added yet.</p>`
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
                <p style="font-size:7pt; color:var(--color-text-muted);">Save the branding above as a named profile (Diwali, Christmas, etc.) to switch back to instantly later.</p>
                <div id="branding-profiles-list" style="margin-bottom:10px;">
                    ${
                        Object.keys(profiles).length === 0
                            ? `<p style="font-size:8pt; color:var(--color-text-muted);">No saved profiles yet.</p>`
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

        const doSaveBranding = async () => {
            const errorEl = document.getElementById("branding-error");
            errorEl.textContent = "";
            try {
                const updated = await AdminConfig.saveSettings({
                    theme: document.getElementById("brand-theme").value,
                    heroImageUrl: document.getElementById("brand-hero").value.trim(),
                    logoUrl: document.getElementById("brand-logo").value.trim(),
                    colors: collectColors(),
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
                message: "Reset theme, colors, hero image, and logo back to the original defaults? Store details (footer) and shop settings are not affected.",
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
