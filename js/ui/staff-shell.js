/**
 * SEVEN BITS COFFEE - APP SHELL (nav chrome for every signed-in session)
 * Location: /js/ui/staff-shell.js
 *
 * Renders one of two layouts - a left rail (#staff-rail, an <aside> beside
 * #app-main) or a top bar (.staff-topbar, a <header> that visually replaces
 * .system-nav inside #app-main) - from the SAME tab-list data, so there's
 * one source of truth for what's in the nav regardless of which layout is
 * showing. The layout choice (and its per-account persistence - see
 * fetchServerLayout()/saveServerLayout()) isn't staff-only: customer/guest
 * sessions get the same rail/top-bar switcher, just with a shorter
 * Home/Menu/Arcade tab list (CUSTOMER_TAB_DEFS) instead of staff's five
 * (STAFF_TAB_DEFS) - see isStaffSession(). Only a fully anonymous visitor
 * with no session at all never sees either layout: app.js's
 * updateStaffShellForSession() falls back to hide() (the untouched customer
 * top nav) in that one case, and #staff-rail defaults to display:none in
 * the CSS so that visitor's first paint looks exactly as before this
 * module existed. Despite the file name (kept to avoid a churny rename
 * across app.js/index.html/theme.css), this module is no longer staff-only.
 *
 * The mockup this is based on had a 4-button role *switcher* in the rail's
 * "Auth level" section - that was a design-time preview toggle, not a real
 * feature. The real-world equivalent is simpler: one account button
 * (name + role, see identityHtml()) that opens the same account dropdown
 * (Account Settings, Log out) the customer nav uses - see
 * window.renderAccountMenu() in app.js. Rail/top-bar layout switching lives
 * inside Account Settings now (account-settings-modal.js), not as its own
 * visible button.
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

// localStorage is per-browser only - a manager who switches machines (or
// clears site data) loses their layout choice. /api/user-preferences (see
// server.js) persists it per userId instead, so it follows the account
// everywhere. localStorage stays as the instant, no-network read used for
// the very first render; the server fetch reconciles shortly after in
// show(), same pattern as any other "fast local read, slower authoritative
// refresh" widget in this app.
async function fetchServerLayout() {
    try {
        const res = await fetch("/api/user-preferences", { credentials: "include" });
        if (!res.ok) return null;
        const prefs = await res.json();
        return prefs.layout === "rail" || prefs.layout === "topbar" ? prefs.layout : null;
    } catch (e) {
        return null;
    }
}

function saveServerLayout(v) {
    fetch("/api/user-preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: v })
    }).catch(() => {
        // Best-effort - the localStorage copy (saveLayout) already applied,
        // so a dropped request here just means the choice doesn't follow to
        // another device this time, not a broken toggle.
    });
}

// Both the rail and the top bar are position:fixed (see .staff-rail /
// .staff-topbar in theme.css - genuinely pinned to the screen, not just
// position:sticky), so whichever is active is taken out of #app-shell's
// normal flex flow entirely. #app-main needs a matching margin (left for
// the rail, top for the top bar) or its content would render underneath
// the fixed nav instead of beside/below it.
const RAIL_WIDTH_PX = 246;
const TOPBAR_HEIGHT_PX = 60;
function setMainOffsetForLayout(layout) {
    const main = document.getElementById("app-main");
    if (!main) return;
    main.style.marginLeft = layout === "rail" ? `${RAIL_WIDTH_PX}px` : "0";
    main.style.marginTop = layout === "topbar" ? `${TOPBAR_HEIGHT_PX}px` : "0";
}

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Mirrors app.js's KITCHEN_ROLES - inlined rather than imported since app.js
// isn't set up as a module other files pull constants from (same reasoning
// as account-settings-modal.js's own STAFF_ROLES copy). Used only to pick
// which tab list below applies to the current session.
const KITCHEN_ROLES = ["employee", "manager", "admin", "owner"];

// Kept in one place so rail/top-bar always agree on what's in the nav, and
// so a later phase can add a real order-count badge to "Orders" without
// touching two separate render paths.
const STAFF_TAB_DEFS = [
    { key: "staff-home", label: "Home", pageId: "staff-home" },
    { key: "menu", label: "Menu", pageId: "menu" },
    { key: "orders", label: "Orders", pageId: "kitchen" },
    { key: "billing", label: "Billing", pageId: "billing" },
    { key: "admin", label: "Admin", pageId: "admin", managerUp: true }
];

// Same rail/top-bar switcher, customer/guest edition - mirrors the plain
// three-button customer nav in index.html (Home/Menu/Arcade) instead of the
// staff tab set. The layout choice itself (and its server-side persistence -
// see fetchServerLayout()/saveServerLayout()) isn't a staff-only feature;
// only the CONTENTS of the nav differ by who's looking at it.
const CUSTOMER_TAB_DEFS = [
    { key: "home", label: "Home", pageId: "home" },
    { key: "menu", label: "Menu", pageId: "menu" },
    { key: "arcade", label: "Arcade", pageId: "arcade" }
];

export const StaffShell = {
    session: null,
    layout: "rail",
    activeTab: "staff-home",
    managerUpRoles: ["manager", "admin", "owner"],

    isStaffSession() {
        return KITCHEN_ROLES.includes(this.session?.role);
    },

    /** Called once ANY session (staff, customer, or guest) is confirmed -
     *  see updateStaffShellForSession() in app.js. A fully anonymous visitor
     *  (no session at all) never reaches here; that case still gets the
     *  untouched customer top nav via hide(). */
    show(session, activePageId) {
        this.session = session;
        this.activeTab = this.isStaffSession() ? "staff-home" : "home";
        this.layout = loadLayout();
        this.setActiveFromPageId(activePageId);
        const rail = document.getElementById("staff-rail");
        const nav = document.querySelector(".system-nav");
        if (rail) rail.style.display = this.layout === "rail" ? "flex" : "none";
        if (nav) nav.style.display = this.layout === "rail" ? "none" : "flex";
        setMainOffsetForLayout(this.layout);
        this.render();
        this.syncLayoutFromServer();
    },

    /** Reconciles against the per-user server copy (see fetchServerLayout())
     *  after the instant localStorage-based render above already happened -
     *  only re-renders if the account's stored choice actually differs (e.g.
     *  set from a different browser/device), so the common case is a no-op. */
    async syncLayoutFromServer() {
        const serverLayout = await fetchServerLayout();
        if (!serverLayout || serverLayout === this.layout || this.session == null) return;
        this.layout = serverLayout;
        saveLayout(this.layout);
        this.applyLayoutToDom();
    },

    applyLayoutToDom() {
        const rail = document.getElementById("staff-rail");
        const nav = document.querySelector(".system-nav");
        if (rail) rail.style.display = this.layout === "rail" ? "flex" : "none";
        if (nav) nav.style.display = this.layout === "rail" ? "none" : "flex";
        if (this.layout !== "rail" && nav) nav.classList.add("staff-topbar");
        setMainOffsetForLayout(this.layout);
        this.render();
    },

    /** Called when there's no session at all - a fully anonymous visitor who
     *  hasn't logged in, registered, or started a guest checkout yet -
     *  restores the untouched customer chrome. Any real session (customer,
     *  guest, or staff) uses show() instead, see updateStaffShellForSession()
     *  in app.js. */
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
        setMainOffsetForLayout(null);
    },

    setActiveFromPageId(pageId) {
        const defs = this.isStaffSession() ? STAFF_TAB_DEFS : CUSTOMER_TAB_DEFS;
        const tab = defs.find((t) => t.pageId === pageId);
        if (tab) this.activeTab = tab.key;
    },

    tabsForRole() {
        if (!this.isStaffSession()) return CUSTOMER_TAB_DEFS;
        const role = this.session?.role;
        return STAFF_TAB_DEFS.filter((t) => !t.managerUp || this.managerUpRoles.includes(role));
    },

    /** Toggles rail <-> top-bar in place - no page navigation happens, so
     *  activeTab/session are left untouched. */
    switchLayout() {
        this.layout = this.layout === "rail" ? "topbar" : "rail";
        saveLayout(this.layout);
        saveServerLayout(this.layout);
        this.applyLayoutToDom();
    },

    render() {
        const tabs = this.tabsForRole();
        const identityHtml = this.identityHtml();
        // Switching layouts only ever re-renders the NEWLY active container
        // (rail or top-bar) - the other one is just hidden (display:none),
        // not cleared, so its stale markup (including its own copy of
        // #staff-account-btn) stayed in the DOM. getElementById() then
        // silently returned that hidden, zero-sized element instead of the
        // visible one, which is why the account dropdown used to open at
        // (0,0) after switching layouts. Clearing the inactive one first
        // guarantees only one #staff-account-btn (etc.) ever exists.
        if (this.layout === "rail") {
            const nav = document.querySelector(".system-nav");
            // renderTopbar() adds this class every time it runs, but nothing
            // ever removed it again on the way back to rail - it stuck
            // around on .system-nav (even display:none, class selectors
            // don't care) and kept matching the topbar-only sticky-header
            // offset rule in theme.css, pushing .menu-sticky-header 60px
            // down in rail mode too instead of flush to top:0.
            if (nav) {
                nav.innerHTML = "";
                nav.classList.remove("staff-topbar");
            }
            this.renderRail(tabs, identityHtml);
        } else {
            const rail = document.getElementById("staff-rail");
            if (rail) rail.innerHTML = "";
            this.renderTopbar(tabs, identityHtml);
        }
    },

    navButtonsHtml(tabs, { topbar } = {}) {
        return tabs
            .map((t, i) => {
                const active = t.key === this.activeTab;
                const mark = active ? "&gt;" : String(i + 1).padStart(2, "0");
                const count = this.badgeCounts[t.key] || 0;
                return `
                    <button type="button" class="staff-nav-btn${active ? " active" : ""}" data-tab="${t.key}" aria-current="${active ? "page" : "false"}">
                        <span class="staff-nav-mark" aria-hidden="true">${mark}</span>
                        <span class="staff-nav-label">${escapeHtml(t.label)}</span>
                        <span class="staff-nav-badge" data-badge="${t.key}" style="display:${count > 0 ? "inline-block" : "none"};">${count}</span>
                    </button>
                `;
            })
            .join("");
    },

    // Live count shown on a nav tab (currently just "orders" - open KOT
    // tickets still awaiting fire) - see setBadge()/app.js's
    // ensureOrdersStream() for what keeps this current. Updates the badge
    // element(s) directly rather than a full re-render, so a fast-arriving
    // order doesn't steal focus or reset scroll on whichever tab is open.
    badgeCounts: {},
    setBadge(tabKey, count) {
        this.badgeCounts[tabKey] = count;
        document.querySelectorAll(`.staff-nav-badge[data-badge="${tabKey}"]`).forEach((el) => {
            el.textContent = String(count);
            el.style.display = count > 0 ? "inline-block" : "none";
        });
    },

    /** The one account button - name + role level, opens the shared
     *  account dropdown (Account Settings incl. Site Layout, Log out) via
     *  window.renderAccountMenu(), same pattern as the customer nav's
     *  account button. */
    identityHtml() {
        const s = this.session || {};
        const name = s.name || (s.role ? s.role.toUpperCase() : "STAFF");
        const role = s.role ? s.role.toUpperCase() : "";
        return `
            <button type="button" id="staff-account-btn" class="staff-auth-identity">
                <span class="staff-auth-name">${escapeHtml(name)}</span>
                <span class="staff-auth-role">${escapeHtml(role)}</span>
            </button>
        `;
    },

    renderRail(tabs, identityHtml) {
        const rail = document.getElementById("staff-rail");
        if (!rail) return;
        rail.innerHTML = `
            <div class="staff-rail-logo">
                <div class="staff-rail-logo-mark">SEVEN<br>BITS<span style="color:var(--color-text);">_</span></div>
                <div class="staff-rail-sub">Coffee &middot; ${this.isStaffSession() ? "Staff Terminal" : "Order Terminal"}</div>
                <div class="staff-rail-status">&#9679; SYS.ONLINE</div>
            </div>
            <nav class="staff-nav-list" aria-label="Site navigation">
                ${this.navButtonsHtml(tabs)}
            </nav>
            <!-- Genuinely pinned to the bottom of the screen (position:fixed
                 - see .staff-auth-section in theme.css), not just pushed
                 there by a flex spacer - a spacer only pins it as far down
                 as the rail's own layout allows, which could still land it
                 partly below the fold on a short window. -->
            <div class="staff-auth-section">
                <button type="button" id="staff-timeclock-btn" class="staff-logout-btn" style="display:none; margin-bottom:6px;" onclick="window.handleTimeclockClick()"></button>
                ${identityHtml}
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
                <span style="font-size:9px; letter-spacing:.18em; color:var(--color-text-muted);">${this.isStaffSession() ? "POS" : "ORDER"}</span>
            </div>
            <nav class="staff-topbar-nav" aria-label="Site navigation">
                ${this.navButtonsHtml(tabs, { topbar: true })}
            </nav>
            <div class="staff-topbar-identity">
                <button type="button" id="staff-timeclock-btn" class="staff-logout-btn" style="display:none;" onclick="window.handleTimeclockClick()"></button>
                ${identityHtml}
            </div>
        `;
        this.wireButtons(nav);
        window.updateTimeclockWidget?.();
    },

    wireButtons(root) {
        const defs = this.isStaffSession() ? STAFF_TAB_DEFS : CUSTOMER_TAB_DEFS;
        root.querySelectorAll(".staff-nav-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const tab = defs.find((t) => t.key === btn.dataset.tab);
                if (!tab) return;
                this.activeTab = tab.key;
                window.showPage(tab.pageId).then(() => {
                    if (tab.station) window.filterKitchen?.(tab.station);
                });
            });
        });
        root.querySelector("#staff-account-btn")?.addEventListener("click", () => {
            window.renderAccountMenu?.("staff-account-btn");
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
