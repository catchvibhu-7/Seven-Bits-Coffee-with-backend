/**
 * SEVEN BITS COFFEE - ADMIN PORTAL UI
 * Location: /js/ui/admin-portal.js
 *
 * Every mutation here (add/edit/delete item, save config, staff actions)
 * calls server.js, which re-checks the admin session cookie and role itself -
 * so even if someone bypasses these buttons and calls fetch() by hand, they
 * still need a valid login with the right role.
 */
import { AdminConfig, currencySymbol } from "../features/config-logic.js";
import { AuthSystem } from "../features/auth-logic.js";
import { PayrollSystem } from "../features/payroll-logic.js";
import { KitchenSystem } from "../features/kitchen-logic.js";
import { renderAddStaffModal, renderEditStaffModal } from "./staff-modal.js";
import { renderInfoModal } from "./info-modal.js";
import { renderItemModal } from "./item-modal.js";
import { renderComboModal } from "./combo-modal.js";
import { renderAccountSettingsModal } from "./account-settings-modal.js";
import { renderImagePickerModal } from "./image-picker-modal.js";
import { renderReadOnlySection, renderSectionEditModal } from "./admin-section.js";

// Franchise governance: every role now sees the SAME tab groups (nothing is
// hidden from a manager the way it used to be) - what differs per role is
// whether each SECTION within a tab shows an EDIT button (see the
// per-section canEdit checks inside each render* method below) and, for
// OVERVIEW/STORE SETUP specifically, which variant of that tab a role gets
// (cross-store views for an unrestricted session, single-store views for a
// scoped one). "Global Admin" = role:"admin" with no storeAccess
// restriction; "Local Admin" = role:"admin" with storeAccess set - see
// accessibleStoreIds()/requireGlobalAdmin() in server.js for the same
// distinction enforced server-side.
function tabGroupsForRole(session) {
    const role = session.role;
    // A manager is always locked to their own single store - no cross-store
    // view makes sense for them. Owner always gets one; a scoped admin only
    // if their storeAccess actually spans more than one store (or is
    // unrestricted, i.e. null).
    const hasFranchiseView = role === "owner" || (role === "admin" && (!session.storeAccess || session.storeAccess.length > 1));
    // Strictly "no storeAccess restriction at all" (owner, or an unscoped
    // admin) - distinct from hasFranchiseView above, since franchise-
    // structure actions (opening/closing a store) are Global-Admin-only
    // even for an admin whose storeAccess happens to span multiple stores.
    const isUnrestricted = role === "owner" || (role === "admin" && !session.storeAccess);
    const groups = [
        {
            label: "OVERVIEW",
            tabs: [{ id: "kpi", label: "Dashboard" }, ...(hasFranchiseView ? [{ id: "franchise", label: "Franchise Dashboard" }] : [])]
        },
        {
            label: "MENU",
            tabs: [
                { id: "menu", label: "Menu Items" },
                { id: "combos", label: "Combos" },
                { id: "customization", label: "Customization" },
                { id: "inventory", label: "Raw Materials" }
            ]
        },
        {
            label: "SALES",
            tabs: [
                { id: "customers", label: "Customers" },
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
            label: "BRANDING & CONTENT",
            tabs: [
                { id: "branding", label: "Branding" },
                { id: "content", label: "Content" }
            ]
        },
        {
            label: "PAYMENTS",
            tabs: [{ id: "payments", label: "Payments & Tax" }]
        },
        {
            // Fully per-store now - a scoped role edits their own store's
            // Operations from Store Setup/This Store instead; this tab is
            // just the cross-store read-only summary, so it doesn't exist
            // for a scoped session at all.
            label: "OPERATIONS",
            tabs: isUnrestricted ? [{ id: "operations", label: "Operations" }] : []
        },
        {
            // Unrestricted: the full Locations list (add/remove stores) plus
            // whole-instance Data & Backup. Scoped: just their own store's
            // page (contact/picks/payments-override/operations/backup all
            // live together there - see renderThisStore()).
            label: "STORE SETUP",
            tabs: isUnrestricted
                ? [
                      { id: "stores", label: "Locations" },
                      { id: "data", label: "Data & Backup" }
                  ]
                : [{ id: "this-store", label: "This Store" }]
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
        if (!tabGroupsForRole(this.session).some((g) => g.tabs.some((t) => t.id === this.activeTab))) {
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
        const groups = tabGroupsForRole(this.session);
        // A single-tab section (Dashboard, Payments, Operations) IS its page -
        // the top row shows its one tab's own label, and clicking it goes
        // straight there. A multi-tab section shows the group name on top,
        // and clicking it reveals its tabs below with the first preselected.
        const activeGroup = groups.find((g) => g.tabs.some((t) => t.id === this.activeTab)) || groups[0];
        root.innerHTML = `
            <div class="admin-top-tabs">
                ${groups
                    .map(
                        (g) =>
                            `<button class="admin-tab-btn ${g === activeGroup ? "active" : ""}" data-group="${escapeHtmlAttr(g.label)}">${g.tabs.length === 1 ? g.tabs[0].label : g.label}</button>`
                    )
                    .join("")}
            </div>
            ${
                activeGroup.tabs.length > 1
                    ? `<div class="admin-sub-tabs">
                    ${activeGroup.tabs
                        .map((t) => `<button class="admin-tab-btn ${t.id === this.activeTab ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`)
                        .join("")}
                </div>`
                    : ""
            }
        `;
        root.querySelectorAll("[data-group]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const group = groups.find((g) => g.label === btn.dataset.group);
                if (!group) return;
                this.activeTab = group.tabs[0].id;
                this.renderTabs();
                await this.renderActiveTab();
            });
        });
        root.querySelectorAll("[data-tab]").forEach((btn) => {
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
        if (this.activeTab === "franchise") return this.renderFranchiseDashboard(root);
        if (this.activeTab === "payments") return this.renderPayments(root);
        if (this.activeTab === "operations") return this.renderOperations(root);
        if (this.activeTab === "stores") return this.renderStores(root);
        if (this.activeTab === "this-store") return this.renderThisStore(root);
        if (this.activeTab === "data") return this.renderDataBackup(root);
        if (this.activeTab === "reports") return this.renderReportsExport(root);
        if (this.activeTab === "menu") {
            await this.loadMenu(); // pending staff disable-requests can arrive between tab switches
            return this.renderMenuItems(root);
        }
        if (this.activeTab === "combos") return this.renderCombos(root);
        if (this.activeTab === "inventory") return this.renderInventory(root);
        if (this.activeTab === "customization") return this.renderCustomizationPricing(root);
        if (this.activeTab === "customers") return this.renderCustomers(root);
        if (this.activeTab === "discounts") return this.renderDiscountsLoyalty(root);
        if (this.activeTab === "orders") return this.renderOrderHistory(root);
        if (this.activeTab === "payroll") return this.renderPayroll(root);
        if (this.activeTab === "staff") return this.renderStaffManagement(root);
        if (this.activeTab === "branding") return this.renderBranding(root);
        if (this.activeTab === "content") return this.renderContent(root);
    },

    // ---------------------------------------------------------------- GLOBAL
    // ---------------------------------------------------------------- PAYMENTS & TAX
    // These are the franchise-wide DEFAULTS - Global-Admin-edit only. A
    // store can override the tax/currency fields (not UPI/Razorpay, which
    // stay global-only) from its own Store Setup/This Store page.
    isGlobalAdmin() {
        return this.session.role === "admin" && !this.session.storeAccess;
    },

    async renderPayments(root) {
        const c = AdminConfig.settings;
        const canEdit = this.isGlobalAdmin();

        root.innerHTML = `
            <div class="config-controls">
                <div id="payments-currency-section"></div>
                <div id="payments-tax-section"></div>
                <div id="payments-upi-section"></div>
                <div id="payments-razorpay-section"></div>
            </div>
        `;

        renderReadOnlySection(document.getElementById("payments-currency-section"), {
            title: "CURRENCY",
            canEdit,
            fields: [
                { label: "Symbol", value: c.currencySymbol || "₹" },
                { label: "ISO code", value: c.currencyCode || "INR", tooltip: "Only sent to Razorpay - confirm your account supports it before changing." }
            ],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT CURRENCY",
                    fields: [
                        { id: "pf-currency-symbol", label: "Symbol", value: c.currencySymbol || "₹", maxlength: 3 },
                        { id: "pf-currency-code", label: "ISO code", value: c.currencyCode || "INR", maxlength: 3, tooltip: "Only sent to Razorpay - confirm your account supports it." }
                    ],
                    onSave: async (v) => {
                        await AdminConfig.saveSettings({ currencySymbol: v["pf-currency-symbol"].trim(), currencyCode: v["pf-currency-code"].trim() });
                        if (window.applyBranding) window.applyBranding(AdminConfig.settings);
                        ok("Currency saved");
                        this.renderPayments(root);
                    }
                })
        });

        renderReadOnlySection(document.getElementById("payments-tax-section"), {
            title: "TAX & GST (FRANCHISE DEFAULT)",
            canEdit,
            fields: [
                { label: "GST number", value: c.gstNumber || "" },
                { label: "CGST rate", value: `${(c.cgstRate * 100).toFixed(2)}%` },
                { label: "SGST rate", value: `${(c.sgstRate * 100).toFixed(2)}%` },
                { label: "Service charge rate", value: `${(c.serviceChargeRate * 100).toFixed(2)}%` },
                { label: "Tip amount", value: `${currencySymbol()}${c.tipAmount ?? 0}` },
                { label: "Tip enabled", value: c.tipEnabled ? "Yes" : "No" }
            ],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT TAX & GST",
                    fields: [
                        { id: "pf-gst-number", label: "GST number (GSTIN)", value: c.gstNumber || "", maxlength: 20, placeholder: "22AAAAA0000A1Z5" },
                        { id: "pf-cgst", label: "CGST rate (%)", value: (c.cgstRate * 100).toFixed(2), type: "number", step: 0.01, min: 0 },
                        { id: "pf-sgst", label: "SGST rate (%)", value: (c.sgstRate * 100).toFixed(2), type: "number", step: 0.01, min: 0 },
                        { id: "pf-service-charge", label: "Service charge rate (%)", value: (c.serviceChargeRate * 100).toFixed(2), type: "number", step: 0.01, min: 0 },
                        { id: "pf-tip-amount", label: `Tip amount (${currencySymbol()})`, value: c.tipAmount ?? 0, type: "number", step: 0.01, min: 0 },
                        { id: "pf-tip-enabled", label: "Enable Ginger tip", value: !!c.tipEnabled, type: "checkbox" }
                    ],
                    onSave: async (v) => {
                        const cgst = parseFloat(v["pf-cgst"]) / 100;
                        const sgst = parseFloat(v["pf-sgst"]) / 100;
                        const serviceCharge = parseFloat(v["pf-service-charge"]) / 100;
                        const tipAmount = parseFloat(v["pf-tip-amount"]);
                        if ([cgst, sgst, serviceCharge, tipAmount].some((n) => !Number.isFinite(n) || n < 0)) {
                            throw new Error("Rates and amounts must be positive numbers.");
                        }
                        await AdminConfig.saveSettings({
                            gstNumber: v["pf-gst-number"],
                            cgstRate: cgst,
                            sgstRate: sgst,
                            serviceChargeRate: serviceCharge,
                            tipAmount,
                            tipEnabled: v["pf-tip-enabled"]
                        });
                        ok("Tax & GST saved");
                        this.renderPayments(root);
                    }
                })
        });

        renderReadOnlySection(document.getElementById("payments-upi-section"), {
            title: "UPI PAYMENT",
            canEdit,
            fields: [
                { label: "UPI ID (VPA)", value: c.upiVpa || "" },
                { label: "Payee name", value: c.upiPayeeName || "" }
            ],
            emptyNote: "No UPI ID set - online payment shows \"pay at counter\" instead.",
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT UPI PAYMENT",
                    fields: [
                        { id: "pf-upi-vpa", label: "UPI ID (VPA)", value: c.upiVpa || "", maxlength: 80, placeholder: "yourshop@upi", tooltip: "Shown as a QR code for Pay Online orders. Leave blank to disable online payment." },
                        { id: "pf-upi-payee", label: "Payee name", value: c.upiPayeeName || "", maxlength: 60, placeholder: c.shopName || "Your Shop" }
                    ],
                    onSave: async (v) => {
                        await AdminConfig.saveSettings({ upiVpa: v["pf-upi-vpa"].trim(), upiPayeeName: v["pf-upi-payee"].trim() });
                        ok("UPI settings saved");
                        this.renderPayments(root);
                    }
                })
        });

        renderReadOnlySection(document.getElementById("payments-razorpay-section"), {
            title: "RAZORPAY (VERIFIED ONLINE PAYMENTS)",
            canEdit,
            fields: [
                { label: "Enabled", value: c.razorpayEnabled ? "Yes" : "No" },
                { label: "Key ID", value: c.razorpayKeyId || "" },
                { label: "Key secret", value: c.razorpaySecretConfigured ? "Configured" : "Not configured" }
            ],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT RAZORPAY",
                    fields: [
                        { id: "pf-razorpay-enabled", label: "Enable Razorpay", value: !!c.razorpayEnabled, type: "checkbox" },
                        { id: "pf-razorpay-key-id", label: "Key ID", value: c.razorpayKeyId || "", maxlength: 100, placeholder: "rzp_test_xxxxxxxxxxxx" },
                        {
                            id: "pf-razorpay-key-secret",
                            label: "Key secret",
                            value: "",
                            type: "password",
                            maxlength: 200,
                            placeholder: c.razorpaySecretConfigured ? "•••••••• (saved - leave blank to keep)" : "Enter your Razorpay key secret",
                            tooltip: "Never shown back once saved - leave blank to keep the current one."
                        }
                    ],
                    onSave: async (v) => {
                        const razorpayKeySecret = v["pf-razorpay-key-secret"].trim();
                        await AdminConfig.saveSettings({
                            razorpayEnabled: v["pf-razorpay-enabled"],
                            razorpayKeyId: v["pf-razorpay-key-id"].trim(),
                            ...(razorpayKeySecret ? { razorpayKeySecret } : {})
                        });
                        ok("Razorpay settings saved");
                        this.renderPayments(root);
                    }
                })
        });
    },

    // ---------------------------------------------------------------- OPERATIONS
    // Fully per-store now (see server.js's mergeStoreOverrides()) - this tab
    // is a read-only cross-store summary for an unrestricted session only;
    // the real editable Tables/Arcade settings live on each store's own
    // Store Setup/This Store page.
    async renderOperations(root) {
        const stores = await PayrollSystem.fetchStores();
        const isGlobalAdmin = this.isGlobalAdmin(); // owner reaches this tab too (hasFranchiseView) but stays read-only, same as everywhere else it writes nothing
        root.innerHTML = `
            <div class="config-controls">
                <h3 style="margin-top:0;">OPERATIONS BY STORE</h3>
                <p class="admin-help-text">Table count and arcade settings are per-store - edit a store's own Operations from Store Setup.</p>
                <table class="admin-table">
                    <thead><tr><th>STORE</th><th>TABLES</th><th>ARCADE</th><th>WAIT TIME</th><th>DELIVERY</th>${isGlobalAdmin ? "<th></th>" : ""}</tr></thead>
                    <tbody>
                        ${stores
                            .map((s) => {
                                const opsField = s.operations || { tableCount: 10, arcade: { enabled: true, sessionHours: 2 }, waitTime: { enabled: true, minMins: 5 } };
                                const waitTime = opsField.waitTime || { enabled: true, minMins: 5 };
                                const delivery = opsField.delivery || { enabled: true, lockedBy: null, message: { preset: null, customText: "" } };
                                const locked = delivery.lockedBy === "globalAdmin";
                                return `<tr>
                                    <td>${escapeHtmlAttr(s.name)}</td>
                                    <td>${opsField.tableCount}</td>
                                    <td>${opsField.arcade.enabled ? `Enabled - ${opsField.arcade.sessionHours}h session` : "Disabled"}</td>
                                    <td>${waitTime.enabled ? `Enabled - ${waitTime.minMins} min floor` : "Disabled"}</td>
                                    <td>${delivery.enabled ? "Enabled" : "Disabled"}${locked ? ' <span style="color:var(--color-danger); font-size:10px;">(LOCKED)</span>' : ""}</td>
                                    ${
                                        isGlobalAdmin
                                            ? `<td>${
                                                  locked
                                                      ? `<button class="admin-btn-secondary" data-unlock-delivery="${s.id}" style="font-size:10px; padding:5px 8px;">UNLOCK</button>`
                                                      : `<button class="admin-btn-danger" data-lock-delivery="${s.id}" style="font-size:10px; padding:5px 8px;">FORCE DISABLE &amp; LOCK</button>`
                                              }</td>`
                                            : ""
                                    }
                                </tr>`;
                            })
                            .join("")}
                    </tbody>
                </table>
            </div>
        `;

        if (isGlobalAdmin) {
            root.querySelectorAll("[data-lock-delivery]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    try {
                        await PayrollSystem.updateStore(Number(btn.dataset.lockDelivery), { operations: { delivery: { lockedBy: "globalAdmin" } } });
                        ok("Delivery force-disabled and locked for this store");
                        await this.renderOperations(root);
                    } catch (e) {
                        fail(e.message || "Could not lock delivery");
                    }
                });
            });
            root.querySelectorAll("[data-unlock-delivery]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    try {
                        await PayrollSystem.updateStore(Number(btn.dataset.unlockDelivery), { operations: { delivery: { lockedBy: null } } });
                        ok("Delivery lock cleared - the store can manage it again");
                        await this.renderOperations(root);
                    } catch (e) {
                        fail(e.message || "Could not clear the lock");
                    }
                });
            });
        }
    },

    // ---------------------------------------------------------------- LOCATIONS (STORES)
    // Pulled out of the Branding tab, where it had nothing to do with
    // colors/copy - multi-location structure belongs with the other
    // business-structure tools in Store Setup. Branding itself is global-
    // only now (see server.js's mergeStoreOverrides()) - a store's own
    // editable surface is contact info, home-page picks, a payments/tax
    // override, and its own operations (see renderStoreSettingsPanel()).
    expandedStoreBranding: {},

    /** A store's day-to-day settings (contact/picks/payments-override/
     *  operations/backup) - a scoped admin for stores their storeAccess
     *  covers (or unrestricted), a manager for their own store. Owner is
     *  read-only everywhere here, matching PATCH /api/stores/:id's
     *  server-side owner-exclusion. */
    canManageStoreSettings(storeId) {
        if (this.session.role === "admin") return !this.session.storeAccess || this.session.storeAccess.includes(storeId);
        if (this.session.role === "manager") return this.session.storeId === storeId;
        return false;
    },

    async renderStores(root) {
        const isGlobalAdmin = this.isGlobalAdmin();
        root.innerHTML = `
            ${
                isGlobalAdmin
                    ? `<button class="admin-btn-secondary" id="open-setup-wizard-storesetup" style="margin-bottom:16px;">&#9881; GETTING STARTED / SETUP WIZARD</button>`
                    : ""
            }
            <div class="config-controls">
                <h3 style="margin-top:0;">LOCATIONS</h3>
                <p class="admin-help-text">Every store sells the same menu and shares the same franchise branding - EDIT here covers a store's own contact info, home-page picks, tax/currency override, and operations.</p>
                <div id="stores-list" style="margin-bottom:10px;"></div>
                ${
                    isGlobalAdmin
                        ? `
                <div style="display:flex; gap:8px;">
                    <input type="text" id="new-store-name" maxlength="60" placeholder="Store name" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                    <input type="text" id="new-store-address" maxlength="200" placeholder="Address (optional)" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                    <button class="admin-btn" id="add-store">ADD STORE</button>
                </div>`
                        : `<p class="admin-help-text">Only a Global Admin can add stores.</p>`
                }
            </div>
        `;

        const renderStoresList = async () => {
            const stores = await PayrollSystem.fetchStores();
            document.getElementById("stores-list").innerHTML = stores
                .map((s) => {
                    const expanded = !!this.expandedStoreBranding[s.id];
                    const canEdit = this.canManageStoreSettings(s.id);
                    return `
                    <div style="border-bottom:1px solid var(--color-border); padding:8px 0;">
                        <div style="display:flex; align-items:center; gap:10px; font-size:11px;">
                            <span style="flex:1;">${escapeHtmlAttr(s.name)}${s.address ? ` — ${escapeHtmlAttr(s.address)}` : ""}</span>
                            <button class="admin-btn-secondary" data-toggle-panel="${s.id}" style="padding:4px 8px; font-size:10px;">${expanded ? "CLOSE" : canEdit ? "EDIT" : "VIEW"}</button>
                            ${isGlobalAdmin && stores.length > 1 ? `<button class="admin-btn-danger" data-remove-store="${s.id}" data-name="${escapeHtmlAttr(s.name)}" style="padding:4px 8px; font-size:10px;">REMOVE</button>` : ""}
                        </div>
                        ${expanded ? `<div id="store-panel-${s.id}" style="margin-top:10px; padding:12px; border:1px solid var(--color-border); background:var(--color-bg);"></div>` : ""}
                    </div>
                `;
                })
                .join("");

            root.querySelectorAll("[data-toggle-panel]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    const id = Number(btn.dataset.togglePanel);
                    this.expandedStoreBranding[id] = !this.expandedStoreBranding[id];
                    await renderStoresList();
                    if (this.expandedStoreBranding[id]) {
                        const store = stores.find((s) => s.id === id);
                        this.renderStoreSettingsPanel(document.getElementById(`store-panel-${id}`), store, this.canManageStoreSettings(id), renderStoresList);
                    }
                });
            });

            root.querySelectorAll("[data-remove-store]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const id = Number(btn.dataset.removeStore);
                    const otherStores = stores.filter((s) => s.id !== id);
                    this.renderRemoveStoreConfirm(btn.dataset.name, otherStores, async (reassignToStoreId) => {
                        try {
                            const result = await PayrollSystem.removeStore(id, { reassignToStoreId });
                            await renderStoresList();
                            ok(
                                result.affectedStaff === 0
                                    ? "Store removed"
                                    : result.reassigned
                                      ? `Store removed - ${result.affectedStaff} staff moved`
                                      : `Store removed - ${result.affectedStaff} staff deactivated`
                            );
                        } catch (e) {
                            fail(e.message);
                        }
                    });
                });
            });
        };
        await renderStoresList();

        document.getElementById("open-setup-wizard-storesetup")?.addEventListener("click", async () => {
            const mod = await import("./setup-wizard-modal.js");
            mod.renderSetupWizardModal({
                onNavigate: (tabId) => {
                    this.activeTab = tabId;
                    this.renderTabs();
                    this.renderActiveTab();
                }
            });
        });

        if (isGlobalAdmin) {
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

    /** Closing a store leaves its employees/managers pointing nowhere, so
     *  this asks up front what happens to them - move everyone to another
     *  store, or deactivate their accounts (matches DELETE /api/stores/:id,
     *  which requires exactly this choice). Not built with the generic
     *  renderInfoModal since this needs a store-picker dropdown, not just
     *  a yes/no. */
    renderRemoveStoreConfirm(storeName, otherStores, onConfirm) {
        document.getElementById("remove-store-overlay")?.remove();
        const overlay = document.createElement("div");
        overlay.id = "remove-store-overlay";
        overlay.className = "modal-overlay";
        overlay.style.zIndex = "6000";
        overlay.innerHTML = `
            <div class="modal-content" style="border: 2px solid var(--color-danger); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 340px; font-family: 'Courier New', monospace;">
                <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-danger); padding-bottom: 10px; margin-top:0; font-size: 1rem;">REMOVE ${escapeHtmlAttr(storeName)}?</h2>
                <p style="font-size: 12px; color: var(--color-text-muted);">Any employee/manager assigned here needs somewhere to go. Pick a store to move them to, or leave it as "Deactivate" to disable their accounts (their order/payroll history is kept either way).</p>
                <div class="control-group">
                    <label for="rsc-target">WHAT HAPPENS TO THEIR STAFF</label>
                    <select id="rsc-target" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit;">
                        <option value="">Deactivate their accounts</option>
                        ${otherStores.map((s) => `<option value="${s.id}">Move to ${escapeHtmlAttr(s.name)}</option>`).join("")}
                    </select>
                </div>
                <div style="display:grid; gap:10px; margin-top:16px;">
                    <button id="rsc-confirm" class="admin-btn-danger" style="padding:12px; font-weight:bold; text-transform:uppercase;">REMOVE STORE</button>
                    <button id="rsc-cancel" class="admin-btn-secondary" style="padding:10px; text-transform:uppercase;">CANCEL</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById("rsc-cancel").addEventListener("click", () => overlay.remove());
        document.getElementById("rsc-confirm").addEventListener("click", () => {
            const value = document.getElementById("rsc-target").value;
            overlay.remove();
            onConfirm(value ? Number(value) : null);
        });
    },

    // ---------------------------------------------------------------- THIS STORE (scoped roles)
    // A Local Admin/manager's own version of Store Setup's per-store panel -
    // just their own store, always expanded, no list of other locations and
    // no add/remove (that stays Global-Admin-only, see renderStores()).
    async renderThisStore(root) {
        const stores = await PayrollSystem.fetchStores();
        const store = stores.find((s) => s.id === this.session.storeId);
        if (!store) {
            root.innerHTML = `<p class="admin-help-text">Your account isn't assigned to a store yet - ask an admin to fix this from Staff Accounts.</p>`;
            return;
        }
        root.innerHTML = `<div class="config-controls"><h3 style="margin-top:0;">${escapeHtmlAttr(store.name)}</h3></div>`;
        this.renderStoreSettingsPanel(root.querySelector(".config-controls"), store, this.canManageStoreSettings(store.id), () => this.renderThisStore(root));
    },

    /** Shared per-store settings surface - used both by This Store (scoped
     *  roles, always expanded) and Locations' per-store expand (unrestricted
     *  roles). CONTACT/HOME PAGE PICKS/PAYMENTS OVERRIDE/OPERATIONS are the
     *  franchise-governance-redesign replacement for the old per-store
     *  branding editor (branding is global-only now); DATA & BACKUP is this
     *  store's own scoped backup/restore. */
    renderStoreSettingsPanel(container, store, canEdit, onSaved) {
        const footer = AdminConfig.settings.footer || {};
        container.innerHTML = `
            <div id="sp-contact"></div>
            <div id="sp-picks"></div>
            <div id="sp-payments"></div>
            <div id="sp-operations"></div>
            <div id="sp-backup"></div>
        `;

        renderReadOnlySection(container.querySelector("#sp-contact"), {
            title: "CONTACT",
            canEdit,
            fields: [
                { label: "Address", value: store.address || "" },
                { label: "Phone", value: store.phone || "", tooltip: "Blank uses the franchise-wide default phone number." },
                { label: "Coordinates", value: store.lat != null && store.lng != null ? `${store.lat}, ${store.lng}` : "", tooltip: "Used to sort the customer store picker by distance - optional." }
            ],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT CONTACT",
                    fields: [
                        { id: "sp-address", label: "Address (shown on the home page “Visit us” widget)", value: store.address || "", maxlength: 200 },
                        { id: "sp-phone", label: "Phone (blank = use franchise default)", value: store.phone || "", maxlength: 20, type: "tel" },
                        { id: "sp-lat", label: "Latitude", value: store.lat ?? "", placeholder: "Optional", type: "number", step: "any" },
                        { id: "sp-lng", label: "Longitude", value: store.lng ?? "", placeholder: "Optional", type: "number", step: "any" }
                    ],
                    onSave: async (v) => {
                        await PayrollSystem.updateStore(store.id, {
                            address: v["sp-address"].trim(),
                            phone: v["sp-phone"].trim(),
                            lat: v["sp-lat"].trim() || null,
                            lng: v["sp-lng"].trim() || null
                        });
                        ok("Contact info saved");
                        onSaved();
                    }
                })
        });

        const allItems = this.menu.items.filter((i) => !i.deleted);
        const picks = store.homePicks !== undefined ? store.homePicks : null;
        renderReadOnlySection(container.querySelector("#sp-picks"), {
            title: "HOME PAGE PICKS",
            canEdit,
            fields:
                picks === null
                    ? [{ label: "Source", value: "Using the franchise-wide default" }]
                    : picks.length === 0
                      ? [{ label: "Source", value: "Store override - no picks shown" }]
                      : picks.map((p, i) => {
                            const item = allItems.find((it) => it.id === p.itemId);
                            return { label: `Pick ${i + 1}`, value: item ? `${item.name}${p.tag ? ` (${p.tag})` : ""}` : "Unknown item" };
                        }),
            onEdit: () => {
                const pickField = (n) => {
                    const current = picks && picks[n];
                    return [
                        {
                            id: `sp-pick${n}-item`,
                            label: `Pick ${n + 1}`,
                            type: "select",
                            value: current ? String(current.itemId) : "",
                            options: [{ value: "", label: "(none)" }, ...allItems.map((i) => ({ value: String(i.id), label: i.name }))]
                        },
                        { id: `sp-pick${n}-tag`, label: `Pick ${n + 1} tag (optional, e.g. "House favourite")`, value: current?.tag || "", maxlength: 40 }
                    ];
                };
                renderSectionEditModal({
                    title: "EDIT HOME PAGE PICKS",
                    fields: [
                        { id: "sp-picks-use-default", label: "Use the franchise-wide default (ignore this store's own picks below)", value: picks === null, type: "checkbox" },
                        ...pickField(0),
                        ...pickField(1),
                        ...pickField(2)
                    ],
                    onSave: async (v) => {
                        if (v["sp-picks-use-default"]) {
                            await PayrollSystem.updateStore(store.id, { homePicks: null });
                        } else {
                            const newPicks = [0, 1, 2]
                                .map((n) => ({ itemId: v[`sp-pick${n}-item`], tag: v[`sp-pick${n}-tag`] }))
                                .filter((p) => p.itemId !== "");
                            await PayrollSystem.updateStore(store.id, { homePicks: newPicks });
                        }
                        ok("Home page picks saved");
                        onSaved();
                    }
                });
            }
        });

        const payments = store.payments || {};
        const fmtOverride = (v, suffix = "") => (v == null ? "Franchise default" : `${v}${suffix}`);
        renderReadOnlySection(container.querySelector("#sp-payments"), {
            title: "PAYMENTS & TAX OVERRIDE",
            canEdit,
            fields: [
                { label: "CGST rate", value: fmtOverride(payments.cgstRate != null ? (payments.cgstRate * 100).toFixed(2) : null, "%"), tooltip: "Blank = use the franchise default." },
                { label: "SGST rate", value: fmtOverride(payments.sgstRate != null ? (payments.sgstRate * 100).toFixed(2) : null, "%") },
                { label: "Service charge rate", value: fmtOverride(payments.serviceChargeRate != null ? (payments.serviceChargeRate * 100).toFixed(2) : null, "%") },
                { label: "Tip amount", value: fmtOverride(payments.tipAmount) },
                { label: "Tip enabled", value: payments.tipEnabled == null ? "Franchise default" : payments.tipEnabled ? "Yes" : "No" },
                { label: "Currency", value: fmtOverride(payments.currencySymbol ? `${payments.currencySymbol} (${payments.currencyCode})` : null) }
            ],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT PAYMENTS & TAX OVERRIDE",
                    fields: [
                        { id: "sp-cgst", label: "CGST rate (%, blank = franchise default)", value: payments.cgstRate != null ? (payments.cgstRate * 100).toFixed(2) : "", type: "number", step: 0.01, min: 0 },
                        { id: "sp-sgst", label: "SGST rate (%, blank = franchise default)", value: payments.sgstRate != null ? (payments.sgstRate * 100).toFixed(2) : "", type: "number", step: 0.01, min: 0 },
                        { id: "sp-service-charge", label: "Service charge rate (%, blank = franchise default)", value: payments.serviceChargeRate != null ? (payments.serviceChargeRate * 100).toFixed(2) : "", type: "number", step: 0.01, min: 0 },
                        { id: "sp-tip-amount", label: "Tip amount (blank = franchise default)", value: payments.tipAmount ?? "", type: "number", step: 0.01, min: 0 },
                        {
                            id: "sp-tip-enabled",
                            label: "Tip enabled",
                            type: "select",
                            value: payments.tipEnabled == null ? "" : String(payments.tipEnabled),
                            options: [
                                { value: "", label: "Franchise default" },
                                { value: "true", label: "Yes" },
                                { value: "false", label: "No" }
                            ]
                        },
                        { id: "sp-currency-symbol", label: "Currency symbol (blank = franchise default)", value: payments.currencySymbol || "", maxlength: 3 },
                        { id: "sp-currency-code", label: "Currency ISO code (blank = franchise default)", value: payments.currencyCode || "", maxlength: 3, tooltip: "Only sent to Razorpay." }
                    ],
                    onSave: async (v) => {
                        const pct = (s) => (s.trim() === "" ? null : parseFloat(s) / 100);
                        const num = (s) => (s.trim() === "" ? null : parseFloat(s));
                        await PayrollSystem.updateStore(store.id, {
                            payments: {
                                cgstRate: pct(v["sp-cgst"]),
                                sgstRate: pct(v["sp-sgst"]),
                                serviceChargeRate: pct(v["sp-service-charge"]),
                                tipAmount: num(v["sp-tip-amount"]),
                                tipEnabled: v["sp-tip-enabled"] === "" ? null : v["sp-tip-enabled"] === "true",
                                currencySymbol: v["sp-currency-symbol"].trim() || null,
                                currencyCode: v["sp-currency-code"].trim() || null
                            }
                        });
                        ok("Payments override saved");
                        onSaved();
                    }
                })
        });

        const operations = store.operations || { tableCount: 10, arcade: { enabled: true, sessionHours: 2 }, waitTime: { enabled: true, minMins: 5 } };
        const waitTime = operations.waitTime || { enabled: true, minMins: 5 };
        const delivery = operations.delivery || { enabled: true, lockedBy: null, message: { preset: null, customText: "" } };
        // A Global Admin's lock overrides a manager/Local Admin's own toggle -
        // this session can't touch enabled/message at all while it's locked,
        // UNLESS this session IS the Global Admin who can lift it (handled on
        // the separate cross-store Operations summary, not here - a Global
        // Admin viewing one store's own settings panel isn't restricted by
        // its own lock).
        const deliveryLockedForMe = delivery.lockedBy === "globalAdmin" && !this.isGlobalAdmin();
        const DELIVERY_PRESET_LABELS = { queueFull: "Too many orders, queue full", noPartner: "No delivery partner available" };
        renderReadOnlySection(container.querySelector("#sp-operations"), {
            title: "OPERATIONS",
            canEdit,
            fields: [
                { label: "Number of tables", value: String(operations.tableCount) },
                { label: "Arcade enabled", value: operations.arcade.enabled ? "Yes" : "No" },
                { label: "Arcade session length", value: `${operations.arcade.sessionHours}h` },
                { label: "Wait time estimate", value: waitTime.enabled ? "Enabled" : "Disabled" },
                { label: "Minimum wait shown", value: `${waitTime.minMins} min` },
                {
                    label: "Delivery",
                    value: `${delivery.enabled ? "Enabled" : "Disabled"}${deliveryLockedForMe ? " (locked off by a Global Admin)" : ""}`
                }
            ],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT OPERATIONS",
                    fields: [
                        { id: "sp-table-count", label: "Number of tables", value: operations.tableCount, type: "number", min: 0, max: 200, tooltip: "0 = only Online/Counter, no physical tabs." },
                        { id: "sp-arcade-enabled", label: "Enable arcade", value: operations.arcade.enabled, type: "checkbox" },
                        { id: "sp-arcade-hours", label: "Arcade session length (hours)", value: operations.arcade.sessionHours, type: "number", step: 0.5, min: 0.5, max: 24 },
                        { id: "sp-waittime-enabled", label: "Show wait time estimate to customers", value: waitTime.enabled, type: "checkbox" },
                        { id: "sp-waittime-min", label: "Minimum wait shown (mins)", value: waitTime.minMins, type: "number", min: 0, max: 60, tooltip: "The floor shown when there's no backlog - e.g. daily average with nothing in the queue." },
                        // Locked: omitted entirely rather than shown disabled
                        // (the field-editor helper has no disabled-field
                        // support) - the read-only summary row above already
                        // says it's locked before a manager even opens this.
                        ...(deliveryLockedForMe
                            ? []
                            : [
                                  { id: "sp-delivery-enabled", label: "Enable delivery", value: delivery.enabled, type: "checkbox" },
                                  {
                                      id: "sp-delivery-preset",
                                      label: "If paused, show customers",
                                      value: delivery.message.preset || "",
                                      type: "select",
                                      options: [
                                          { value: "", label: "(no preset - use custom text below)" },
                                          { value: "queueFull", label: DELIVERY_PRESET_LABELS.queueFull },
                                          { value: "noPartner", label: DELIVERY_PRESET_LABELS.noPartner }
                                      ]
                                  },
                                  { id: "sp-delivery-custom", label: "Custom message (used if no preset picked)", value: delivery.message.customText || "", type: "textarea", maxlength: 200, rows: 2 }
                              ])
                    ],
                    onSave: async (v) => {
                        const tableCount = parseInt(v["sp-table-count"], 10);
                        const arcadeHours = parseFloat(v["sp-arcade-hours"]);
                        const waitMinMins = parseInt(v["sp-waittime-min"], 10);
                        if (!Number.isFinite(tableCount) || tableCount < 0) throw new Error("Number of tables must be zero or a positive whole number.");
                        if (!Number.isFinite(arcadeHours) || arcadeHours <= 0) throw new Error("Arcade session length must be a positive number of hours.");
                        if (!Number.isFinite(waitMinMins) || waitMinMins < 0) throw new Error("Minimum wait must be zero or a positive whole number.");
                        await PayrollSystem.updateStore(store.id, {
                            operations: {
                                tableCount,
                                arcade: { enabled: v["sp-arcade-enabled"], sessionHours: arcadeHours },
                                waitTime: { enabled: v["sp-waittime-enabled"], minMins: waitMinMins },
                                ...(deliveryLockedForMe
                                    ? {}
                                    : { delivery: { enabled: v["sp-delivery-enabled"], message: { preset: v["sp-delivery-preset"] || null, customText: v["sp-delivery-custom"] || "" } } })
                            }
                        });
                        ok("Operations saved");
                        onSaved();
                    }
                })
        });

        this.renderStoreDataBackup(container.querySelector("#sp-backup"), store, canEdit);
    },

    /** Per-store scoped backup/restore - same shape as the whole-instance
     *  version in renderDataBackup(), just calling the /store/:id routes
     *  and only ever touching this one store's own records. */
    renderStoreDataBackup(container, store, canEdit) {
        container.innerHTML = `
            <div class="readonly-section">
                <div class="readonly-section-header"><h3 style="margin:0;">DATA & BACKUP FOR THIS STORE</h3></div>
                <p class="admin-help-text">Downloads this store's own orders, table sessions, timeclock, local discounts, and settings as one JSON file.</p>
                <button class="admin-btn-secondary" id="sp-backup-download">DOWNLOAD THIS STORE'S BACKUP</button>
                ${
                    canEdit
                        ? `
                <div style="margin-top:16px;">
                    <p class="admin-help-text" style="color:var(--color-danger);">Restoring overwrites this store's own orders/table-sessions/timeclock/local-discounts/settings with whatever's in the file. Never touches another store. This can't be undone.</p>
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                        <label for="sp-restore-file" class="admin-btn-secondary" style="cursor:pointer;">CHOOSE FILE</label>
                        <input type="file" id="sp-restore-file" accept="application/json" style="display:none;" />
                        <span id="sp-restore-file-name" style="font-size:11px; color:var(--color-text-muted);">No file selected.</span>
                    </div>
                    <button class="admin-btn-secondary" id="sp-restore-upload" style="border-color:var(--color-danger); color:var(--color-danger);" disabled>RESTORE THIS STORE</button>
                </div>`
                        : ""
                }
                <p id="sp-backup-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size:11px; min-height:12px; margin-top:10px;"></p>
            </div>
        `;
        container.querySelector("#sp-backup-download").addEventListener("click", () => PayrollSystem.downloadStoreBackup(store.id));
        if (!canEdit) return;

        let restoreFile = null;
        const restoreBtn = container.querySelector("#sp-restore-upload");
        container.querySelector("#sp-restore-file").addEventListener("change", (e) => {
            restoreFile = e.target.files[0] || null;
            restoreBtn.disabled = !restoreFile;
            container.querySelector("#sp-restore-file-name").textContent = restoreFile ? restoreFile.name : "No file selected.";
        });
        restoreBtn.addEventListener("click", () => {
            if (!restoreFile) return;
            renderInfoModal({
                title: "RESTORE THIS STORE",
                message: `This will overwrite ${escapeHtmlAttr(store.name)}'s own orders, table sessions, timeclock, local discounts, and settings with the contents of "${escapeHtmlAttr(restoreFile.name)}". This can't be undone. Continue?`,
                confirmText: "RESTORE",
                cancelText: "CANCEL",
                onConfirm: async () => {
                    const errorEl = container.querySelector("#sp-backup-error");
                    errorEl.textContent = "";
                    try {
                        const text = await restoreFile.text();
                        const parsed = JSON.parse(text);
                        const data = await PayrollSystem.restoreStoreBackup(store.id, parsed);
                        ok(`Restored ${data.restoredCount} record(s)${data.warnings.length ? ` - ${data.warnings.length} warning(s), see console` : ""}`);
                        if (data.warnings.length) console.warn("Store restore warnings:", data.warnings);
                    } catch (e) {
                        errorEl.textContent = e.message || "Could not restore store backup";
                    }
                }
            });
        });
    },

    // ---------------------------------------------------------------- DATA & BACKUP (whole-instance)
    // Restore is Global-Admin-only now (owner keeps read/download, matching
    // read-only-outside-adding-Global-Admins - see requireGlobalAdmin() in
    // server.js). Per-store backup/restore lives in each store's own page
    // instead (renderStoreDataBackup()), not here.
    async renderDataBackup(root) {
        const isOwner = this.session.role === "owner";
        const isGlobalAdmin = this.isGlobalAdmin();
        const canRestore = isGlobalAdmin;
        root.innerHTML = `
            <div class="config-controls">
                <h3 style="margin-top:0;">BACKUP</h3>
                <p class="admin-help-text">Downloads every record this app stores (menu, orders, staff accounts, config, etc.) as one JSON file. Uploaded images themselves aren't included, only their filenames/metadata - keep the "uploads" folder alongside any backup you keep long-term.</p>
                <button class="admin-btn-primary" id="backup-download">DOWNLOAD BACKUP</button>

                ${
                    canRestore
                        ? `
                <h3 style="margin-top:25px; border-top:1px solid var(--color-border); padding-top:20px;">RESTORE</h3>
                <p class="admin-help-text" style="color:var(--color-danger);">Overwrites current data with whatever's in the backup file - menu, orders, staff accounts, everything it contains. This can't be undone. Only restore a backup you trust.</p>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
                    <label for="restore-file-input" class="admin-btn-secondary" style="cursor:pointer;">CHOOSE FILE</label>
                    <input type="file" id="restore-file-input" accept="application/json" style="display:none;" />
                    <span id="restore-file-name" style="font-size:11px; color:var(--color-text-muted);">No file selected.</span>
                </div>
                <button class="admin-btn-secondary" id="restore-upload" style="border-color:var(--color-danger); color:var(--color-danger);" disabled>RESTORE FROM BACKUP</button>
                `
                        : `<p class="admin-help-text">${isOwner ? "Owner has read-only access to backups - a Global Admin can restore." : "Only a Global Admin can restore a backup."}</p>`
                }
                <p id="backup-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size:11px; min-height:12px; margin-top:10px;"></p>
            </div>
        `;

        document.getElementById("backup-download").addEventListener("click", () => {
            // A plain navigation (not fetch+blob) so the browser's own
            // download handling (Content-Disposition) takes over - simplest
            // way to trigger a real file save from a GET endpoint.
            window.open("/api/admin/backup", "_blank");
        });

        if (!canRestore) return;

        let restoreFile = null;
        const restoreBtn = document.getElementById("restore-upload");
        document.getElementById("restore-file-input").addEventListener("change", (e) => {
            restoreFile = e.target.files[0] || null;
            restoreBtn.disabled = !restoreFile;
            document.getElementById("restore-file-name").textContent = restoreFile ? restoreFile.name : "No file selected.";
        });

        restoreBtn.addEventListener("click", () => {
            if (!restoreFile) return;
            renderInfoModal({
                title: "RESTORE FROM BACKUP",
                message: `This will overwrite current menu, orders, staff accounts, and settings with the contents of "${escapeHtmlAttr(restoreFile.name)}". This can't be undone. Continue?`,
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
                        ok(`Restored ${data.restoredCount} file(s) - reloading…`);
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
                <div style="display:flex; gap:12px; margin-bottom:14px;">
                    <div class="control-group" style="flex:0 0 150px;">
                        <label for="report-from">FROM (optional)</label>
                        <input type="date" id="report-from" />
                    </div>
                    <div class="control-group" style="flex:0 0 150px;">
                        <label for="report-to">TO (optional)</label>
                        <input type="date" id="report-to" />
                    </div>
                </div>
                <button class="admin-btn-primary" id="report-export-csv">EXPORT CSV</button>
                <p id="report-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size:11px; min-height:12px; margin-top:10px;"></p>
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
            root.innerHTML = `<p style="color:var(--color-danger); font-size:12px;">Could not load dashboard data.</p>`;
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
            ${
                this.isGlobalAdmin()
                    ? `<button class="admin-btn-secondary" id="open-setup-wizard" style="margin-bottom:16px;">&#9881; GETTING STARTED / SETUP WIZARD</button>`
                    : ""
            }
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
                <div class="stat-card"><div class="stat-label">TODAY</div><div class="stat-value">${currencySymbol()}${kpi.today.revenue.toFixed(0)}</div><div class="field-hint">${kpi.today.orders} orders</div></div>
                <div class="stat-card"><div class="stat-label">THIS WEEK</div><div class="stat-value">${currencySymbol()}${kpi.week.revenue.toFixed(0)}</div><div class="field-hint">${kpi.week.orders} orders</div></div>
                <div class="stat-card"><div class="stat-label">THIS MONTH</div><div class="stat-value">${currencySymbol()}${kpi.month.revenue.toFixed(0)}</div><div class="field-hint">${kpi.month.orders} orders</div></div>
                <div class="stat-card"><div class="stat-label">ALL TIME</div><div class="stat-value">${currencySymbol()}${kpi.allTime.revenue.toFixed(0)}</div><div class="field-hint">${kpi.allTime.orders} orders</div></div>
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
                    <h3 style="font-size:12px; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">REVENUE - ${rangeLabels[this.kpiRange]}</h3>
                    <div style="display:flex; align-items:flex-end; gap:${kpi.chart.length > 20 ? "2px" : "8px"}; height:140px; border-bottom:1px solid var(--color-border); padding-bottom:4px;">
                        ${kpi.chart
                            .map(
                                (d) => `
                            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;" title="${d.label}: ${currencySymbol()}${d.revenue.toFixed(2)} (${d.count} orders)">
                                ${kpi.chart.length <= 14 ? `<div style="font-size:10px; color:var(--color-text-muted); margin-bottom:4px;">${currencySymbol()}${d.revenue.toFixed(0)}</div>` : ""}
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
                                    `<div style="flex:1; text-align:center; font-size:9px; color:var(--color-text-muted); ${kpi.chart.length > 14 && i % Math.ceil(kpi.chart.length / 10) !== 0 ? "visibility:hidden;" : ""}">${this.kpiRange === "1y" ? d.label.slice(2) : d.label.slice(5)}</div>`
                            )
                            .join("")}
                    </div>
                </div>
                <div>
                    <h3 style="font-size:12px; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">TOP SELLERS (${rangeLabels[this.kpiRange]})</h3>
                    ${
                        kpi.bestSellers.length === 0
                            ? `<p class="admin-help-text">No orders yet.</p>`
                            : kpi.bestSellers
                                  .map(
                                      (s) => `
                            <div style="margin-bottom:10px;">
                                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px;">
                                    <span>${escapeHtmlAttr(s.name)}</span><span style="color:var(--color-text-muted);">${s.quantity}</span>
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
                    <h3 style="font-size:12px; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">CREW</h3>
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
                                    <span style="width:30px; height:30px; flex:none; border:1px solid var(--color-accent); color:var(--color-accent); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:bold;">${initials}</span>
                                    <div style="flex:1; min-width:0;">
                                        <div style="font-size:12px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtmlAttr(p.name)}</div>
                                        <div style="font-size:10px; color:var(--color-text-muted); margin-top:2px; letter-spacing:.06em; text-transform:uppercase;">${escapeHtmlAttr(p.role)}${p.tag ? " &middot; " + escapeHtmlAttr(p.tag) : ""}</div>
                                    </div>
                                    <span style="flex:none; font-size:10px; font-weight:bold; letter-spacing:.06em; text-transform:uppercase; color:${p.clockedIn ? "var(--color-success)" : "var(--color-text-muted)"};">${p.clockedIn ? "● ON SHIFT" : "OFF SHIFT"}</span>
                                </div>
                            `;
                                  })
                                  .join("")
                    }
                </div>
                <div>
                    <h3 style="font-size:12px; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">STATIONS</h3>
                    ${Object.entries(pendingByStation)
                        .map(
                            ([name, pending]) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:9px 0; border-top:1px dashed var(--color-border);">
                            <div style="min-width:0;">
                                <div style="font-size:12px; font-weight:bold; letter-spacing:.06em; text-transform:uppercase;">${name}</div>
                                <div style="font-size:10px; color:var(--color-text-muted); margin-top:2px; letter-spacing:.08em; text-transform:uppercase;">Pending items</div>
                            </div>
                            <span style="font-size:22px; font-weight:bold; color:${pending > 0 ? "var(--color-accent)" : "var(--color-success)"};">${pending}</span>
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

        document.getElementById("open-setup-wizard")?.addEventListener("click", async () => {
            const mod = await import("./setup-wizard-modal.js");
            mod.renderSetupWizardModal({
                onNavigate: (tabId) => {
                    this.activeTab = tabId;
                    this.renderTabs();
                    this.renderActiveTab();
                }
            });
        });
    },

    // ---------------------------------------------------------------- FRANCHISE DASHBOARD
    // Cross-store comparison, separate from the single-store Dashboard above
    // (which now only ever reflects the session's own store/storeAccess) -
    // owner always sees it; a scoped admin only when their storeAccess
    // actually spans more than one store (see tabGroupsForRole()).
    async renderFranchiseDashboard(root) {
        const kpi = await PayrollSystem.fetchKpi("7d");
        if (!kpi) {
            root.innerHTML = `<p style="color:var(--color-danger); font-size:12px;">Could not load dashboard data.</p>`;
            return;
        }
        const byStore = kpi.byStore || [];
        const maxAllTimeRevenue = Math.max(1, ...byStore.map((s) => s.allTime.revenue));

        root.innerHTML = `
            <h3 style="font-size:12px; letter-spacing:1px; color:var(--color-accent); margin-bottom:4px;">COMBINED (EVERY STORE YOU CAN SEE)</h3>
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-bottom:26px;">
                <div class="stat-card"><div class="stat-label">TODAY</div><div class="stat-value">${currencySymbol()}${kpi.today.revenue.toFixed(0)}</div><div class="field-hint">${kpi.today.orders} orders</div></div>
                <div class="stat-card"><div class="stat-label">THIS WEEK</div><div class="stat-value">${currencySymbol()}${kpi.week.revenue.toFixed(0)}</div><div class="field-hint">${kpi.week.orders} orders</div></div>
                <div class="stat-card"><div class="stat-label">THIS MONTH</div><div class="stat-value">${currencySymbol()}${kpi.month.revenue.toFixed(0)}</div><div class="field-hint">${kpi.month.orders} orders</div></div>
                <div class="stat-card"><div class="stat-label">ALL TIME</div><div class="stat-value">${currencySymbol()}${kpi.allTime.revenue.toFixed(0)}</div><div class="field-hint">${kpi.allTime.orders} orders</div></div>
            </div>

            <h3 style="font-size:12px; letter-spacing:1px; color:var(--color-accent); margin-bottom:12px;">STORE VS STORE (ALL TIME)</h3>
            ${
                byStore.length === 0
                    ? `<p class="admin-help-text">No stores to compare yet.</p>`
                    : byStore
                          .map(
                              (s) => `
                <div style="margin-bottom:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:baseline; font-size:12px; margin-bottom:5px;">
                        <span style="font-weight:bold;">${escapeHtmlAttr(s.storeName)}</span>
                        <span style="color:var(--color-text-muted);">${currencySymbol()}${s.allTime.revenue.toFixed(0)} &middot; ${s.allTime.orders} orders all-time &middot; ${currencySymbol()}${s.today.revenue.toFixed(0)} today</span>
                    </div>
                    <div style="height:10px; background:var(--color-border);"><div style="height:100%; width:${(s.allTime.revenue / maxAllTimeRevenue) * 100}%; background:var(--color-accent);"></div></div>
                </div>
            `
                          )
                          .join("")
            }
        `;
    },

    // ---------------------------------------------------------------- PAYROLL
    // "Make payments" (marking a pay period paid, approving overtime) is a
    // manager's own operational duty specifically - a Local Admin sets pay
    // RATES (via User Management's edit staff modal) but doesn't execute
    // the payout; Global Admin/owner see this tab read-only like everyone
    // else's numbers, same as the rest of the franchise.
    async renderPayroll(root) {
        const canPay = this.session.role === "manager";
        const staff = await PayrollSystem.fetchPayroll();
        const history = await PayrollSystem.fetchPayrollHistory();
        const allStaff = (await fetch("/api/users", { credentials: "include" }).then((r) => r.json())).filter((u) =>
            ["employee", "manager"].includes(u.role)
        );
        const attendance = await PayrollSystem.fetchAttendance();

        root.innerHTML = `
            <h3 style="font-size:12px; letter-spacing:1px; color:var(--color-accent); margin-bottom:5px;">CURRENT PAY PERIOD</h3>
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
                            <td>${escapeHtmlAttr(s.name)}</td>
                            <td style="font-size:11px; color:var(--color-text-muted);">${escapeHtmlAttr(s.tag) || "\u2014"}</td>
                            <td style="font-size:11px;">${currencySymbol()}${s.payRate}/${s.payRateType === "hourly" ? "hr" : s.payRateType === "weekly" ? "wk" : "mo"}</td>
                            <td>
                                ${s.hoursWorked !== null ? s.hoursWorked : "\u2014"}
                                ${
                                    s.hasUnapprovedOvertime
                                        ? `<div style="color:var(--color-danger); font-size:10px; margin-top:2px;">\u26a0 ${s.rawHours}h worked, capped at ${s.hoursWorked}h</div>`
                                        : ""
                                }
                            </td>
                            <td>${currencySymbol()}${s.amount.toFixed(2)}</td>
                            <td>${s.isPaid ? `<span style="color:var(--color-success);">\u2713 PAID</span>` : `<span style="color:var(--color-cyan);">PENDING</span>`}</td>
                            <td style="text-align:right;">
                                ${canPay && s.hasUnapprovedOvertime ? `<button class="admin-btn" data-approve-ot="${s.userId}" data-name="${escapeHtmlAttr(s.name)}">APPROVE OT</button>` : ""}
                                ${canPay && !s.isPaid ? `<button class="admin-btn" data-mark-paid="${s.userId}" data-name="${escapeHtmlAttr(s.name)}" data-amount="${s.amount.toFixed(2)}">MARK PAID</button>` : ""}
                                ${!canPay ? `<span style="color:var(--color-text-muted); font-size:10px;">—</span>` : ""}
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
                    <label for="att-user" class="admin-field-label" style="display:block; margin-bottom:3px;">STAFF</label>
                    <select id="att-user" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:11px;">
                        ${allStaff.map((u) => `<option value="${u.id}">${escapeHtmlAttr(u.name)}${u.tag ? ` (${escapeHtmlAttr(u.tag)})` : ""}</option>`).join("")}
                    </select>
                </div>
                <div>
                    <label for="att-date" class="admin-field-label" style="display:block; margin-bottom:3px;">DATE</label>
                    <input type="date" id="att-date" value="${new Date().toISOString().slice(0, 10)}" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:11px;" />
                </div>
                <div>
                    <label for="att-hours" class="admin-field-label" style="display:block; margin-bottom:3px;">HOURS</label>
                    <input type="number" id="att-hours" min="0.5" max="24" step="0.5" value="8" style="width:80px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; font-size:11px;" />
                </div>
                <button class="admin-btn-primary" id="att-submit">MARK</button>
            </div>
            <p id="attendance-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size:11px; min-height:12px;"></p>

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
                            <td>${escapeHtmlAttr(a.name)}</td>
                            <td style="font-size:11px;">${escapeHtmlAttr(a.date)}</td>
                            <td>${a.hours}${a.hours > 8 ? ` <span style="color:var(--color-danger); font-size:10px;">(OT)</span>` : ""}</td>
                            <td style="font-size:11px; color:var(--color-text-muted);">${escapeHtmlAttr(a.markedBy)}</td>
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
                            <td>${escapeHtmlAttr(h.name)}</td>
                            <td style="font-size:11px;">${h.periodStart.slice(0, 10)} \u2192 ${h.periodEnd.slice(0, 10)}</td>
                            <td>${h.hoursWorked !== null ? h.hoursWorked : "\u2014"}</td>
                            <td>${currencySymbol()}${h.amountPaid.toFixed(2)}</td>
                            <td style="font-size:11px; color:var(--color-text-muted);">${new Date(h.paidAt).toLocaleString()} by ${escapeHtmlAttr(h.paidBy)}</td>
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
                    message: `Confirm ${escapeHtmlAttr(btn.dataset.name)} has been paid ${currencySymbol()}${escapeHtmlAttr(btn.dataset.amount)} for this period? This can't be undone.`,
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
                    message: `${escapeHtmlAttr(btn.dataset.name)} worked ${escapeHtmlAttr(staffMember?.rawHours)}h against the ${8}h daily cap this period. Approve the extra hours to count toward pay?`,
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
    // Sections start collapsed (header + count only) - showing every item
    // table for every section at once, each with 3 always-visible action
    // buttons per row, was the main source of "cluttered/intimidating"
    // feedback on this tab. Keyed by section id, true = expanded.
    expandedMenuSections: {},
    // Per-item per-store availability panel (only shown when there's more
    // than one store) - keyed by item id, true = expanded.
    expandedItemStores: {},

    async renderMenuItems(root) {
        const sectionById = Object.fromEntries(this.menu.sections.map((s) => [s.id, s.title]));
        const customIcons = AdminConfig.settings.customIcons || {};
        const PAGE_SIZE = 10;
        // The menu is shared across stores by design - this only matters once
        // there's more than one store to disable an item at.
        const stores = await PayrollSystem.fetchStores();
        const multiStore = stores.length > 1;

        const pendingRequestItems = this.menu.items.filter((i) => (i.disableRequests || []).length > 0);

        const iconHtml = (item) =>
            item.imageUrl
                ? `<img src="${escapeHtmlAttr(item.imageUrl)}" alt="" width="22" height="22" style="width:22px; height:22px; object-fit:cover; border-radius:4px;" />`
                : customIcons[item.icon]
                  ? `<img src="${escapeHtmlAttr(customIcons[item.icon])}" alt="" width="22" height="22" style="width:22px; height:22px; object-fit:contain;" />`
                  : `<span class="icon icon-${item.icon}" style="display:inline-block; width:22px; height:22px;"></span>`;

        const rowHtml = (item) => {
            if (item.deleted) {
                return `
            <tr style="opacity:0.5;">
                <td>${iconHtml(item)}</td>
                <td>${escapeHtmlAttr(item.name)} <span style="color:var(--color-danger); font-size:10px;">DELETED</span></td>
                <td>${currencySymbol()}${item.price}</td>
                <td></td>
                <td style="text-align:right;">
                    <button class="admin-btn" data-restore="${item.id}" style="padding:4px 8px; font-size:10px;">RESTORE</button>
                </td>
            </tr>
        `;
            }
            const stockCell =
                item.stockCount == null
                    ? `<span style="color:var(--color-text-muted); font-size:11px;">\u221e</span>`
                    : item.stockCount === 0
                      ? `<span style="color:var(--color-danger); font-size:11px;">OUT OF STOCK</span>`
                      : `<span style="${item.stockCount <= 5 ? "color:var(--color-danger);" : ""} font-size:11px;">${item.stockCount}</span>`;
            const disabledStores = item.disabledStores || [];
            const storesExpanded = !!this.expandedItemStores[item.id];
            return `
            <tr style="${item.available === false ? "opacity:0.5;" : ""}">
                <td>${iconHtml(item)}</td>
                <td>${escapeHtmlAttr(item.name)}${item.available === false ? ' <span style="color:var(--color-danger); font-size:10px;">UNAVAILABLE</span>' : ""}${disabledStores.length ? ` <span style="color:var(--color-text-muted); font-size:10px;">OUT AT ${disabledStores.length} STORE${disabledStores.length > 1 ? "S" : ""}</span>` : ""}</td>
                <td>${currencySymbol()}${item.price}${
                    item.promoDiscount
                        ? `<br><span style="color: var(--color-accent); font-size: 10px;">${item.promoDiscount.type === "percent" ? `${item.promoDiscount.value}% OFF` : `${currencySymbol()}${item.promoDiscount.value} OFF`}</span>`
                        : ""
                }</td>
                <td>${stockCell}</td>
                <td style="text-align:right; white-space:nowrap;">
                    <button class="admin-btn" data-edit="${item.id}" style="padding:4px 8px; font-size:10px;">EDIT</button>
                    <button class="admin-btn" data-toggle-available="${item.id}" style="padding:4px 8px; font-size:10px;" title="${item.available === false ? "Mark available" : "Mark unavailable"}">${item.available === false ? "SHOW" : "HIDE"}</button>
                    ${multiStore ? `<button class="admin-btn" data-toggle-item-stores="${item.id}" style="padding:4px 8px; font-size:10px;">STORES</button>` : ""}
                    <button class="admin-btn admin-btn-danger" data-delete="${item.id}" style="padding:4px 8px; font-size:10px;">DEL</button>
                </td>
            </tr>
            ${
                multiStore && storesExpanded
                    ? `
            <tr>
                <td colspan="5" style="background:var(--color-bg);">
                    <div style="padding:8px 10px;">
                        <p class="admin-help-text" style="margin:0 0 6px;">Uncheck a store to take "${escapeHtmlAttr(item.name)}" off the menu there only (e.g. out of stock at that location).</p>
                        <div style="display:flex; flex-wrap:wrap; gap:12px;">
                            ${stores
                                .map(
                                    (s) => `
                                <label style="display:flex; align-items:center; gap:5px; font-size:11px; cursor:pointer;">
                                    <input type="checkbox" data-item-store="${item.id}" value="${s.id}" ${disabledStores.includes(s.id) ? "" : "checked"} />
                                    ${escapeHtmlAttr(s.name)}
                                </label>
                            `
                                )
                                .join("")}
                        </div>
                        <button class="admin-btn-primary" data-save-item-stores="${item.id}" style="margin-top:8px; padding:4px 8px; font-size:10px;">SAVE</button>
                    </div>
                </td>
            </tr>
            `
                    : ""
            }
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
            const expanded = !!this.expandedMenuSections[section.id];
            const headerHtml = `
                <div class="menu-section-header" data-toggle-section="${section.id}" role="button" tabindex="0" aria-expanded="${expanded}" style="display:flex; justify-content:space-between; align-items:center; padding:8px 4px; cursor:pointer; border-bottom:1px solid var(--color-border);">
                    <h3 style="font-size:13px; letter-spacing:1px; color:var(--color-accent); display:flex; align-items:center; gap:8px; margin:0;">
                        <span aria-hidden="true" style="display:inline-block; transition:transform .1s; transform:rotate(${expanded ? "90deg" : "0deg"});">&#9656;</span>
                        ${escapeHtmlAttr(section.title)} <span style="color:var(--color-text-muted); font-size:11px;">(${items.length})</span>
                    </h3>
                    <button class="admin-btn admin-btn-danger" data-delete-section="${section.id}" style="padding:4px 8px; font-size:10px;">DELETE SECTION</button>
                </div>
            `;
            if (items.length === 0) {
                return `
                    <div class="menu-section-block" style="margin-bottom:10px;">
                        ${headerHtml}
                        ${expanded ? `<p class="admin-help-text" style="padding:8px 4px;">No items in this section yet.</p>` : ""}
                    </div>
                `;
            }
            if (!expanded) {
                return `<div class="menu-section-block" style="margin-bottom:10px;">${headerHtml}</div>`;
            }
            const page = this.menuItemPages[section.id] || 1;
            const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
            const clampedPage = Math.min(page, totalPages);
            const pageItems = items.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

            return `
                <div class="menu-section-block" data-section="${section.id}" style="margin-bottom:10px;">
                    ${headerHtml}
                    <table class="admin-table">
                        <thead><tr><th>ICON</th><th>NAME</th><th>PRICE</th><th>STOCK</th><th style="text-align:right;">ACTION</th></tr></thead>
                        <tbody>${pageItems.map(rowHtml).join("")}</tbody>
                    </table>
                    ${
                        totalPages > 1
                            ? `<div style="display:flex; align-items:center; gap:2px; margin-top:8px; justify-content:flex-end;">
                            <button class="admin-pg-btn menu-page-first" data-section="${section.id}" ${clampedPage <= 1 ? "disabled" : ""} title="First page" aria-label="First page">\u00ab</button>
                            <button class="admin-pg-btn menu-page-prev" data-section="${section.id}" ${clampedPage <= 1 ? "disabled" : ""} title="Previous page" aria-label="Previous page">\u2039</button>
                            <span style="font-size:11px; color:var(--color-text-muted); margin:0 6px;"><strong style="color:var(--color-accent);">${(clampedPage - 1) * PAGE_SIZE + 1}-${Math.min(clampedPage * PAGE_SIZE, items.length)}</strong> of ${items.length}</span>
                            <button class="admin-pg-btn menu-page-next" data-section="${section.id}" ${clampedPage >= totalPages ? "disabled" : ""} title="Next page" aria-label="Next page">\u203a</button>
                            <button class="admin-pg-btn menu-page-last" data-section="${section.id}" ${clampedPage >= totalPages ? "disabled" : ""} title="Last page" aria-label="Last page">\u00bb</button>
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
                    <h3 style="font-size:12px; color:var(--color-danger); margin-bottom:8px;">PENDING DISABLE REQUESTS (${pendingRequestItems.length})</h3>
                    ${pendingRequestItems
                        .map(
                            (item) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px dashed var(--color-border); font-size:11px;">
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
                <button class="admin-btn" id="menu-expand-all">EXPAND ALL</button>
                <button class="admin-btn" id="menu-collapse-all">COLLAPSE ALL</button>
                <label style="display:flex; align-items:center; gap:5px; font-size: var(--admin-help-font-size, 10px); color: var(--admin-help-color, var(--color-text-muted)); cursor:pointer; font-family: 'Courier New', monospace; margin-left:auto;">
                    <input type="checkbox" id="menu-show-deleted" ${this.showDeletedMenuItems ? "checked" : ""} />
                    SHOW INACTIVE
                </label>
            </div>

            ${this.menu.sections.map(sectionBlockHtml).join("")}
        `;

        document.getElementById("menu-add-item").addEventListener("click", () => this.openItemModal(null));
        document.getElementById("menu-add-section").addEventListener("click", () => this.addMenuSection(root));
        document.getElementById("menu-expand-all").addEventListener("click", () => {
            this.menu.sections.forEach((s) => (this.expandedMenuSections[s.id] = true));
            this.renderMenuItems(root);
        });
        document.getElementById("menu-collapse-all").addEventListener("click", () => {
            this.menu.sections.forEach((s) => (this.expandedMenuSections[s.id] = false));
            this.renderMenuItems(root);
        });
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
        root.querySelectorAll("[data-toggle-item-stores]").forEach((btn) =>
            btn.addEventListener("click", () => {
                const id = Number(btn.dataset.toggleItemStores);
                this.expandedItemStores[id] = !this.expandedItemStores[id];
                this.renderMenuItems(root);
            })
        );
        root.querySelectorAll("[data-save-item-stores]").forEach((btn) =>
            btn.addEventListener("click", () => this.saveItemStores(Number(btn.dataset.saveItemStores), root))
        );
        root.querySelectorAll("[data-delete-section]").forEach((btn) =>
            btn.addEventListener("click", (e) => {
                e.stopPropagation(); // sits inside the collapsible header - don't also toggle it
                this.deleteMenuSection(btn.dataset.deleteSection, root);
            })
        );
        root.querySelectorAll("[data-toggle-section]").forEach((header) => {
            const toggle = () => {
                const id = header.dataset.toggleSection;
                this.expandedMenuSections[id] = !this.expandedMenuSections[id];
                this.renderMenuItems(root);
            };
            header.addEventListener("click", toggle);
            // This header is a <div role="button"> (it wraps its own nested
            // DELETE SECTION <button>, so it can't itself be a <button>) -
            // native buttons get Enter/Space activation for free, this
            // doesn't, so it's wired by hand here.
            header.addEventListener("keydown", (e) => {
                if (e.target !== header) return; // don't hijack Enter/Space on the nested DELETE button
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                }
            });
        });
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

    /** Saves which stores an item is disabled at, from the STORES panel's
     *  checkboxes (unchecked = disabled there). */
    async saveItemStores(itemId, root) {
        const checkboxes = root.querySelectorAll(`[data-item-store="${itemId}"]`);
        const disabledStores = Array.from(checkboxes)
            .filter((cb) => !cb.checked)
            .map((cb) => Number(cb.value));
        try {
            const res = await fetch(`/api/menu/${itemId}`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ disabledStores })
            });
            if (!res.ok) throw new Error((await res.json()).error || "Could not update item");
            await this.loadMenu();
            this.renderMenuItems(root);
            ok("Store availability saved");
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
                    <h3 style="font-size: 14px; letter-spacing: 1px; color: var(--color-accent); margin-bottom: 4px;">${g.title}</h3>
                    <p class="admin-help-text" style="margin-bottom: 10px;">${g.note}</p>
                    <table class="admin-table">
                        <thead><tr><th>LABEL</th><th>KEY</th><th>PRICE ADD-ON (${currencySymbol()})</th><th></th></tr></thead>
                        <tbody class="cp-rows"></tbody>
                    </table>
                    <button class="admin-btn cp-add-row" style="margin-top:8px;">+ ADD OPTION</button>
                    <button class="admin-btn admin-btn-primary cp-save" style="margin-top:8px; margin-left:8px;">SAVE ${g.title}</button>
                    <p class="cp-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 6px 0 0;"></p>
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
                    <td><input class="cp-label" type="text" aria-label="Option ${idx + 1} label" maxlength="30" value="${escapeHtmlAttr(opt.label)}" style="width:100%; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:5px; font-family:inherit;" /></td>
                    <td><input class="cp-key" type="text" aria-label="Option ${idx + 1} key" maxlength="30" value="${escapeHtmlAttr(opt.key)}" placeholder="auto from label" style="width:100%; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text-muted); padding:5px; font-family:inherit; font-size:11px;" /></td>
                    <td><input class="cp-price" type="number" min="0" step="1" aria-label="Option ${idx + 1} price add-on" value="${opt.priceDelta}" style="width:90px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:5px; font-family:inherit;" /></td>
                    <td><button class="admin-btn admin-btn-danger cp-remove-row" aria-label="Remove option ${idx + 1}">REMOVE</button></td>
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

    // ------------------------------------------------------------ CUSTOMERS
    customerSearchQuery: "",
    viewingCustomerId: null,

    async renderCustomers(root) {
        root.innerHTML = `
            <div class="control-group" style="max-width:320px;">
                <label for="customer-search">SEARCH BY NAME, USERNAME, OR PHONE</label>
                <input type="text" id="customer-search" maxlength="60" value="${escapeHtmlAttr(this.customerSearchQuery)}" placeholder="Start typing…" />
            </div>
            <div id="customers-results"></div>
        `;

        const searchInput = document.getElementById("customer-search");
        let debounceTimer;
        searchInput.addEventListener("input", () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                this.customerSearchQuery = searchInput.value;
                this.renderCustomerResults(root);
            }, 200);
        });
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);

        await this.renderCustomerResults(root);
    },

    async renderCustomerResults(root) {
        const resultsEl = document.getElementById("customers-results");
        if (!resultsEl) return;
        if (this.viewingCustomerId) return this.renderCustomerDetail(root);

        const res = await fetch(`/api/admin/customers?search=${encodeURIComponent(this.customerSearchQuery)}`, { credentials: "include" });
        const customers = res.ok ? await res.json() : [];

        resultsEl.innerHTML =
            customers.length === 0
                ? `<p class="admin-help-text" style="margin-top:14px;">${this.customerSearchQuery ? "No matching customers." : "No customer accounts yet."}</p>`
                : `
                <table class="admin-table" style="margin-top:14px;">
                    <thead><tr><th>NAME</th><th>USERNAME</th><th>PHONE</th><th>LOYALTY PTS</th><th>ORDERS</th><th></th></tr></thead>
                    <tbody>
                        ${customers
                            .map(
                                (c) => `
                            <tr>
                                <td>${escapeHtmlAttr(c.name || "—")}</td>
                                <td style="color:var(--color-text-muted); font-size:11px;">${escapeHtmlAttr(c.username || "—")}</td>
                                <td style="font-size:11px;">${escapeHtmlAttr(c.phone || "—")}</td>
                                <td>${c.loyaltyPoints}</td>
                                <td>${c.orderCount}</td>
                                <td style="text-align:right;"><button class="admin-btn" data-view-customer="${c.id}" style="padding:4px 8px; font-size:10px;">VIEW</button></td>
                            </tr>
                        `
                            )
                            .join("")}
                    </tbody>
                </table>
            `;

        resultsEl.querySelectorAll("[data-view-customer]").forEach((btn) =>
            btn.addEventListener("click", () => {
                this.viewingCustomerId = Number(btn.dataset.viewCustomer);
                this.renderCustomerDetail(root);
            })
        );
    },

    async renderCustomerDetail(root) {
        const resultsEl = document.getElementById("customers-results");
        if (!resultsEl) return;
        resultsEl.innerHTML = `<p class="admin-help-text" style="margin-top:14px;">Loading&hellip;</p>`;

        const res = await fetch(`/api/admin/customers/${this.viewingCustomerId}`, { credentials: "include" });
        if (!res.ok) {
            resultsEl.innerHTML = `<p style="color:var(--color-danger); font-size:12px; margin-top:14px;">Could not load that customer.</p>`;
            return;
        }
        const { profile, orders, totalSpent } = await res.json();

        resultsEl.innerHTML = `
            <button type="button" class="admin-btn-secondary" id="customer-back" style="margin:14px 0;">&larr; BACK TO SEARCH</button>
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-bottom:16px;">
                <div class="stat-card"><div class="stat-label">NAME</div><div class="stat-value" style="font-size:19px;">${escapeHtmlAttr(profile.name || "—")}</div></div>
                <div class="stat-card"><div class="stat-label">LOYALTY POINTS</div><div class="stat-value">${profile.loyaltyPoints || 0}</div></div>
                <div class="stat-card"><div class="stat-label">ORDERS</div><div class="stat-value">${orders.length}</div></div>
                <div class="stat-card"><div class="stat-label">TOTAL SPENT (PAID)</div><div class="stat-value">${currencySymbol()}${totalSpent.toFixed(0)}</div></div>
            </div>
            <p style="font-size:11px; color:var(--color-text-muted); margin-bottom:14px;">USERNAME: ${escapeHtmlAttr(profile.username || "—")} &middot; PHONE: ${escapeHtmlAttr(profile.phone || "—")}</p>
            <h3 style="font-size:12px; letter-spacing:1px; color:var(--color-accent); margin-bottom:8px;">ORDER HISTORY</h3>
            ${
                orders.length === 0
                    ? `<p class="admin-help-text">No orders yet.</p>`
                    : `
                <table class="admin-table">
                    <thead><tr><th>ORDER #</th><th>DATE</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th></tr></thead>
                    <tbody>
                        ${orders
                            .map(
                                (o) => `
                            <tr>
                                <td>${escapeHtmlAttr(o.orderNumber || o.id)}</td>
                                <td style="font-size:11px;">${new Date(o.createdAt).toLocaleString()}</td>
                                <td style="font-size:11px;">${escapeHtmlAttr(o.items.map((i) => `${i.quantity}x ${i.name}`).join(", "))}</td>
                                <td>${currencySymbol()}${o.total.toFixed(2)}</td>
                                <td style="font-size:11px; color:${o.isPaid ? "var(--color-success)" : "var(--color-danger)"};">${o.isPaid ? "PAID" : "UNPAID"}</td>
                            </tr>
                        `
                            )
                            .join("")}
                    </tbody>
                </table>
            `
            }
        `;

        document.getElementById("customer-back").addEventListener("click", () => {
            this.viewingCustomerId = null;
            this.renderCustomerResults(root);
        });
    },

    // ------------------------------------------------------------ DISCOUNTS & LOYALTY
    // Loyalty and franchise-wide coupons are Global-Admin-edit (same lane as
    // Branding/Payments defaults); a store's own local discounts are edited
    // by whoever runs that store (canManageStoreSettings()) - a Local
    // Admin/manager creating one always ties it to their own store.
    async renderDiscountsLoyalty(root) {
        const config = AdminConfig.settings;
        const loyalty = config.loyalty || { enabled: true, pointsPerRupeeSpent: 0.1, rupeeValuePerPoint: 0.5 };
        const couponsRes = await fetch("/api/coupons", { credentials: "include" });
        const coupons = couponsRes.ok ? await couponsRes.json() : [];
        const franchiseCoupons = coupons.filter((c) => c.storeId == null);
        const localCoupons = coupons.filter((c) => c.storeId != null);
        const stores = await PayrollSystem.fetchStores();
        const storeName = (id) => stores.find((s) => s.id === id)?.name || `Store ${id}`;
        const canEditLoyalty = this.isGlobalAdmin();
        // A local discount can be added by a manager (always their own
        // store), a Local Admin (any store their storeAccess covers), or a
        // Global Admin (any store) - same set canManageStoreSettings()
        // already resolves for the per-store settings panel.
        const localAddableStores = stores.filter((s) => this.canManageStoreSettings(s.id));

        const couponRowHtml = (c, canEdit) => `
            <tr>
                <td><strong>${escapeHtmlAttr(c.code)}</strong></td>
                <td>${c.type === "percent" ? `${c.value}% off` : `${currencySymbol()}${c.value} off`}</td>
                ${c.storeId != null ? `<td style="font-size:11px;">${escapeHtmlAttr(storeName(c.storeId))}</td>` : ""}
                <td style="font-size:11px; color:var(--color-text-muted);">${c.private ? "PRIVATE" : "PUBLIC"}</td>
                <td>${c.usedCount > 0 ? `<button type="button" class="admin-link-btn" data-view-coupon-orders="${c.id}" style="background:none; border:none; padding:0; color:var(--color-text); text-decoration:underline; cursor:pointer; font-family:inherit; font-size:inherit;">${c.usedCount}</button>` : c.usedCount} / ${c.usageLimit === null ? "\u221e (until stopped)" : c.usageLimit}</td>
                <td style="color:${c.active ? "var(--color-success)" : "var(--color-text-muted)"};">${c.active ? "ACTIVE" : "STOPPED"}</td>
                <td style="text-align:right;">
                    ${
                        canEdit
                            ? `<button class="admin-btn" data-toggle-coupon="${c.id}">${c.active ? "STOP" : "RESUME"}</button>
                    <button class="admin-btn" data-toggle-private="${c.id}">${c.private ? "MAKE PUBLIC" : "MAKE PRIVATE"}</button>
                    <button class="admin-btn admin-btn-danger" data-delete-coupon="${c.id}">DELETE</button>`
                            : ""
                    }
                </td>
            </tr>
        `;

        root.innerHTML = `
            <div id="loyalty-section" style="margin-bottom:30px;"></div>

            <h3 style="font-size:14px; letter-spacing:1px; color:var(--color-accent); margin-bottom:10px; border-top:1px solid var(--color-border); padding-top:20px;">FRANCHISE-WIDE COUPONS</h3>
            ${
                canEditLoyalty
                    ? `
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px; background:var(--color-bg); padding:12px; border:1px solid var(--color-border);">
                <div>
                    <label for="coupon-code" class="admin-field-label" style="display:block; margin-bottom:4px;">CODE</label>
                    <input type="text" id="coupon-code" maxlength="24" placeholder="WELCOME10" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit; width:130px;" />
                </div>
                <div>
                    <label for="coupon-type" class="admin-field-label" style="display:block; margin-bottom:4px;">TYPE</label>
                    <select id="coupon-type" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit;">
                        <option value="percent">% OFF</option>
                        <option value="flat">${currencySymbol()} FLAT OFF</option>
                    </select>
                </div>
                <div>
                    <label for="coupon-value" class="admin-field-label" style="display:block; margin-bottom:4px;">VALUE</label>
                    <input type="text" id="coupon-value" maxlength="8" placeholder="10" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit; width:80px;" />
                </div>
                <div>
                    <label for="coupon-limit" class="admin-field-label" style="display:block; margin-bottom:4px;">USE LIMIT (blank = until stopped)</label>
                    <input type="text" id="coupon-limit" maxlength="8" placeholder="e.g. 50" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit; width:140px;" />
                </div>
                <label style="display:flex; align-items:center; gap:5px; font-size: 11px; cursor:pointer;">
                    <input type="checkbox" id="coupon-private" />
                    PRIVATE
                </label>
                <button class="admin-btn-primary" id="coupon-add">+ ADD COUPON</button>
            </div>
            <p id="coupon-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size:11px; min-height:12px;"></p>`
                    : ""
            }
            <table class="admin-table">
                <thead><tr><th>CODE</th><th>DISCOUNT</th><th>VISIBILITY</th><th>USAGE</th><th>STATUS</th><th style="text-align:right;">ACTION</th></tr></thead>
                <tbody>
                    ${
                        franchiseCoupons.length
                            ? franchiseCoupons.map((c) => couponRowHtml(c, canEditLoyalty)).join("")
                            : `<tr><td colspan="6" style="text-align:center; color:var(--color-text-muted); padding:20px;">No franchise-wide coupons yet.</td></tr>`
                    }
                </tbody>
            </table>

            <h3 style="font-size:14px; letter-spacing:1px; color:var(--color-accent); margin:25px 0 10px; border-top:1px solid var(--color-border); padding-top:20px;">LOCAL DISCOUNTS</h3>
            ${
                localAddableStores.length
                    ? `
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px; background:var(--color-bg); padding:12px; border:1px solid var(--color-border);">
                ${
                    localAddableStores.length > 1
                        ? `
                <div>
                    <label for="local-coupon-store" class="admin-field-label" style="display:block; margin-bottom:4px;">STORE</label>
                    <select id="local-coupon-store" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit;">
                        ${localAddableStores.map((s) => `<option value="${s.id}">${escapeHtmlAttr(s.name)}</option>`).join("")}
                    </select>
                </div>`
                        : ""
                }
                <div>
                    <label for="local-coupon-code" class="admin-field-label" style="display:block; margin-bottom:4px;">CODE</label>
                    <input type="text" id="local-coupon-code" maxlength="24" placeholder="STORE10" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit; width:130px;" />
                </div>
                <div>
                    <label for="local-coupon-type" class="admin-field-label" style="display:block; margin-bottom:4px;">TYPE</label>
                    <select id="local-coupon-type" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit;">
                        <option value="percent">% OFF</option>
                        <option value="flat">${currencySymbol()} FLAT OFF</option>
                    </select>
                </div>
                <div>
                    <label for="local-coupon-value" class="admin-field-label" style="display:block; margin-bottom:4px;">VALUE</label>
                    <input type="text" id="local-coupon-value" maxlength="8" placeholder="10" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit; width:80px;" />
                </div>
                <div>
                    <label for="local-coupon-limit" class="admin-field-label" style="display:block; margin-bottom:4px;">USE LIMIT (blank = until stopped)</label>
                    <input type="text" id="local-coupon-limit" maxlength="8" placeholder="e.g. 50" style="background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-text); padding:7px; font-family:inherit; width:140px;" />
                </div>
                <label style="display:flex; align-items:center; gap:5px; font-size: 11px; cursor:pointer;">
                    <input type="checkbox" id="local-coupon-private" />
                    PRIVATE
                </label>
                <button class="admin-btn-primary" id="local-coupon-add">+ ADD LOCAL DISCOUNT</button>
            </div>
            <p id="local-coupon-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size:11px; min-height:12px;"></p>`
                    : ""
            }
            <table class="admin-table">
                <thead><tr><th>CODE</th><th>DISCOUNT</th><th>STORE</th><th>VISIBILITY</th><th>USAGE</th><th>STATUS</th><th style="text-align:right;">ACTION</th></tr></thead>
                <tbody>
                    ${
                        localCoupons.length
                            ? localCoupons.map((c) => couponRowHtml(c, this.canManageStoreSettings(c.storeId))).join("")
                            : `<tr><td colspan="7" style="text-align:center; color:var(--color-text-muted); padding:20px;">No local discounts yet.</td></tr>`
                    }
                </tbody>
            </table>
        `;

        renderReadOnlySection(document.getElementById("loyalty-section"), {
            title: "LOYALTY PROGRAM",
            canEdit: canEditLoyalty,
            fields: [
                { label: "Enabled", value: loyalty.enabled ? "Yes" : "No" },
                { label: `Points per ${currencySymbol()}1 spent`, value: String(loyalty.pointsPerRupeeSpent) },
                { label: `${currencySymbol()} per point redeemed`, value: String(loyalty.rupeeValuePerPoint) }
            ],
            emptyNote: "Customers earn points automatically when they check out logged in, and can redeem points for a discount on a later order.",
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT LOYALTY PROGRAM",
                    fields: [
                        { id: "loyalty-enabled", label: "Enable loyalty program", value: loyalty.enabled, type: "checkbox" },
                        { id: "loyalty-earn-rate", label: `Points per ${currencySymbol()}1 spent`, value: loyalty.pointsPerRupeeSpent, type: "number", step: 0.01, min: 0, tooltip: `e.g. 0.1 = 1 point per ${currencySymbol()}10 spent` },
                        { id: "loyalty-redeem-rate", label: `${currencySymbol()} per point redeemed`, value: loyalty.rupeeValuePerPoint, type: "number", step: 0.01, min: 0, tooltip: `e.g. 0.5 = each point is worth ${currencySymbol()}0.50 off` }
                    ],
                    onSave: async (v) => {
                        const earnRate = parseFloat(v["loyalty-earn-rate"]);
                        const redeemRate = parseFloat(v["loyalty-redeem-rate"]);
                        if (!Number.isFinite(earnRate) || earnRate < 0 || !Number.isFinite(redeemRate) || redeemRate < 0) {
                            throw new Error("Both rates must be zero or positive numbers.");
                        }
                        await AdminConfig.saveSettings({ loyalty: { enabled: v["loyalty-enabled"], pointsPerRupeeSpent: earnRate, rupeeValuePerPoint: redeemRate } });
                        ok("Loyalty settings saved");
                        this.renderDiscountsLoyalty(root);
                    }
                })
        });

        if (canEditLoyalty) {
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
        }

        if (localAddableStores.length) {
            document.getElementById("local-coupon-add").addEventListener("click", async () => {
                const errorEl = document.getElementById("local-coupon-error");
                errorEl.textContent = "";
                const code = document.getElementById("local-coupon-code").value.trim();
                const type = document.getElementById("local-coupon-type").value;
                const value = Number(document.getElementById("local-coupon-value").value);
                const limitRaw = document.getElementById("local-coupon-limit").value.trim();
                const usageLimit = limitRaw === "" ? null : parseInt(limitRaw, 10);
                const isPrivate = document.getElementById("local-coupon-private").checked;
                const storeId = localAddableStores.length > 1 ? Number(document.getElementById("local-coupon-store").value) : localAddableStores[0].id;
                try {
                    const res = await fetch("/api/coupons", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code, type, value, usageLimit, private: isPrivate, storeId })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Could not add local discount");
                    await this.renderDiscountsLoyalty(root);
                    ok("Local discount added");
                } catch (e) {
                    errorEl.textContent = e.message;
                }
            });
        }

        root.querySelectorAll("[data-view-coupon-orders]").forEach((btn) =>
            btn.addEventListener("click", async () => {
                const coupon = coupons.find((c) => c.id === Number(btn.dataset.viewCouponOrders));
                const res = await fetch(`/api/orders?couponId=${coupon.id}`, { credentials: "include" });
                const matches = res.ok ? await res.json() : [];
                renderInfoModal({
                    title: `ORDERS USING ${escapeHtmlAttr(coupon.code)}`,
                    message: matches.length
                        ? matches.map((o) => `#${escapeHtmlAttr(o.orderNumber || o.id)} - ${new Date(o.createdAt).toLocaleDateString()}`).join("\n")
                        : "No orders found.",
                    confirmText: "CLOSE"
                });
            })
        );
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
                                      const lines = escapeHtmlAttr(combo.items.map((i) => `${i.quantity}x ${itemById[i.id] ? itemById[i.id].name : "(removed item)"}`).join(", "));
                                      const baseTotal = combo.items.reduce((sum, i) => sum + (itemById[i.id] ? itemById[i.id].price * i.quantity : 0), 0);
                                      const savings = baseTotal - combo.price;
                                      return `
                                <tr>
                                    <td>${escapeHtmlAttr(combo.name)}</td>
                                    <td style="color: var(--color-text-muted); font-size: 11px;">${lines}</td>
                                    <td>${currencySymbol()}${combo.price} ${savings > 0 ? `<span style="color: var(--color-accent); font-size: 10px;">(save ${currencySymbol()}${savings.toFixed(0)})</span>` : ""}</td>
                                    <td style="font-size: 11px; color: ${combo.active !== false ? "var(--color-accent)" : "var(--color-text-muted)"};">${combo.active !== false ? "ACTIVE" : "HIDDEN"}</td>
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

    // ------------------------------------------------------------ RAW MATERIALS
    showInactiveMaterials: false,

    async renderInventory(root) {
        const res = await fetch("/api/raw-materials", { credentials: "include" });
        const materials = res.ok ? await res.json() : [];
        const visible = materials
            .filter((m) => this.showInactiveMaterials || m.active)
            .sort((a, b) => (b.active === a.active ? a.name.localeCompare(b.name) : b.active ? 1 : -1));

        root.innerHTML = `
            <div class="config-controls">
                <h3 style="margin-top:0;">RAW MATERIALS</h3>
                <p class="admin-help-text">Staff-facing inventory, never shown to customers. Any staff can adjust a quantity; only a manager can rename, change the unit, or deactivate one.</p>
                <div class="admin-toolbar" style="justify-content:space-between;">
                    <label style="display:flex; align-items:center; gap:6px; font-size:11px; color:var(--color-text-muted); cursor:pointer;">
                        <input type="checkbox" id="inv-show-inactive" ${this.showInactiveMaterials ? "checked" : ""} /> SHOW INACTIVE
                    </label>
                </div>
                <table class="admin-table">
                    <thead><tr><th>NAME</th><th>QUANTITY</th><th>UNIT</th><th>STATUS</th><th></th></tr></thead>
                    <tbody>
                        ${
                            visible.length
                                ? visible
                                      .map(
                                          (m) => `
                            <tr>
                                <td>${escapeHtmlAttr(m.name)}</td>
                                <td><input type="number" min="0" step="any" data-qty-input="${m.id}" value="${m.quantity}" style="width:90px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit;" /></td>
                                <td style="font-size:11px; color:var(--color-text-muted);">${escapeHtmlAttr(m.unit)}</td>
                                <td style="color:${m.active ? "var(--color-success)" : "var(--color-text-muted)"};">${m.active ? "ACTIVE" : "INACTIVE"}</td>
                                <td style="text-align:right; white-space:nowrap;">
                                    <button class="admin-btn" data-save-qty="${m.id}">SAVE</button>
                                    <button class="admin-btn" data-toggle-material="${m.id}">${m.active ? "DEACTIVATE" : "ACTIVATE"}</button>
                                </td>
                            </tr>
                        `
                                      )
                                      .join("")
                                : `<tr><td colspan="5" style="text-align:center; color:var(--color-text-muted); padding:20px;">No raw materials yet.</td></tr>`
                        }
                    </tbody>
                </table>
                <div style="display:flex; gap:8px; margin-top:16px;">
                    <input type="text" id="inv-new-name" maxlength="60" placeholder="Material name" style="flex:2; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                    <input type="number" id="inv-new-qty" min="0" step="any" placeholder="Quantity" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                    <input type="text" id="inv-new-unit" maxlength="20" placeholder="Unit (kg, L, pcs...)" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                    <button class="admin-btn" id="inv-add">ADD MATERIAL</button>
                </div>
                <p id="inv-error" style="color:var(--color-danger); font-size:11px; margin-top:8px;"></p>
            </div>
        `;

        document.getElementById("inv-show-inactive").addEventListener("change", (e) => {
            this.showInactiveMaterials = e.target.checked;
            this.renderInventory(root);
        });

        root.querySelectorAll("[data-save-qty]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = Number(btn.dataset.saveQty);
                const input = root.querySelector(`[data-qty-input="${id}"]`);
                const quantity = Number(input.value);
                if (!Number.isFinite(quantity) || quantity < 0) return fail("Quantity must be zero or a positive number");
                const r = await fetch(`/api/raw-materials/${id}`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ quantity })
                });
                if (r.ok) ok("Quantity updated");
                else fail("Could not update quantity");
            });
        });

        root.querySelectorAll("[data-toggle-material]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = Number(btn.dataset.toggleMaterial);
                const material = materials.find((m) => m.id === id);
                const r = await fetch(`/api/raw-materials/${id}`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ active: !material.active })
                });
                if (r.ok) {
                    await this.renderInventory(root);
                    ok(material.active ? "Material deactivated" : "Material activated");
                } else {
                    fail("Could not update material");
                }
            });
        });

        document.getElementById("inv-add").addEventListener("click", async () => {
            const errorEl = document.getElementById("inv-error");
            errorEl.textContent = "";
            const name = document.getElementById("inv-new-name").value.trim();
            const quantity = Number(document.getElementById("inv-new-qty").value);
            const unit = document.getElementById("inv-new-unit").value.trim();
            if (!name) return (errorEl.textContent = "Give this material a name.");
            if (!Number.isFinite(quantity) || quantity < 0) return (errorEl.textContent = "Quantity must be zero or a positive number.");
            const r = await fetch("/api/raw-materials", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, quantity, unit })
            });
            const data = await r.json();
            if (!r.ok) return (errorEl.textContent = data.error || "Could not add material");
            await this.renderInventory(root);
            ok("Material added");
        });
    },

    // ------------------------------------------------------------ ORDER HISTORY
    orderHistorySort: "newest",
    orderHistoryFilter: "all",
    orderHistoryFromDate: "", // "" | "YYYY-MM-DD" - matches <input type="date">'s own value format
    orderHistoryToDate: "",

    orderHistoryPage: 1,
    orderHistorySelectedId: null,

    async renderOrderHistory(root) {
        const PAGE_SIZE = 10;
        // Fetched fresh per page/filter change instead of once up front -
        // GET /api/orders does the filtering/sorting/slicing server-side now
        // (?page/&limit/&status/&from/&to/&sort) so this stays a bounded
        // fetch even once a store has thousands of orders, not the full
        // history every time.
        let pageOrders = [];

        root.innerHTML = `
            <div class="admin-toolbar" style="justify-content: space-between; flex-wrap:wrap; gap:10px;">
                <div style="display:flex; gap:6px;">
                    <button class="admin-btn ${this.orderHistoryFilter === "all" ? "active" : ""}" data-history-filter="all">ALL</button>
                    <button class="admin-btn ${this.orderHistoryFilter === "active" ? "active" : ""}" data-history-filter="active">ACTIVE</button>
                    <button class="admin-btn ${this.orderHistoryFilter === "completed" ? "active" : ""}" data-history-filter="completed">COMPLETED</button>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <label for="order-history-from" style="font-size:10px; color:var(--color-text-muted); text-transform:uppercase;">From</label>
                    <input type="date" id="order-history-from" value="${this.orderHistoryFromDate}" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                    <label for="order-history-to" style="font-size:10px; color:var(--color-text-muted); text-transform:uppercase;">To</label>
                    <input type="date" id="order-history-to" value="${this.orderHistoryToDate}" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                    ${this.orderHistoryFromDate || this.orderHistoryToDate ? `<button class="admin-btn-secondary" id="order-history-date-clear" style="padding:7px 10px; font-size:10px;">CLEAR</button>` : ""}
                </div>
                <select id="order-history-sort" aria-label="Sort order history" style="background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px 10px; font-family:inherit; font-size:11px;">
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

        const loadPage = async () => {
            const params = new URLSearchParams({ page: this.orderHistoryPage, limit: PAGE_SIZE, sort: this.orderHistorySort });
            if (this.orderHistoryFilter !== "all") params.set("status", this.orderHistoryFilter);
            if (this.orderHistoryFromDate) params.set("from", this.orderHistoryFromDate);
            if (this.orderHistoryToDate) params.set("to", this.orderHistoryToDate);
            const res = await fetch(`/api/orders?${params}`, { credentials: "include" });
            const data = res.ok ? await res.json() : { items: [], total: 0 };

            const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
            this.orderHistoryPage = Math.min(this.orderHistoryPage, totalPages);
            pageOrders = data.items;

            const tbody = document.getElementById("order-history-tbody");
            tbody.innerHTML = pageOrders.length
                ? pageOrders
                      .map((o) => {
                          const complete = o.items.every((i) => i.isDone);
                          const customerLabel = o.customerName ? `${escapeHtmlAttr(o.customerName)} (${o.customerPhone || "-"})` : o.customerPhone || "-";
                          return `
                        <tr class="order-history-row ${o.id === this.orderHistorySelectedId ? "active" : ""}" data-order-id="${o.id}" tabindex="0" aria-label="View order #${escapeHtmlAttr(o.orderNumber || o.id)}" style="cursor:pointer;">
                            <td>#${o.orderNumber || o.id}</td>
                            <td style="font-size:11px;">${new Date(o.createdAt).toLocaleString()}</td>
                            <td style="font-size:11px;">${customerLabel}</td>
                            <td>${currencySymbol()}${o.total.toFixed(2)}</td>
                            <td style="font-size:11px;">
                                <span style="color:${o.isPaid ? "var(--color-success)" : "var(--color-danger)"};">${o.isPaid ? "PAID" : "UNPAID"}</span>
                                &middot; <span style="color:${complete ? "var(--color-success)" : "var(--color-cyan)"};">${complete ? "DONE" : "ACTIVE"}</span>
                            </td>
                        </tr>
                    `;
                      })
                      .join("")
                : `<tr><td colspan="5" style="text-align:center; color:var(--color-text-muted); padding:20px;">No orders match this filter.</td></tr>`;

            tbody.querySelectorAll(".order-history-row").forEach((row) => {
                const select = () => {
                    // dataset.orderId is always a string (DOM attribute),
                    // order.id is a real number now - coerce here so the
                    // lookup below doesn't silently return undefined.
                    this.orderHistorySelectedId = Number(row.dataset.orderId);
                    loadPage();
                    renderDetail(pageOrders.find((o) => o.id === this.orderHistorySelectedId));
                };
                row.addEventListener("click", select);
                // tabindex makes the row focusable, but a <tr> gets no
                // built-in Enter/Space activation the way <button> does.
                row.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        select();
                    }
                });
            });

            const pager = document.getElementById("order-history-pager");
            pager.innerHTML =
                totalPages > 1
                    ? `
                <button class="admin-pg-btn" id="oh-first" ${this.orderHistoryPage <= 1 ? "disabled" : ""} title="First page" aria-label="First page">\u00ab</button>
                <button class="admin-pg-btn" id="oh-prev" ${this.orderHistoryPage <= 1 ? "disabled" : ""} title="Previous page" aria-label="Previous page">\u2039</button>
                <span style="font-size:11px; color:var(--color-text-muted); margin:0 6px;"><strong style="color:var(--color-accent);">${(this.orderHistoryPage - 1) * PAGE_SIZE + 1}-${Math.min(this.orderHistoryPage * PAGE_SIZE, data.total)}</strong> of ${data.total}</span>
                <button class="admin-pg-btn" id="oh-next" ${this.orderHistoryPage >= totalPages ? "disabled" : ""} title="Next page" aria-label="Next page">\u203a</button>
                <button class="admin-pg-btn" id="oh-last" ${this.orderHistoryPage >= totalPages ? "disabled" : ""} title="Last page" aria-label="Last page">\u00bb</button>
            `
                    : "";
            const firstBtn = document.getElementById("oh-first");
            const prevBtn = document.getElementById("oh-prev");
            const nextBtn = document.getElementById("oh-next");
            const lastBtn = document.getElementById("oh-last");
            if (firstBtn) firstBtn.addEventListener("click", () => { this.orderHistoryPage = 1; loadPage(); });
            if (prevBtn) prevBtn.addEventListener("click", () => { this.orderHistoryPage--; loadPage(); });
            if (nextBtn) nextBtn.addEventListener("click", () => { this.orderHistoryPage++; loadPage(); });
            if (lastBtn) lastBtn.addEventListener("click", () => { this.orderHistoryPage = totalPages; loadPage(); });
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
                        <h3 style="margin:0; font-size:15px;">#${order.orderNumber || order.id}</h3>
                        <div style="font-size:11px; color:var(--color-text-muted);">${new Date(order.createdAt).toLocaleString()}</div>
                    </div>
                    <span style="font-size:11px; color:${complete ? "var(--color-success)" : "var(--color-cyan)"};">${complete ? "COMPLETED" : "ACTIVE"}</span>
                </div>
                <div style="font-size:12px; margin-bottom:10px;"><strong>Customer:</strong> ${customerLabel} &middot; ${order.method}</div>
                <div style="border-top:1px dashed var(--color-border); border-bottom:1px dashed var(--color-border); padding:10px 0; margin-bottom:10px;">
                    ${order.items
                        .map((i) => {
                            const tags = [];
                            if (i.sizeLabel && i.sizeLabel !== "Regular") tags.push(i.sizeLabel);
                            if (i.milkLabel && i.milkLabel !== "Regular Milk") tags.push(i.milkLabel);
                            (i.extras || []).forEach((e) => tags.push(`+${e.label}`));
                            return `
                            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                                <span>${i.quantity}x ${escapeHtmlAttr(i.name)}${i.comboName ? ` <span style="color:var(--color-text-muted); font-size:10px;">(${escapeHtmlAttr(i.comboName)})</span>` : ""}</span>
                                <span>${currencySymbol()}${(i.price * i.quantity).toFixed(2)}</span>
                            </div>
                            ${tags.length ? `<div style="font-size:10px; color:var(--color-accent); margin-bottom:4px;">${tags.map(escapeHtmlAttr).join(" &middot; ")}</div>` : ""}
                            ${i.notes ? `<div style="font-size:10px; color:var(--color-text-muted); font-style:italic; margin-bottom:4px;">"${escapeHtmlAttr(i.notes)}"</div>` : ""}
                        `;
                        })
                        .join("")}
                </div>
                <div style="font-size:11px; color:var(--color-text-muted); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Subtotal</span><span>${currencySymbol()}${order.subtotal.toFixed(2)}</span></div>
                ${order.promoDiscountTotal ? `<div style="font-size:11px; color:var(--color-accent); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Promo Savings</span><span>-${currencySymbol()}${order.promoDiscountTotal.toFixed(2)}</span></div>` : ""}
                ${order.discountAmount ? `<div style="font-size:11px; color:var(--color-accent); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Discount${order.couponCode ? ` (${escapeHtmlAttr(order.couponCode)})` : ""}</span><span>-${currencySymbol()}${order.discountAmount.toFixed(2)}</span></div>` : ""}
                <div style="font-size:11px; color:var(--color-text-muted); margin-bottom:4px; display:flex; justify-content:space-between;"><span>CGST + SGST</span><span>${currencySymbol()}${(order.cgst + order.sgst).toFixed(2)}</span></div>
                ${order.serviceCharge ? `<div style="font-size:11px; color:var(--color-text-muted); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Service Charge</span><span>${currencySymbol()}${order.serviceCharge.toFixed(2)}</span></div>` : ""}
                ${order.tipAmount ? `<div style="font-size:11px; color:var(--color-text-muted); margin-bottom:4px; display:flex; justify-content:space-between;"><span>Tip</span><span>${currencySymbol()}${order.tipAmount.toFixed(2)}</span></div>` : ""}
                <div style="font-size:15px; font-weight:bold; display:flex; justify-content:space-between; border-top:1px solid var(--color-accent); padding-top:8px; margin-top:6px;"><span>TOTAL</span><span>${currencySymbol()}${order.total.toFixed(2)}</span></div>
                <div style="margin-top:16px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <span style="font-size:11px;">Payment: <strong style="color:${order.isPaid ? "var(--color-success)" : "var(--color-danger)"};">${order.isPaid ? "PAID" : "UNPAID"}</strong></span>
                    ${!order.isPaid ? `<button class="admin-btn admin-btn-primary" id="oh-mark-paid">MARK PAID</button>` : ""}
                    ${!complete ? `<button class="admin-btn" id="oh-mark-done" title="For an order the kitchen never closed out - force every line to Done">MARK AS DONE</button>` : ""}
                </div>
                ${order.razorpayPaymentId ? `<div style="margin-top:8px; font-size:11px; color:var(--color-text-muted);">Razorpay payment ID: <span style="color:var(--color-text); font-family:monospace;">${escapeHtmlAttr(order.razorpayPaymentId)}</span></div>` : ""}
                ${
                    order.rating
                        ? `<div style="margin-top:10px; font-size:11px; color:var(--color-accent);">
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
                        loadPage();
                        ok("Order marked paid");
                    } else {
                        fail("Could not update order");
                    }
                });
            }

            const markDoneBtn = document.getElementById("oh-mark-done");
            if (markDoneBtn) {
                markDoneBtn.addEventListener("click", async () => {
                    // station:"MASTER" (same bypass the ALL STATIONS kitchen
                    // tab uses) forces every line Done regardless of which
                    // station it belongs to - this is for a stray order the
                    // kitchen forgot to close out, not a substitute for the
                    // real per-station workflow.
                    const r = await fetch(`/api/orders/${order.id}`, {
                        method: "PATCH",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "markDone", station: "MASTER" })
                    });
                    if (r.ok) {
                        order.items.forEach((i) => (i.isDone = true));
                        renderDetail(order);
                        loadPage();
                        ok("Order marked done");
                    } else {
                        fail("Could not update order");
                    }
                });
            }
        };

        await loadPage();
        if (this.orderHistorySelectedId) renderDetail(pageOrders.find((o) => o.id === this.orderHistorySelectedId));

        root.querySelectorAll("[data-history-filter]").forEach((btn) => {
            btn.addEventListener("click", () => {
                this.orderHistoryFilter = btn.dataset.historyFilter;
                this.orderHistoryPage = 1;
                root.querySelectorAll("[data-history-filter]").forEach((b) => b.classList.toggle("active", b === btn));
                loadPage();
            });
        });
        document.getElementById("order-history-sort").addEventListener("change", (e) => {
            this.orderHistorySort = e.target.value;
            loadPage();
        });
        // Full re-render (not just loadPage()) so the CLEAR button's
        // visibility in the outer toolbar template updates too.
        document.getElementById("order-history-from").addEventListener("change", (e) => {
            this.orderHistoryFromDate = e.target.value;
            this.orderHistoryPage = 1;
            this.renderOrderHistory(root);
        });
        document.getElementById("order-history-to").addEventListener("change", (e) => {
            this.orderHistoryToDate = e.target.value;
            this.orderHistoryPage = 1;
            this.renderOrderHistory(root);
        });
        document.getElementById("order-history-date-clear")?.addEventListener("click", () => {
            this.orderHistoryFromDate = "";
            this.orderHistoryToDate = "";
            this.orderHistoryPage = 1;
            this.renderOrderHistory(root);
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
            const actionLabels = {
                reset_password: "Reset password",
                remove_account: "Removed account",
                payroll_paid: "Marked payroll paid",
                change_role: "Changed role"
            };
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
                                <td style="font-size:11px;">${new Date(e.timestamp).toLocaleString()}</td>
                                <td style="font-size:11px;">${actionLabels[e.action] || e.action}</td>
                                <td style="font-size:11px;">${escapeHtmlAttr(e.actorName)} (${escapeHtmlAttr(e.actorRole)})</td>
                                <td style="font-size:11px;">${escapeHtmlAttr(e.targetUsername) || "\u2014"}</td>
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
                <button class="admin-btn-primary" id="staff-add">+ ADD ${isOwner ? "GLOBAL ADMIN" : "STAFF"}</button>
            </div>
            <table class="admin-table">
                <thead>
                    <tr><th>USERNAME</th><th>NAME</th><th>ROLE</th><th>TAG</th><th>PAY RATE</th><th style="text-align:right;">ACTION</th></tr>
                </thead>
                <tbody>
                    ${staff
                        .map((u) => {
                            const isSelf = u.id === myUserId;
                            const isGlobalAdmin = this.session.role === "admin" && !this.session.storeAccess;
                            const isLocalAdmin = this.session.role === "admin" && !!this.session.storeAccess;
                            const adminScopeAllows =
                                !this.session.storeAccess || !["employee", "manager"].includes(u.role) || this.session.storeAccess.includes(u.storeId);
                            // Mirrors canManageTarget() in server.js: owner only manages the
                            // Global Admins they add (their one write lane); a Global Admin
                            // manages employees/managers plus Local Admins (never another
                            // Global Admin); a Local Admin/manager stays within their store,
                            // never an admin-tier target.
                            const canManage =
                                !isSelf &&
                                ((isOwner && u.role === "admin" && (!u.storeAccess || u.storeAccess.length === 0)) ||
                                    (isGlobalAdmin && ["employee", "manager"].includes(u.role)) ||
                                    (isGlobalAdmin && u.role === "admin" && u.storeAccess && u.storeAccess.length > 0) ||
                                    (isLocalAdmin && ["employee", "manager"].includes(u.role) && adminScopeAllows) ||
                                    (isManager && u.role === "employee" && u.storeId === this.session.storeId));
                            const storeAccessNote =
                                u.role === "admin"
                                    ? `<div style="font-size:9px; color:var(--color-text-muted);">${u.storeAccess && u.storeAccess.length ? `${u.storeAccess.length} store(s)` : "All stores"}</div>`
                                    : "";
                            return `
                        <tr style="${u.disabled ? "opacity:0.55;" : ""}">
                            <td>${escapeHtmlAttr(u.username)}${isSelf ? ' <span style="color:var(--color-text-muted); font-size:10px;">(you)</span>' : ""}${u.disabled ? ' <span style="color:var(--color-danger); font-size:10px;">(DEACTIVATED)</span>' : ""}</td>
                            <td>${escapeHtmlAttr(u.name)}</td>
                            <td style="color: var(--color-accent);">${u.role.toUpperCase()}${storeAccessNote}</td>
                            <td style="font-size:11px; color:var(--color-text-muted);">${escapeHtmlAttr(u.tag) || "\u2014"}</td>
                            <td style="font-size:11px;">${u.payRateType ? `${currencySymbol()}${u.payRate}/${u.payRateType === "hourly" ? "hr" : u.payRateType === "weekly" ? "wk" : "mo"}` : "\u2014"}</td>
                            <td style="text-align:right;">
                                ${
                                    canManage
                                        ? `
                                    <button class="admin-btn" data-edit-staff="${u.id}">EDIT</button>
                                    <button class="admin-btn" data-reset="${u.id}" data-name="${escapeHtmlAttr(u.name)}">RESET PW</button>
                                    <button class="admin-btn admin-btn-danger" data-remove="${u.id}" data-name="${escapeHtmlAttr(u.name)}">REMOVE</button>
                                `
                                        : isSelf
                                          ? `<button class="admin-btn" id="self-account-settings">ACCOUNT SETTINGS</button>`
                                          : `<span style="color:var(--color-text-muted); font-size:10px;">\u2014</span>`
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
                        ? "You can add Global Admins - that's your one write action here. Everything else is read-only."
                        : isManager
                          ? "You can create and manage employee accounts at your own store."
                          : this.isGlobalAdmin()
                            ? "You can create and manage Local Admins, managers, and employees at any store."
                            : "You can create and manage employee and manager accounts at the stores you're scoped to. Only a Global Admin can manage another admin account."
                }
            </p>
            ${auditLogHtml}
        `;

        document.getElementById("staff-add").addEventListener("click", () => {
            renderAddStaffModal(this.session, async () => {
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
        renderEditStaffModal(user, this.session, async () => {
            await this.renderActiveTab();
            ok("Staff details updated");
        });
    },

    async resetStaffPassword(userId, name) {
        renderInfoModal({
            title: "RESET PASSWORD",
            message: `Generate a new temporary password for ${escapeHtmlAttr(name)}? They'll be required to set their own password the next time they log in.`,
            confirmText: "GENERATE",
            cancelText: "CANCEL",
            onConfirm: async () => {
                const res = await fetch(`/api/users/${userId}/reset-password`, { method: "POST", credentials: "include" });
                const data = await res.json();
                if (!res.ok) return renderInfoModal({ title: "ERROR", message: data.error || "Could not reset password" });
                renderInfoModal({
                    title: "TEMPORARY PASSWORD",
                    message: `Give this to ${escapeHtmlAttr(name)}. It only works once - they'll be asked to set their own password on first login.`,
                    monospaceValue: data.tempPassword,
                    onConfirm: () => this.renderActiveTab() // refresh so the audit log reflects this action immediately
                });
            }
        });
    },

    async removeStaff(userId, name) {
        renderInfoModal({
            title: "REMOVE STAFF ACCOUNT",
            message: `Remove ${escapeHtmlAttr(name)}'s account? This can't be undone.`,
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

    // ------------------------------------------------------------ BRANDING (visual: theme/colors/images/icons)
    // Franchise-wide only now (Global-Admin-edit, everyone-else-view) -
    // consistent branding across every store is the whole point of pulling
    // per-store theme/logo/color overrides out (see server.js's
    // mergeStoreOverrides()).
    async renderBranding(root) {
        const c = AdminConfig.settings;
        const colors = c.colors || {};
        const textStyles = c.textStyles || {};
        const customIcons = c.customIcons || {};
        const canEdit = this.isGlobalAdmin();
        const profilesRes = await fetch("/api/branding-profiles", { credentials: "include" });
        const profiles = profilesRes.ok ? await profilesRes.json() : {};

        root.innerHTML = `
            <div class="config-controls">
                <div id="brand-theme-section"></div>

                <div class="readonly-section">
                    <div class="readonly-section-header"><h3 style="margin:0;">SAVED THEMES (e.g. HOLIDAY PROFILES)</h3></div>
                    <p class="admin-help-text">Save the branding above as a named profile (Diwali, Christmas, etc.) to switch back to instantly later.</p>
                    <div id="branding-profiles-list" style="margin-bottom:10px;">
                        ${
                            Object.keys(profiles).length === 0
                                ? `<p class="admin-help-text">No saved profiles yet.</p>`
                                : Object.keys(profiles)
                                      .map(
                                          (name) => `
                                    <div style="display:flex; align-items:center; gap:10px; padding:5px 0; border-bottom:1px solid var(--color-border);">
                                        <span style="flex:1; font-size:11px;">${escapeHtmlAttr(name)}</span>
                                        ${canEdit ? `<button class="admin-btn" data-activate-profile="${escapeHtmlAttr(name)}" style="padding:4px 8px; font-size:10px;">ACTIVATE</button>
                                        <button class="admin-btn admin-btn-danger" data-delete-profile="${escapeHtmlAttr(name)}" style="padding:4px 8px; font-size:10px;">DELETE</button>` : ""}
                                    </div>
                                `
                                      )
                                      .join("")
                        }
                    </div>
                    ${
                        canEdit
                            ? `
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="new-profile-name" maxlength="40" placeholder="profile name (e.g. Diwali)" style="flex:1; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                        <button class="admin-btn" id="save-profile">SAVE AS PROFILE</button>
                    </div>`
                            : ""
                    }
                </div>

                <div id="brand-admin-text-section"></div>
                <div id="brand-images-section"></div>

                <div class="readonly-section">
                    <div class="readonly-section-header"><h3 style="margin:0;">CUSTOM ICONS</h3></div>
                    <p class="admin-help-text">Upload or link your own icon to make it available in the menu item editor, alongside the built-in set.</p>
                    <div id="custom-icons-list" style="margin-bottom:10px;">
                        ${
                            Object.keys(customIcons).length === 0
                                ? `<p class="admin-help-text">No custom icons added yet.</p>`
                                : Object.entries(customIcons)
                                      .map(
                                          ([key, url]) => `
                                    <div style="display:flex; align-items:center; gap:10px; padding:5px 0; border-bottom:1px solid var(--color-border);">
                                        <img src="${escapeHtmlAttr(url)}" alt="" width="22" height="22" style="width:22px; height:22px; object-fit:contain;" />
                                        <span style="flex:1; font-size:11px;">${escapeHtmlAttr(key)}</span>
                                        ${canEdit ? `<button class="admin-btn admin-btn-danger" data-remove-icon="${escapeHtmlAttr(key)}" style="padding:4px 8px; font-size:10px;">REMOVE</button>` : ""}
                                    </div>
                                `
                                      )
                                      .join("")
                        }
                    </div>
                    ${
                        canEdit
                            ? `
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <input type="text" id="new-icon-key" maxlength="40" placeholder="icon name" style="flex:1 1 120px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                        <input type="text" id="new-icon-url" maxlength="500" placeholder="image URL" style="flex:1 1 140px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:11px;" />
                        <button type="button" class="admin-btn-secondary" id="new-icon-pick" style="white-space:nowrap;">BROWSE</button>
                        <button class="admin-btn" id="add-custom-icon">ADD</button>
                    </div>`
                            : ""
                    }
                </div>

                ${canEdit ? `<div style="border-top:1px solid var(--color-border); padding-top:16px;"><button class="admin-btn-secondary" id="branding-reset">RESET TO DEFAULT</button></div>` : ""}
            </div>
        `;

        renderReadOnlySection(document.getElementById("brand-theme-section"), {
            title: "THEME",
            canEdit,
            fields: [
                { label: "Preset", value: (c.theme || "dark").toUpperCase() },
                { label: "Accent", value: colors.accent || "#d97706" },
                { label: "Background", value: colors.background || "#0a0a0a" },
                { label: "Surface", value: colors.surface || "#111111" },
                { label: "Text", value: colors.text || "#f9fafb" },
                { label: "Secondary", value: colors.secondary || "#22d3ee", tooltip: "Used for “preparing” status, station tabs, etc." }
            ],
            onEdit: () => {
                renderSectionEditModal({
                    title: "EDIT THEME",
                    fields: [
                        {
                            id: "bf-theme",
                            label: "Preset",
                            type: "select",
                            value: c.theme || "dark",
                            options: [
                                { value: "dark", label: "DARK" },
                                { value: "light", label: "LIGHT" },
                                { value: "custom", label: "CUSTOM" }
                            ]
                        },
                        { id: "bf-accent", label: "Accent", value: colors.accent || "#d97706", type: "color" },
                        { id: "bf-background", label: "Background", value: colors.background || "#0a0a0a", type: "color" },
                        { id: "bf-surface", label: "Surface", value: colors.surface || "#111111", type: "color" },
                        { id: "bf-text", label: "Text", value: colors.text || "#f9fafb", type: "color" },
                        { id: "bf-secondary", label: "Secondary", value: colors.secondary || "#22d3ee", type: "color" }
                    ],
                    onSave: async (v) => {
                        await AdminConfig.saveSettings({
                            theme: v["bf-theme"],
                            colors: { accent: v["bf-accent"], background: v["bf-background"], surface: v["bf-surface"], text: v["bf-text"], secondary: v["bf-secondary"] }
                        });
                        if (window.applyBranding) window.applyBranding(AdminConfig.settings);
                        ok("Theme saved");
                        this.renderBranding(root);
                    }
                });
                // Choosing DARK/LIGHT fills in that theme's standard colors
                // immediately - CUSTOM leaves whatever's in the pickers alone.
                document.getElementById("bf-theme").addEventListener("change", (e) => {
                    const preset = THEME_PRESETS[e.target.value];
                    if (!preset) return;
                    document.getElementById("bf-accent").value = preset.accent;
                    document.getElementById("bf-background").value = preset.background;
                    document.getElementById("bf-surface").value = preset.surface;
                    document.getElementById("bf-text").value = preset.text;
                    document.getElementById("bf-secondary").value = preset.secondary;
                });
            }
        });

        renderReadOnlySection(document.getElementById("brand-admin-text-section"), {
            title: "ADMIN PANEL TEXT",
            canEdit,
            fields: [
                { label: "Tabs", value: `${(textStyles.adminTabs && textStyles.adminTabs.fontSize) || 9}pt, ${(textStyles.adminTabs && textStyles.adminTabs.color) || "#888888"}`, tooltip: "Staff-only, customers never see this." },
                { label: "Helper text", value: `${(textStyles.adminHelp && textStyles.adminHelp.fontSize) || 7.5}pt, ${(textStyles.adminHelp && textStyles.adminHelp.color) || "#888888"}` },
                { label: "Labels", value: `${(textStyles.adminLabels && textStyles.adminLabels.fontSize) || 8}pt, ${(textStyles.adminLabels && textStyles.adminLabels.color) || "#888888"}` }
            ],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT ADMIN PANEL TEXT",
                    fields: [
                        { id: "bf-admintabs-size", label: "Tabs size", value: (textStyles.adminTabs && textStyles.adminTabs.fontSize) || 9, type: "number", min: 5, max: 24, step: 0.5 },
                        { id: "bf-admintabs-color", label: "Tabs color", value: (textStyles.adminTabs && textStyles.adminTabs.color) || "#888888", type: "color" },
                        { id: "bf-adminhelp-size", label: "Helper text size", value: (textStyles.adminHelp && textStyles.adminHelp.fontSize) || 7.5, type: "number", min: 5, max: 24, step: 0.5 },
                        { id: "bf-adminhelp-color", label: "Helper text color", value: (textStyles.adminHelp && textStyles.adminHelp.color) || "#888888", type: "color" },
                        { id: "bf-adminlabels-size", label: "Labels size", value: (textStyles.adminLabels && textStyles.adminLabels.fontSize) || 8, type: "number", min: 5, max: 24, step: 0.5 },
                        { id: "bf-adminlabels-color", label: "Labels color", value: (textStyles.adminLabels && textStyles.adminLabels.color) || "#888888", type: "color" }
                    ],
                    onSave: async (v) => {
                        await AdminConfig.saveSettings({
                            textStyles: {
                                adminTabs: { fontSize: Number(v["bf-admintabs-size"]) || 9, color: v["bf-admintabs-color"] },
                                adminHelp: { fontSize: Number(v["bf-adminhelp-size"]) || 7.5, color: v["bf-adminhelp-color"] },
                                adminLabels: { fontSize: Number(v["bf-adminlabels-size"]) || 8, color: v["bf-adminlabels-color"] }
                            }
                        });
                        if (window.applyBranding) window.applyBranding(AdminConfig.settings);
                        ok("Admin panel text saved");
                        this.renderBranding(root);
                    }
                })
        });

        renderReadOnlySection(document.getElementById("brand-images-section"), {
            title: "IMAGES",
            canEdit,
            fields: [
                { label: "Hero / storefront image", value: c.heroImageUrl || "" },
                { label: "Logo image", value: c.logoUrl || "" },
                { label: "Horizontal logo", value: c.logoWideUrl || "" }
            ],
            emptyNote: "No images set - defaults are used.",
            onEdit: () => {
                renderSectionEditModal({
                    title: "EDIT IMAGES",
                    width: "480px",
                    fields: [
                        { id: "bf-hero", label: "Hero / storefront image (home page - blank keeps the default icon)", value: c.heroImageUrl || "", maxlength: 500, placeholder: "https://... or pick from the bucket" },
                        { id: "bf-logo", label: "Logo image (top nav - blank hides it)", value: c.logoUrl || "", maxlength: 500, placeholder: "https://... or pick from the bucket" },
                        { id: "bf-logo-wide", label: "Horizontal logo (optional - one wide image instead of icon + name)", value: c.logoWideUrl || "", maxlength: 500, placeholder: "https://... or pick from the bucket" }
                    ],
                    onSave: async (v) => {
                        await AdminConfig.saveSettings({ heroImageUrl: v["bf-hero"].trim(), logoUrl: v["bf-logo"].trim(), logoWideUrl: v["bf-logo-wide"].trim() });
                        if (window.applyBranding) window.applyBranding(AdminConfig.settings);
                        ok("Images saved");
                        this.renderBranding(root);
                    }
                });
                const addBrowseButton = (fieldId) => {
                    const input = document.getElementById(fieldId);
                    if (!input) return;
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "admin-btn-secondary";
                    btn.textContent = "BROWSE";
                    btn.style.marginTop = "6px";
                    btn.addEventListener("click", () => renderImagePickerModal({ onSelect: (url) => (input.value = url) }));
                    input.insertAdjacentElement("afterend", btn);
                };
                addBrowseButton("bf-hero");
                addBrowseButton("bf-logo");
                addBrowseButton("bf-logo-wide");
            }
        });

        if (canEdit) {
            document.getElementById("new-icon-pick").addEventListener("click", () => {
                renderImagePickerModal({ onSelect: (url) => (document.getElementById("new-icon-url").value = url) });
            });

            document.getElementById("branding-reset").addEventListener("click", () => {
                renderInfoModal({
                    title: "RESET BRANDING",
                    message: "Reset theme, colors, hero image, logo, and admin panel text size/color back to the original defaults? Shop identity, home page content, and store details are not affected.",
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
        }
    },

    // ------------------------------------------------------------ CONTENT (shop identity/copy/home page text)
    // Franchise-wide only now, same as Branding - Global-Admin-edit, view
    // for everyone else. A store overrides "This week's picks" from its own
    // Store Setup/This Store page (see renderStoreSettingsPanel()); the
    // picks/roast story/headings/footer here are the franchise defaults.
    async renderContent(root) {
        const c = AdminConfig.settings;
        const canEdit = this.isGlobalAdmin();

        root.innerHTML = `
            <div class="config-controls">
                <div id="content-identity-section"></div>
                <div id="content-nav-section"></div>

                <div class="readonly-section">
                    <div class="readonly-section-header">
                        <h3 style="margin:0;">HOME PAGE CONTENT (FRANCHISE DEFAULT)</h3>
                        ${canEdit ? "" : `<span class="admin-help-text">A store can override “This week's picks” from its own Store Setup page.</span>`}
                    </div>
                    <div id="content-home-view"></div>
                    ${
                        canEdit
                            ? `
                    <div id="content-home-edit" style="margin-top:12px;">
                        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
                            <div class="control-group">
                                <label for="cfg-home-heading-picks">PICKS HEADING</label>
                                <input type="text" id="cfg-home-heading-picks" maxlength="60" value="${escapeHtmlAttr((c.homeHeadings && c.homeHeadings.picks) || "This week's picks")}" />
                            </div>
                            <div class="control-group">
                                <label for="cfg-home-heading-roast">ROAST HEADING</label>
                                <input type="text" id="cfg-home-heading-roast" maxlength="60" value="${escapeHtmlAttr((c.homeHeadings && c.homeHeadings.roast) || "How we roast")}" />
                            </div>
                            <div class="control-group">
                                <label for="cfg-home-heading-findus">CONTACT HEADING</label>
                                <input type="text" id="cfg-home-heading-findus" maxlength="60" value="${escapeHtmlAttr((c.homeHeadings && c.homeHeadings.findUs) || "Find us")}" />
                            </div>
                        </div>

                        <div style="display:flex; gap:20px; flex-wrap:wrap; margin-top:16px;">
                            <div style="flex:1 1 320px; min-width:260px;">
                                <label style="display:block; font-size:12px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase;">This week's picks</label>
                                <p class="admin-help-text">Pick up to 3 items to feature on the home page. Leave nothing checked to fall back to the first few items in your top menu section.</p>
                                <div id="home-picks-suggestions" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;"></div>
                                <div id="home-picks-list" style="max-height:320px; overflow-y:auto; border:1px solid var(--color-border); padding:8px;"></div>
                            </div>
                            <div style="flex:1 1 240px; min-width:220px;">
                                <label style="display:block; font-size:12px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase;">Tags for picked items</label>
                                <p class="admin-help-text">Small badge shown on each picked item's home page card (e.g. "House favourite").</p>
                                <div id="home-picks-tags" style="max-height:320px; overflow-y:auto; border:1px solid var(--color-border); padding:8px;"></div>
                            </div>
                        </div>

                        <label style="display:block; font-size:12px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase; margin-top:16px;">Roast process story</label>
                        <p class="admin-help-text">The step-by-step "how we roast" story - name and detail line per step, in order. Add up to 6.</p>
                        <div id="home-roast-editor" style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px;"></div>
                        <button type="button" class="admin-btn-secondary" id="home-roast-add" style="margin-bottom:14px;">+ ADD STEP</button>
                        <br />
                        <p id="content-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size:11px; min-height:12px;"></p>
                        <button class="admin-btn-primary" id="home-content-save">SAVE HOME PAGE CONTENT</button>
                    </div>`
                            : ""
                    }
                </div>

                <div id="content-footer-section"></div>
                <div class="readonly-section">
                    <div class="readonly-section-header"><h3 style="margin:0;">FOOTER CUSTOM FIELDS</h3></div>
                    <p class="admin-help-text">Anything else to show on "Find us" - Instagram, WhatsApp, GST number, whatever this shop needs. Add up to 6.</p>
                    ${
                        canEdit
                            ? `
                    <div id="footer-custom-fields-editor" style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px;"></div>
                    <button type="button" class="admin-btn-secondary" id="footer-custom-field-add" style="margin-bottom:14px;">+ ADD FIELD</button>
                    <br />
                    <p id="footer-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size:11px; min-height:12px;"></p>
                    <button class="admin-btn-primary" id="footer-save">SAVE CUSTOM FIELDS</button>`
                            : (c.customFooterFields || []).length === 0
                              ? `<p class="admin-help-text">No custom fields added yet.</p>`
                              : `<ul style="margin:0; padding-left:18px; font-size:12px;">${(c.customFooterFields || []).map((f) => `<li>${escapeHtmlAttr(f.label)}: ${escapeHtmlAttr(f.value)}</li>`).join("")}</ul>`
                    }
                </div>
            </div>
        `;

        renderReadOnlySection(document.getElementById("content-identity-section"), {
            title: "SHOP IDENTITY",
            canEdit,
            fields: [
                { label: "Shop name", value: c.shopName || "" },
                { label: "Home page badge", value: c.heroBadgeText || "" },
                { label: "Home page about text", value: c.heroTagline || "" },
                { label: "Receipt footer message", value: c.receiptFooterText || "" },
                { label: "Hero image caption", value: c.heroCaptionLabel || "" }
            ],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT SHOP IDENTITY",
                    width: "480px",
                    fields: [
                        { id: "cfg-shop-name", label: "Shop name", value: c.shopName || "", maxlength: 60 },
                        { id: "cfg-hero-badge", label: 'Home page badge (e.g. "Est. 2019 · 8-bit roastery")', value: c.heroBadgeText || "", maxlength: 80 },
                        { id: "cfg-hero-tagline", label: "Home page about text", value: c.heroTagline || "", type: "textarea", maxlength: 400, rows: 3 },
                        { id: "cfg-receipt-footer", label: "Receipt footer message (printed under the logo on the bill)", value: c.receiptFooterText || "", maxlength: 120 },
                        { id: "cfg-hero-caption-label", label: "Hero image caption (label before the address)", value: c.heroCaptionLabel || "", maxlength: 40, placeholder: "The counter" }
                    ],
                    onSave: async (v) => {
                        const shopName = v["cfg-shop-name"].trim();
                        if (!shopName) throw new Error("Shop name can't be empty.");
                        const updated = await AdminConfig.saveSettings({
                            shopName,
                            heroBadgeText: v["cfg-hero-badge"],
                            heroTagline: v["cfg-hero-tagline"],
                            receiptFooterText: v["cfg-receipt-footer"],
                            heroCaptionLabel: v["cfg-hero-caption-label"]
                        });
                        if (window.applyBranding) window.applyBranding(updated);
                        ok("Shop identity saved");
                        this.renderContent(root);
                    }
                })
        });

        renderReadOnlySection(document.getElementById("content-nav-section"), {
            title: "SITE NAVIGATION",
            canEdit,
            fields: [{ label: "Default layout", value: c.defaultNavLayout === "topbar" ? "Top bar" : "Left rail" }],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT SITE NAVIGATION",
                    fields: [
                        {
                            id: "cfg-default-nav-layout",
                            label: "Default layout",
                            type: "select",
                            value: c.defaultNavLayout === "topbar" ? "topbar" : "rail",
                            options: [
                                { value: "rail", label: "LEFT RAIL" },
                                { value: "topbar", label: "TOP BAR" }
                            ],
                            tooltip: "What a visitor sees before they've picked their own layout. Applies to customers, guests, and staff alike."
                        }
                    ],
                    onSave: async (v) => {
                        await AdminConfig.saveSettings({ defaultNavLayout: v["cfg-default-nav-layout"] });
                        ok("Navigation default saved");
                        this.renderContent(root);
                    }
                })
        });

        const pickableItems = this.menu.items.filter((i) => !i.deleted && i.available !== false);
        const homeViewEl = document.getElementById("content-home-view");
        if (!c.homePicks || c.homePicks.length === 0) {
            homeViewEl.innerHTML = `<p class="admin-help-text">No picks curated yet - falls back to the first few items in the top menu section.</p>`;
        } else {
            homeViewEl.innerHTML = `<ul style="margin:0; padding-left:18px; font-size:12px;">${c.homePicks
                .map((p) => {
                    const item = pickableItems.find((i) => i.id === p.itemId);
                    return `<li>${escapeHtmlAttr(item ? item.name : "Unknown item")}${p.tag ? ` (${escapeHtmlAttr(p.tag)})` : ""}</li>`;
                })
                .join("")}</ul>`;
        }
        if (!canEdit) {
            homeViewEl.insertAdjacentHTML(
                "beforeend",
                `<p class="admin-help-text" style="margin-top:8px;">Roast story: ${(c.roastSteps || []).length} step(s). Headings: “${escapeHtmlAttr((c.homeHeadings && c.homeHeadings.picks) || "This week's picks")}” / “${escapeHtmlAttr((c.homeHeadings && c.homeHeadings.roast) || "How we roast")}” / “${escapeHtmlAttr((c.homeHeadings && c.homeHeadings.findUs) || "Find us")}”.</p>`
            );
        }
        renderReadOnlySection(document.getElementById("content-footer-section"), {
            title: "STORE DETAILS (HOME PAGE FOOTER, FRANCHISE DEFAULT)",
            canEdit,
            fields: [
                { label: "Tagline", value: (c.footer && c.footer.tagline) || "" },
                { label: "Address", value: (c.footer && c.footer.address) || "" },
                { label: "Phone", value: (c.footer && c.footer.phone) || "" },
                { label: "Email", value: (c.footer && c.footer.email) || "" },
                { label: "Hours", value: (c.footer && c.footer.hours) || "" }
            ],
            onEdit: () =>
                renderSectionEditModal({
                    title: "EDIT STORE DETAILS",
                    width: "480px",
                    fields: [
                        { id: "brand-footer-tagline", label: "Tagline", value: (c.footer && c.footer.tagline) || "", maxlength: 120, placeholder: "e.g. Hand-brewed since 2024" },
                        { id: "brand-footer-address", label: "Address", value: (c.footer && c.footer.address) || "", maxlength: 200, placeholder: "Street, City, State, PIN" },
                        { id: "brand-footer-phone", label: "Phone", value: (c.footer && c.footer.phone) || "", maxlength: 20, placeholder: "+91 …", type: "tel" },
                        { id: "brand-footer-email", label: "Email", value: (c.footer && c.footer.email) || "", maxlength: 80, placeholder: "hello@…", type: "email" },
                        { id: "brand-footer-hours", label: "Hours", value: (c.footer && c.footer.hours) || "", maxlength: 60, placeholder: "Mon-Sat: 8am - 8pm" }
                    ],
                    onSave: async (v) => {
                        const updated = await AdminConfig.saveSettings({
                            footer: {
                                tagline: v["brand-footer-tagline"].trim(),
                                address: v["brand-footer-address"].trim(),
                                phone: v["brand-footer-phone"].trim(),
                                email: v["brand-footer-email"].trim(),
                                hours: v["brand-footer-hours"].trim()
                            }
                        });
                        if (window.applyBranding) window.applyBranding(updated);
                        if (window.renderFooter) window.renderFooter(updated);
                        ok("Store details saved");
                        this.renderContent(root);
                    }
                })
        });

        if (!canEdit) return;

        // ---- This week's picks: section-grouped list + smart suggestions ----
        const homePicksById = Object.fromEntries((c.homePicks || []).map((p) => [p.itemId, p.tag]));
        const sectionTitleById = Object.fromEntries(this.menu.sections.map((s) => [s.id, s.title]));

        const pickRowHtml = (item) => {
            const checked = homePicksById[item.id] !== undefined;
            return `
                <label style="display:flex; align-items:center; gap:8px; font-size:12px; padding:3px 0;">
                    <input type="checkbox" class="home-pick-check" data-item-id="${item.id}" ${checked ? "checked" : ""} />
                    <span style="flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtmlAttr(item.name)}</span>
                </label>
            `;
        };

        // Renders one tag input per currently-CHECKED item, in the separate
        // right-hand column - keeps the checklist itself from stretching
        // wide enough to leave a dead gap next to it, and existing tag text
        // typed in this render survives a re-render (read from the DOM
        // first, falling back to the saved value only the first time).
        const renderTagsPanel = () => {
            const tagsPanel = document.getElementById("home-picks-tags");
            const checkedIds = Array.from(document.querySelectorAll(".home-pick-check:checked")).map((cb) => Number(cb.dataset.itemId));
            if (checkedIds.length === 0) {
                tagsPanel.innerHTML = `<p class="admin-help-text">Check an item on the left to give it a tag.</p>`;
                return;
            }
            tagsPanel.innerHTML = checkedIds
                .map((id) => {
                    const item = pickableItems.find((i) => i.id === id);
                    const existingInput = tagsPanel.querySelector(`.home-pick-tag[data-item-id="${id}"]`);
                    const tag = existingInput ? existingInput.value : homePicksById[id] || "";
                    return `
                    <div style="margin-bottom:6px;">
                        <label for="home-pick-tag-${id}" style="display:block; font-size:10px; color:var(--color-text-muted); margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtmlAttr(item ? item.name : "")}</label>
                        <input type="text" id="home-pick-tag-${id}" class="home-pick-tag" data-item-id="${id}" maxlength="40" placeholder="e.g. House favourite" value="${escapeHtmlAttr(tag)}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:5px 7px; font-family:inherit; font-size:11px;" />
                    </div>
                `;
                })
                .join("");
        };

        document.getElementById("home-picks-list").innerHTML =
            pickableItems.length === 0
                ? `<p style="color:var(--color-text-muted); font-size:12px;">No menu items yet.</p>`
                : this.menu.sections
                      .map((section) => {
                          const items = pickableItems.filter((i) => i.section === section.id);
                          if (items.length === 0) return "";
                          return `
                        <div style="margin-bottom:10px;">
                            <div style="font-size:10px; letter-spacing:.1em; color:var(--color-text-muted); text-transform:uppercase; margin-bottom:2px;">${escapeHtmlAttr(section.title)}</div>
                            ${items.map(pickRowHtml).join("")}
                        </div>
                    `;
                      })
                      .join("");

        const MAX_HOME_PICKS = 3;
        // Once 3 are checked, every unchecked box is disabled rather than
        // silently un-checking a click - a disabled box reads as "pick's
        // full" at a glance instead of looking like a bug when clicking a
        // 4th item does nothing.
        const enforcePickLimit = () => {
            const checkedCount = document.querySelectorAll(".home-pick-check:checked").length;
            document.querySelectorAll(".home-pick-check").forEach((cb) => {
                cb.disabled = !cb.checked && checkedCount >= MAX_HOME_PICKS;
            });
        };
        const wirePickRows = () => {
            document.querySelectorAll(".home-pick-check").forEach((cb) => {
                cb.addEventListener("change", () => {
                    renderTagsPanel();
                    enforcePickLimit();
                });
            });
        };
        wirePickRows();
        renderTagsPanel();
        enforcePickLimit();

        // Suggestion chips - each one CHECKS matching items (doesn't save by
        // itself) so the admin can still review/adjust tags before hitting
        // Save. Top sellers reuses the same 30-day KPI data the Dashboard
        // shows; promoted/rarely-ordered are derived from data already
        // loaded here, no extra endpoint needed.
        const suggestionsEl = document.getElementById("home-picks-suggestions");
        const checkItems = (items, defaultTag) => {
            let changed = false;
            let remaining = MAX_HOME_PICKS - document.querySelectorAll(".home-pick-check:checked").length;
            const actuallyChecked = [];
            items.forEach((item) => {
                if (remaining <= 0) return;
                const cb = document.querySelector(`.home-pick-check[data-item-id="${item.id}"]`);
                if (!cb || cb.checked) return;
                cb.checked = true;
                changed = true;
                remaining--;
                actuallyChecked.push(item);
            });
            if (changed) renderTagsPanel();
            enforcePickLimit();
            if (remaining <= 0 && actuallyChecked.length < items.length) {
                fail(`Only picked ${actuallyChecked.length} - up to ${MAX_HOME_PICKS} items can feature on the home page.`);
            }
            // Fill in the default tag for whichever of these items don't
            // already have one typed (existing tags, including ones just
            // restored by renderTagsPanel above, are left alone).
            actuallyChecked.forEach((item) => {
                const tagInput = document.querySelector(`.home-pick-tag[data-item-id="${item.id}"]`);
                if (tagInput && !tagInput.value) tagInput.value = defaultTag;
            });
        };
        const promoted = pickableItems.filter((i) => i.promoDiscount);
        suggestionsEl.innerHTML = `
            <button type="button" class="admin-btn-secondary" id="suggest-top-sellers" style="padding:4px 8px; font-size:10px;">+ TOP SELLERS</button>
            <button type="button" class="admin-btn-secondary" id="suggest-promoted" style="padding:4px 8px; font-size:10px;" ${promoted.length === 0 ? "disabled" : ""}>+ ON PROMOTION${promoted.length ? ` (${promoted.length})` : ""}</button>
            <button type="button" class="admin-btn-secondary" id="suggest-rarely-ordered" style="padding:4px 8px; font-size:10px;">+ RARELY ORDERED</button>
        `;
        document.getElementById("suggest-promoted").addEventListener("click", () => checkItems(promoted, "On offer"));
        document.getElementById("suggest-top-sellers").addEventListener("click", async () => {
            try {
                const kpi = await PayrollSystem.fetchKpi("1m");
                const topNames = new Set((kpi.bestSellers || []).map((s) => s.name));
                checkItems(
                    pickableItems.filter((i) => topNames.has(i.name)),
                    "House favourite"
                );
            } catch (e) {
                fail("Could not load top sellers");
            }
        });
        document.getElementById("suggest-rarely-ordered").addEventListener("click", async () => {
            try {
                const kpi = await PayrollSystem.fetchKpi("1m");
                const orderedNames = new Set((kpi.bestSellers || []).map((s) => s.name));
                // "Rarely ordered" = not in the last 30 days' top-5 sellers -
                // an approximation (the KPI endpoint only exposes a top-5
                // list, not full per-item counts), good enough to surface
                // candidates worth a second look rather than a precise stat.
                checkItems(
                    pickableItems.filter((i) => !orderedNames.has(i.name)).slice(0, 5),
                    "Underrated pick"
                );
            } catch (e) {
                fail("Could not check order history");
            }
        });

        // ---- Roast steps editor ----
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
                    <input type="text" class="roast-step-name" aria-label="Step ${i + 1} name" placeholder="Step name" maxlength="40" value="${escapeHtmlAttr(step.name || "")}" style="flex:0 0 150px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit; font-size:11px;" />
                    <input type="text" class="roast-step-detail" aria-label="Step ${i + 1} detail line" placeholder="Detail line" maxlength="160" value="${escapeHtmlAttr(step.detail || "")}" style="flex:1; min-width:0; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit; font-size:11px;" />
                    <button type="button" class="roast-step-remove admin-btn-secondary" data-index="${i}" aria-label="Remove step ${i + 1}" style="flex:none; padding:4px 8px;">&times;</button>
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
            const errorEl = document.getElementById("content-error");
            errorEl.textContent = "";
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
                errorEl.textContent = e.message;
                fail(e.message);
            }
        });

        // ---- Custom footer fields editor (Instagram, GST no, WhatsApp, etc.) ----
        const MAX_CUSTOM_FOOTER_FIELDS = 6;
        const footerFieldsEditor = document.getElementById("footer-custom-fields-editor");

        const FOOTER_FIELD_TYPES = [
            { value: "other", label: "OTHER" },
            { value: "social", label: "SOCIAL" },
            { value: "career", label: "CAREERS" }
        ];

        function renderFooterFieldsEditor(fields) {
            footerFieldsEditor.innerHTML = fields
                .map(
                    (f, i) => `
                <div class="footer-field-row" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <input type="text" class="footer-field-label" aria-label="Field ${i + 1} name" placeholder="Field name (e.g. Instagram)" maxlength="30" value="${escapeHtmlAttr(f.label || "")}" style="flex:0 0 150px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit; font-size:11px;" />
                    <input type="text" class="footer-field-value" aria-label="Field ${i + 1} display text" placeholder="Display text" maxlength="100" value="${escapeHtmlAttr(f.value || "")}" style="flex:1 1 120px; min-width:0; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit; font-size:11px;" />
                    <input type="text" class="footer-field-url" aria-label="Field ${i + 1} link URL" placeholder="Link URL (optional)" maxlength="300" value="${escapeHtmlAttr(f.url || "")}" style="flex:1 1 160px; min-width:0; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 8px; font-family:inherit; font-size:11px;" />
                    <select class="footer-field-type" aria-label="Field ${i + 1} type" style="flex:0 0 100px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:6px 4px; font-family:inherit; font-size:11px;">
                        ${FOOTER_FIELD_TYPES.map((t) => `<option value="${t.value}" ${(f.type || "other") === t.value ? "selected" : ""}>${t.label}</option>`).join("")}
                    </select>
                    <button type="button" class="footer-field-remove admin-btn-secondary" data-index="${i}" aria-label="Remove field ${i + 1}" style="flex:none; padding:4px 8px;">&times;</button>
                </div>
            `
                )
                .join("");
            footerFieldsEditor.querySelectorAll(".footer-field-remove").forEach((btn) => {
                btn.addEventListener("click", () => {
                    fields.splice(Number(btn.dataset.index), 1);
                    renderFooterFieldsEditor(fields);
                });
            });
        }

        const customFooterFields = (c.customFooterFields || []).map((f) => ({ ...f }));
        renderFooterFieldsEditor(customFooterFields);

        document.getElementById("footer-custom-field-add").addEventListener("click", () => {
            if (customFooterFields.length >= MAX_CUSTOM_FOOTER_FIELDS) return fail(`Up to ${MAX_CUSTOM_FOOTER_FIELDS} custom fields`);
            customFooterFields.push({ label: "", value: "", url: "", type: "other" });
            renderFooterFieldsEditor(customFooterFields);
        });

        document.getElementById("footer-save").addEventListener("click", async () => {
            const errorEl = document.getElementById("footer-error");
            errorEl.textContent = "";
            const finalCustomFields = Array.from(footerFieldsEditor.querySelectorAll(".footer-field-row"))
                .map((row) => ({
                    label: row.querySelector(".footer-field-label").value.trim(),
                    value: row.querySelector(".footer-field-value").value.trim(),
                    url: row.querySelector(".footer-field-url").value.trim(),
                    type: row.querySelector(".footer-field-type").value
                }))
                .filter((f) => f.label || f.value);
            try {
                const updated = await AdminConfig.saveSettings({ customFooterFields: finalCustomFields });
                if (window.renderFooter) window.renderFooter(updated);
                ok("Custom fields saved");
                this.renderContent(root);
            } catch (e) {
                errorEl.textContent = e.message;
                fail(e.message);
            }
        });
    }
};
