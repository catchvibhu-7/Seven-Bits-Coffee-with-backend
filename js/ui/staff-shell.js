/**
 * SEVEN BITS COFFEE - STAFF SHELL (nav chrome for employee/manager/admin/owner)
 * Location: /js/ui/staff-shell.js
 *
 * Renders one of two layouts - a left rail (#staff-rail, an <aside> beside
 * #app-main) or a top bar (.staff-topbar, a <header> that visually replaces
 * .system-nav inside #app-main) - from the SAME tab-list data, so there's
 * one source of truth for what's in the nav regardless of which layout is
 * showing. Customers/guests never see either: app.js only calls into this
 * module once a KITCHEN_ROLES session is confirmed, and #staff-rail defaults
 * to display:none in the CSS so an untouched page looks exactly as before.
 *
 * The mockup this is based on had a 4-button role *switcher* in the rail's
 * "Auth level" section - that was a design-time preview toggle, not a real
 * feature. The real-world equivalent is simpler: show who's actually logged
 * in, and a LOGOUT button.
 */
const LAYOUT_KEY = "sb-staff-nav-layout";

function loadLayout() {
    try {
        const v = localStorage.getItem(LAYOUT_KEY);
        return v === "topbar" ? "topbar" : "rail";
    } catch (e) {
        return "rail";
    }
}

function saveLayout(v) {
    try {
        localStorage.setItem(LAYOUT_KEY, v);
    } catch (e) {
        // Private-browsing/storage-blocked - the toggle still works for this session.
    }
}

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Kept in one place so rail/top-bar always agree on what's in the nav, and
// so a later phase can add a real order-count badge to "Orders" without
// touching two separate render paths.
const TAB_DEFS = [
    { key: "staff-home", label: "Home", pageId: "staff-home" },
    { key: "menu", label: "Menu", pageId: "menu" },
    { key: "orders", label: "Orders", pageId: "kitchen" },
    { key: "billing", label: "Billing", pageId: "kitchen", station: "TABLES" },
    { key: "admin", label: "Admin", pageId: "admin", managerUp: true }
];

export const StaffShell = {
    session: null,
    layout: "rail",
    activeTab: "staff-home",
    managerUpRoles: ["manager", "admin", "owner"],

    /** Called once a KITCHEN_ROLES session is confirmed (see app.js). */
    show(session, activePageId) {
        this.session = session;
        this.layout = loadLayout();
        this.setActiveFromPageId(activePageId);
        const rail = document.getElementById("staff-rail");
        const nav = document.querySelector(".system-nav");
        if (rail) rail.style.display = this.layout === "rail" ? "flex" : "none";
        if (nav) nav.style.display = this.layout === "rail" ? "none" : "flex";
        this.render();
    },

    /** Called when the session drops below KITCHEN_ROLES (logout, or a
     *  customer/guest browsing) - restores the untouched customer chrome. */
    hide() {
        const rail = document.getElementById("staff-rail");
        const nav = document.querySelector(".system-nav");
        if (rail) {
            rail.style.display = "none";
            rail.innerHTML = "";
        }
        if (nav) {
            nav.style.display = "flex";
            nav.classList.remove("staff-topbar");
            nav.innerHTML = this.customerNavHtml;
        }
    },

    setActiveFromPageId(pageId) {
        // Orders and Billing share pageId "kitchen" (Billing is that page's
        // TABLES sub-view for now, see TAB_DEFS) - .find() naturally resolves
        // to "orders" here since it's listed first, which is the right
        // default when we can't otherwise tell which sub-view is showing.
        const tab = TAB_DEFS.find((t) => t.pageId === pageId);
        if (tab) this.activeTab = tab.key;
    },

    tabsForRole() {
        const role = this.session?.role;
        return TAB_DEFS.filter((t) => !t.managerUp || this.managerUpRoles.includes(role));
    },

    /** Toggles rail <-> top-bar in place - no page navigation happens, so
     *  activeTab/session are left untouched. */
    switchLayout() {
        this.layout = this.layout === "rail" ? "topbar" : "rail";
        saveLayout(this.layout);
        const rail = document.getElementById("staff-rail");
        const nav = document.querySelector(".system-nav");
        if (rail) rail.style.display = this.layout === "rail" ? "flex" : "none";
        if (nav) nav.style.display = this.layout === "rail" ? "none" : "flex";
        if (this.layout !== "rail" && nav) nav.classList.add("staff-topbar");
        this.render();
    },

    render() {
        const tabs = this.tabsForRole();
        const identityHtml = this.identityHtml();
        if (this.layout === "rail") {
            this.renderRail(tabs, identityHtml);
        } else {
            this.renderTopbar(tabs, identityHtml);
        }
    },

    navButtonsHtml(tabs, { topbar } = {}) {
        return tabs
            .map((t, i) => {
                const active = t.key === this.activeTab;
                const mark = active ? "&gt;" : String(i + 1).padStart(2, "0");
                return `
                    <button type="button" class="staff-nav-btn${active ? " active" : ""}" data-tab="${t.key}" aria-current="${active ? "page" : "false"}">
                        <span class="staff-nav-mark" aria-hidden="true">${mark}</span>
                        <span class="staff-nav-label">${escapeHtml(t.label)}</span>
                    </button>
                `;
            })
            .join("");
    },

    identityHtml() {
        const s = this.session || {};
        const name = s.name || (s.role ? s.role.toUpperCase() : "STAFF");
        const role = s.role ? s.role.toUpperCase() : "";
        return `
            <div class="staff-auth-identity">
                <span class="staff-auth-name">${escapeHtml(name)}</span>
                <span class="staff-auth-role">${escapeHtml(role)}</span>
            </div>
        `;
    },

    renderRail(tabs, identityHtml) {
        const rail = document.getElementById("staff-rail");
        if (!rail) return;
        rail.innerHTML = `
            <div class="staff-rail-logo">
                <div class="staff-rail-logo-mark">SEVEN<br>BITS<span style="color:var(--color-text);">_</span></div>
                <div class="staff-rail-sub">Coffee &middot; Staff Terminal</div>
                <div class="staff-rail-status">&#9679; SYS.ONLINE</div>
            </div>
            <nav class="staff-nav-list" aria-label="Staff navigation">
                ${this.navButtonsHtml(tabs)}
            </nav>
            <div class="staff-rail-spacer"></div>
            <div class="staff-auth-section">
                <div class="staff-auth-label">Signed in</div>
                ${identityHtml}
                <button type="button" id="staff-timeclock-btn" class="staff-logout-btn" style="display:none; width:100%; margin-bottom:6px;" onclick="window.handleTimeclockClick()"></button>
                <div class="staff-auth-btn-row">
                    <button type="button" class="staff-layout-btn" aria-label="Switch to top-bar layout">Top bar</button>
                    <button type="button" class="staff-logout-btn">Log out</button>
                </div>
            </div>
        `;
        this.wireButtons(rail);
        window.updateTimeclockWidget?.();
    },

    renderTopbar(tabs, identityHtml) {
        const nav = document.querySelector(".system-nav");
        if (!nav) return;
        nav.classList.add("staff-topbar");
        nav.innerHTML = `
            <div class="staff-topbar-logo">
                <span style="font-size:17px; font-weight:bold; letter-spacing:2px; color:var(--color-accent);">7BITS</span>
                <span style="font-size:9px; letter-spacing:.18em; color:var(--color-text-muted);">POS</span>
            </div>
            <nav class="staff-topbar-nav" aria-label="Staff navigation">
                ${this.navButtonsHtml(tabs, { topbar: true })}
            </nav>
            <div class="staff-topbar-identity">
                <button type="button" id="staff-timeclock-btn" class="staff-logout-btn" style="display:none;" onclick="window.handleTimeclockClick()"></button>
                ${identityHtml}
                <button type="button" class="staff-layout-btn" aria-label="Switch to left-rail layout">Rail</button>
                <button type="button" class="staff-logout-btn">Log out</button>
            </div>
        `;
        this.wireButtons(nav);
        window.updateTimeclockWidget?.();
    },

    wireButtons(root) {
        root.querySelectorAll(".staff-nav-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const tab = TAB_DEFS.find((t) => t.key === btn.dataset.tab);
                if (!tab) return;
                this.activeTab = tab.key;
                window.showPage(tab.pageId).then(() => {
                    if (tab.station) window.filterKitchen?.(tab.station);
                });
            });
        });
        root.querySelector(".staff-layout-btn")?.addEventListener("click", () => this.switchLayout());
        root.querySelector(".staff-logout-btn")?.addEventListener("click", () => {
            window.staffLogout?.();
        });
    },

    // Snapshot of the customer nav's markup, captured once on first load
    // (before any staff session swaps it out) so hide() can restore it
    // byte-for-byte rather than trying to regenerate it from scratch.
    customerNavHtml: null,
    captureCustomerNav() {
        if (this.customerNavHtml !== null) return;
        const nav = document.querySelector(".system-nav");
        if (nav) this.customerNavHtml = nav.innerHTML;
    }
};
