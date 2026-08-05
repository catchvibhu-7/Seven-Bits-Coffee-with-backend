/**
 * SEVEN BITS COFFEE - ADMIN PORTAL UI
 * Location: /js/ui/admin-portal.js
 *
 * Every mutation here (add/edit/delete item, save config) calls server.js,
 * which re-checks the admin session cookie itself - so even if someone
 * bypasses these buttons and calls fetch() by hand, they still need a valid
 * login.
 */
import { AdminConfig } from "../features/config-logic.js";
import { SecuritySystem } from "../features/auth-logic.js";

export const AdminPortal = {
    menu: { sections: [], items: [] },

    async init() {
        await this.loadMenu();
        await this.loadSettings();
        await this.renderAnalytics();
        this.renderAdminMenu();
    },

    async loadMenu() {
        const res = await fetch("/api/menu");
        this.menu = await res.json();
    },

    async loadSettings() {
        const config = await AdminConfig.loadSettings();
        const tipToggle = document.getElementById("tip-toggle");
        const shopInput = document.getElementById("shop-name-input");

        if (tipToggle) tipToggle.checked = config.tipEnabled;
        if (shopInput) shopInput.value = config.shopName;
    },

    async renderAnalytics() {
        const salesRoot = document.getElementById("admin-sales-root");
        if (!salesRoot) return;

        const res = await fetch("/api/orders", { credentials: "include" });
        const orders = res.ok ? await res.json() : [];

        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((acc, order) => acc + (order.total || 0), 0);

        salesRoot.innerHTML = `
            <div class="stats-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="stat-card" style="border: 1px solid #d97706; padding: 10px;">
                    <div style="font-size: 8pt; color: #888;">TOTAL_ORDERS</div>
                    <div style="font-size: 18pt; color: #d97706;">${totalOrders}</div>
                </div>
                <div class="stat-card" style="border: 1px solid #d97706; padding: 10px;">
                    <div style="font-size: 8pt; color: #888;">REVENUE_BITS</div>
                    <div style="font-size: 18pt; color: #d97706;">\u20b9${totalRevenue.toFixed(2)}</div>
                </div>
            </div>
        `;
    },

    renderAdminMenu() {
        const container = document.getElementById("admin-menu-list");
        if (!container) return;

        container.innerHTML = `
            <div style="display:flex; justify-content: space-between; align-items:center; margin-top: 20px;">
                <button onclick="AdminPortal.addItem()" style="background:#d97706; color:#000; border:none; padding:8px 14px; font-weight:bold; cursor:pointer;">+ ADD ITEM</button>
                <button onclick="AdminPortal.logout()" style="background:#333; color:#fff; border:none; padding:8px 14px; cursor:pointer;">LOGOUT</button>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 15px;">
                <thead style="color: #d97706;">
                    <tr>
                        <th align="left">ID</th>
                        <th align="left">NAME</th>
                        <th align="left">PRICE</th>
                        <th align="right">ACTION</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.menu.items
                        .map(
                            (item) => `
                        <tr style="border-bottom: 1px solid #222;">
                            <td>${item.id}</td>
                            <td>${item.name}</td>
                            <td>\u20b9${item.price}</td>
                            <td align="right">
                                <button onclick="AdminPortal.editPrice(${item.id})">EDIT</button>
                                <button onclick="AdminPortal.deleteItem(${item.id})" style="color: red;">X</button>
                            </td>
                        </tr>
                    `
                        )
                        .join("")}
                </tbody>
            </table>
        `;
    },

    async updateGlobalConfig() {
        const newName = document.getElementById("shop-name-input").value;
        const isTipEnabled = document.getElementById("tip-toggle").checked;

        try {
            await AdminConfig.saveSettings({ shopName: newName, tipEnabled: isTipEnabled });
        } catch (e) {
            alert(e.message);
        }
    },

    async addItem() {
        const name = prompt("New item name:");
        if (!name) return;
        const price = prompt(`Price for "${name}" (\u20b9):`);
        if (!price || isNaN(price) || Number(price) <= 0) return alert("Invalid price.");
        const section = prompt(`Section id (one of: ${this.menu.sections.map((s) => s.id).join(", ")}):`);
        if (!this.menu.sections.some((s) => s.id === section)) return alert("Unknown section id.");

        const res = await fetch("/api/menu", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, price: Number(price), section })
        });
        const data = await res.json();
        if (!res.ok) return alert(data.error || "Could not add item");
        await this.loadMenu();
        this.renderAdminMenu();
    },

    async editPrice(id) {
        const item = this.menu.items.find((i) => i.id === id);
        const newPrice = prompt(`Enter new price for ${item.name}:`, item.price);
        if (!newPrice || isNaN(newPrice) || Number(newPrice) <= 0) return;

        const res = await fetch(`/api/menu/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ price: Number(newPrice) })
        });
        if (res.ok) {
            await this.loadMenu();
            this.renderAdminMenu();
        }
    },

    async deleteItem(id) {
        if (!confirm(`Confirm permanent deletion of Bit ${id}?`)) return;
        const res = await fetch(`/api/menu/${id}`, { method: "DELETE", credentials: "include" });
        if (res.ok) {
            await this.loadMenu();
            this.renderAdminMenu();
        }
    },

    async logout() {
        await SecuritySystem.logout();
        if (window.showPage) window.showPage("home");
    }
};

// Ensure the portal is accessible globally for the HTML buttons
window.AdminPortal = AdminPortal;
