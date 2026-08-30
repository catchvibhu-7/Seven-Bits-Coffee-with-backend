/**
 * SEVEN BITS COFFEE - MAIN APPLICATION LOGIC
 * Location: /js/app.js
 */
import { KitchenSystem } from "./features/kitchen-logic.js";
import { CartSystem, discountedBasePrice } from "./features/cart-logic.js";
import { AuthSystem } from "./features/auth-logic.js";
import { AdminConfig, currencySymbol } from "./features/config-logic.js";
import { PayrollSystem } from "./features/payroll-logic.js";
import { renderCheckoutModal, renderPaymentConfirmation } from "./ui/checkout-modal.js";
import { renderLoginModal, renderForceChangePasswordModal } from "./ui/login-modal.js";
import { renderAccountSettingsModal } from "./ui/account-settings-modal.js";
import { renderCustomizeModal } from "./ui/customize-modal.js";
import { CustomizationSystem } from "./features/customization-logic.js";
import { FavoritesSystem } from "./features/favorites-logic.js";
import { renderMyOrdersModal } from "./ui/my-orders-modal.js";
import { TableSessionsSystem } from "./features/table-sessions-logic.js";
import { renderTableModal, renderTableBillModal } from "./ui/table-modal.js";
import { renderTrackPage, stopTrackPolling } from "./ui/track-page.js";
import { SoundSystem } from "./features/sound-logic.js";
import { NotificationSystem } from "./features/notification-logic.js";
import { StaffShell } from "./ui/staff-shell.js";
import { renderStaffHome } from "./ui/staff-home.js";
import { renderBillingPage, selectBillForOrder } from "./ui/billing-page.js";
import { ArcadeSystem } from "./features/arcade/arcade-logic.js";
import { StoreSystem } from "./features/store-logic.js";
import { renderStorePickerModal } from "./ui/store-picker-modal.js";

// --- System State ---
let cart = [];
let serviceChargeActive = true;
let tipApplied = false;
let orderType = "takeaway"; // "takeaway" | "dine-in" - picked in the cart panel, sent with the order
let currentKitchenStation = "MASTER"; // matches the "ALL" tab that's marked active by default in index.html
let viewMode = "grid";
let menuData = { sections: [], items: [] };
let siteConfig = {}; // last-loaded config (colors/customIcons/etc.) for icon rendering + branding
let pendingOrder = null; // order returned by the server, waiting to be printed
let ordersStream = null; // SSE connection, opened once after the first authenticated view
let orderStatusPollTimer = null; // fallback poll for customer/guest order status, see ensureOrderStatusPolling()
let session = { authenticated: false, role: null, name: null, phone: null }; // current login state
let favoritesFilterActive = false;
let dietFilter = "all"; // "all" | "veg" | "nonveg"
let comboData = [];
let activeCategory = "All"; // menu-cat-chips selection; "All" shows every section
let menuSectionPages = {}; // { [sectionId]: 1-based page } - each section paginates independently; reset to {} whenever the filtered item set changes
const MENU_PAGE_SIZE = 10;
let lastSeenOrderStatuses = {}; // orderId -> last status seen by refreshOrderStatusWidget, so the ready chime fires once per transition, not on every poll

const KITCHEN_ROLES = ["employee", "manager", "admin", "owner"];
const ADMIN_ROLES = ["admin", "owner"]; // full Admin panel (Branding, unrestricted staff)
const MANAGER_UP_ROLES = ["manager", "admin", "owner"]; // Admin/Manager Dashboard page access
const TRACKING_ROLES = ["customer", "guest"];
const PAYROLL_ROLES = ["employee", "manager"];

async function loadMenu() {
    // Only a customer/guest/anonymous visitor's own chosen store matters
    // here - a staff session's storeId is read server-side from the
    // session itself, never from this query param.
    const storeId = TRACKING_ROLES.includes(session.role) || !session.authenticated ? StoreSystem.getSelectedStoreId() : null;
    const url = storeId != null ? `/api/menu?storeId=${encodeURIComponent(storeId)}` : "/api/menu";
    const res = await fetch(url);
    menuData = await res.json();
}

async function loadCombos() {
    const res = await fetch("/api/combos");
    comboData = res.ok ? await res.json() : [];
}

/** Current ambient wait estimate (backlog + parallelism, see
 *  computeWaitTimeMins() server-side) - null when the store has wait times
 *  turned off in Admin > Operations, or the request fails. Shared by the
 *  Home page fact strip, the Menu page header, and the post-checkout
 *  confirmation screen so they always agree with each other. */
async function fetchCurrentWaitMins() {
    const storeId = TRACKING_ROLES.includes(session.role) || !session.authenticated ? StoreSystem.getSelectedStoreId() : null;
    const url = storeId != null ? `/api/wait-time?storeId=${encodeURIComponent(storeId)}` : "/api/wait-time";
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return data.waitMins ?? null;
    } catch (e) {
        return null;
    }
}

async function refreshSession() {
    session = await AuthSystem.getSession();
    updateStaffShellForSession();
    updateNavForSession();
    if (TRACKING_ROLES.includes(session.role)) {
        await FavoritesSystem.load();
        // Opens the live-updates connection right away rather than only on
        // certain page visits (home/kitchen/billing/admin/arcade) - a
        // customer who checks out and stays on the menu page (the normal
        // post-checkout flow) was never getting a connection at all, so
        // staff marking their order done produced no chime/live update
        // until they happened to reload or navigate somewhere that opened
        // the stream as a side effect.
        ensureOrdersStream();
        ensureOrderStatusPolling();
    } else {
        FavoritesSystem.ids = [];
    }
    return session;
}

/**
 * Swaps in the app shell (left rail or top bar - js/ui/staff-shell.js) for
 * ANY real session - staff, customer, or guest alike, each getting its own
 * role-appropriate tab list (see StaffShell.tabsForRole()) - since the
 * rail/top-bar layout choice was never meant to be staff-exclusive, only its
 * tab CONTENTS differ by role. Even a fully anonymous visitor (never logged
 * in, registered, or started a guest checkout) now gets the same shell -
 * its identity button just becomes a LOGIN prompt instead of an account
 * dropdown (see StaffShell.identityHtml()/wireButtons()) - so the shop's
 * chosen default layout (Content tab -> Site Navigation) is what a brand
 * new visitor sees, not the old plain top nav.
 */
function updateStaffShellForSession() {
    const currentPageId = document.querySelector(".page.active")?.id.replace("page-", "") || null;
    StaffShell.show(session, currentPageId);
    // Populates the Orders nav badge right away rather than leaving it
    // at 0 until the first live-update event arrives (see
    // ensureOrdersStream(), which keeps it current after this).
    if (KITCHEN_ROLES.includes(session.role)) {
        KitchenSystem.fetchOrders().then(() => {
            const awaitingFire = KitchenSystem.orders.filter((o) => !o.items.every((i) => i.isDone)).length;
            StaffShell.setBadge("orders", awaitingFire);
        });
    }
}

/**
 * Updates the customer nav's account button label - purely visual, the
 * server enforces the real access control on every request regardless of
 * what the nav shows. (The Kitchen/Admin tabs and Clock In/Out that used to
 * be handled here moved into the staff shell - see updateStaffShellForSession()
 * above - since anyone who could ever see them always has that shell active
 * instead of this customer nav.)
 */
function updateNavForSession() {
    const accountBtn = document.getElementById("nav-account");

    if (accountBtn) {
        if (session.authenticated) {
            const label = session.role === "guest" ? "GUEST" : session.name || session.role.toUpperCase();
            accountBtn.textContent = `\u2b95 ${label}`;
        } else {
            accountBtn.textContent = "LOGIN";
        }
    }

    updateTimeclockWidget();

    const favFilterLabel = document.getElementById("favorites-filter-label");
    if (favFilterLabel) favFilterLabel.style.display = TRACKING_ROLES.includes(session.role) ? "flex" : "none";
}

/**
 * Re-fetches config and re-applies branding - a staff session tied to a
 * store gets that store's branding merged in server-side (configForSession),
 * but the client only sees it by asking again. Needed after login/logout
 * since the initial boot fetch happens before anyone's signed in.
 */
async function refreshBranding() {
    const config = await AdminConfig.loadSettings();
    window.applyBranding(config);
    window.renderFooter(config);
}

/**
 * If the account that just logged in has a temporary/reset password, force
 * a change before letting them proceed anywhere - the temp password is
 * meant to work exactly once.
 */
async function afterLoginSuccess(loginResult, proceed) {
    if (loginResult && loginResult.mustChangePassword) {
        renderForceChangePasswordModal(
            async () => {
                await refreshSession();
                await refreshBranding();
                await proceed();
            },
            async () => {
                await AuthSystem.logout();
                await refreshSession();
                await refreshBranding();
                window.showPage("home");
            }
        );
        return;
    }
    await refreshSession();
    await refreshBranding();
    await proceed();
}

/**
 * Applies the admin's Branding settings (colors/theme/hero/logo) as CSS
 * custom properties + element updates - called on boot and immediately
 * after saving Branding in the admin panel, no reload needed.
 */
window.applyBranding = (config) => {
    siteConfig = config;
    const root = document.documentElement;
    const colors = config.colors || {};
    if (colors.accent) root.style.setProperty("--color-accent", colors.accent);
    if (colors.background) root.style.setProperty("--color-bg", colors.background);
    if (colors.surface) root.style.setProperty("--color-surface", colors.surface);
    if (colors.text) root.style.setProperty("--color-text", colors.text);
    if (colors.textMuted) root.style.setProperty("--color-text-muted", colors.textMuted);
    if (colors.secondary) root.style.setProperty("--color-cyan", colors.secondary);

    // Admin panel text styles - tab nav row + muted helper/description
    // paragraphs (see Branding tab "ADMIN PANEL TEXT"). Only touches the
    // admin panel, not customer-facing pages.
    const textStyles = config.textStyles || {};
    if (textStyles.adminTabs) {
        if (textStyles.adminTabs.fontSize) root.style.setProperty("--admin-tab-font-size", `${textStyles.adminTabs.fontSize}pt`);
        if (textStyles.adminTabs.color) root.style.setProperty("--admin-tab-color", textStyles.adminTabs.color);
    }
    if (textStyles.adminHelp) {
        if (textStyles.adminHelp.fontSize) root.style.setProperty("--admin-help-font-size", `${textStyles.adminHelp.fontSize}pt`);
        if (textStyles.adminHelp.color) root.style.setProperty("--admin-help-color", textStyles.adminHelp.color);
    }
    if (textStyles.adminLabels) {
        if (textStyles.adminLabels.fontSize) root.style.setProperty("--admin-label-font-size", `${textStyles.adminLabels.fontSize}pt`);
        if (textStyles.adminLabels.color) root.style.setProperty("--admin-label-color", textStyles.adminLabels.color);
    }

    document.body.classList.toggle("theme-light", config.theme === "light");

    const heroEl = document.getElementById("home-hero-image-bg");
    if (heroEl) {
        // Leaving this empty (no heroImageUrl set) keeps the hatch-pattern
        // placeholder from theme.css's .home-hero-image-bg rule rather than
        // forcing a stock photo in as a stand-in for a real storefront shot.
        heroEl.style.backgroundImage = config.heroImageUrl ? `url(${JSON.stringify(config.heroImageUrl).slice(1, -1)})` : "";
    }
    const captionEl = document.getElementById("home-hero-caption");
    if (captionEl) captionEl.textContent = (config.heroCaptionLabel || "The counter") + (config.footer?.address ? ` · ${config.footer.address}` : "");

    const logoEl = document.getElementById("site-logo");
    if (logoEl) {
        if (config.logoUrl) {
            logoEl.src = config.logoUrl;
            logoEl.style.display = "inline-block";
        } else {
            logoEl.style.display = "none";
        }
    }

    // Home page hero copy - admin-editable from Global Settings, was
    // previously hardcoded HTML text.
    const shopNameEl = document.getElementById("hero-shop-name");
    if (shopNameEl && config.shopName) {
        // Was plain textContent, which also wipes the child
        // .staff-blink-cursor span markup ships with - the cursor flourish
        // was getting silently erased on every single page load before any
        // admin even touched shopName, since this runs whether or not it's
        // still the default value.
        shopNameEl.innerHTML = `${escapeHtml(config.shopName)}<span class="staff-blink-cursor" aria-hidden="true">_</span>`;
    }
    const taglineEl = document.getElementById("hero-tagline");
    if (taglineEl && config.heroTagline) taglineEl.textContent = config.heroTagline;
    const badgeEl = document.getElementById("home-hero-badge");
    if (badgeEl && config.heroBadgeText) badgeEl.textContent = config.heroBadgeText;

    // Home page section headings - were hardcoded text (see admin-portal.js
    // Branding tab "HOME PAGE CONTENT" for where these get edited).
    const headings = config.homeHeadings || {};
    const headingPicksEl = document.getElementById("home-heading-picks");
    if (headingPicksEl && headings.picks) headingPicksEl.textContent = headings.picks;
    const headingRoastEl = document.getElementById("home-heading-roast");
    if (headingRoastEl && headings.roast) headingRoastEl.textContent = headings.roast;
    const headingFindUsEl = document.getElementById("home-heading-findus");
    if (headingFindUsEl && headings.findUs) headingFindUsEl.textContent = headings.findUs;

    // Browser tab title - was hardcoded to this shop's own name/city and
    // never touched here, unlike the in-page heading right above.
    if (config.shopName) {
        document.title = config.footer?.address ? `${config.shopName} // ${config.footer.address}` : config.shopName;
    }
};

/**
 * Small "Clock In / Clock Out" nav button, visible only to employee/manager
 * accounts. Backs the payroll system's hourly-rate calculations with real
 * timestamps instead of manually-guessed hours.
 */
window.updateTimeclockWidget = updateTimeclockWidget; // staff-shell.js calls this after every re-render, since its innerHTML rebuild wipes whatever this last populated
async function updateTimeclockWidget() {
    // Lives inside the staff shell (js/ui/staff-shell.js), not the customer
    // nav - anyone who can see this (PAYROLL_ROLES) is always a KITCHEN_ROLES
    // member too, so they always have the shell active. The rail/top-bar AND
    // the mobile drawer all render unconditionally now (see StaffShell.render()),
    // so there can be more than one of these in the DOM at once - update
    // every copy via the shared class, not just whichever a plain
    // getElementById happened to find first (the others would otherwise be
    // stuck on their blank initial state forever).
    const btns = document.querySelectorAll(".js-timeclock-btn");
    if (!btns.length) return;

    if (!PAYROLL_ROLES.includes(session.role)) {
        btns.forEach((btn) => (btn.style.display = "none"));
        return;
    }

    const status = await PayrollSystem.clockStatus();
    btns.forEach((btn) => {
        btn.style.display = "";
        btn.dataset.clockedIn = status.clockedIn ? "1" : "0";
        btn.textContent = status.clockedIn ? "\u23f9 CLOCK OUT" : "\u23f5 CLOCK IN";
        btn.style.background = status.clockedIn ? "var(--color-danger)" : "var(--color-success)";
        btn.style.color = "#000";
        btn.style.border = "none";
    });
}

window.handleTimeclockClick = async () => {
    const btn = document.querySelector(".js-timeclock-btn");
    const clockedIn = btn.dataset.clockedIn === "1";
    try {
        if (clockedIn) {
            await PayrollSystem.clockOut();
            window.showToast("Clocked out");
        } else {
            await PayrollSystem.clockIn();
            window.showToast("Clocked in");
        }
    } catch (e) {
        window.showToast(e.message, "error");
    }
    updateTimeclockWidget();
};

window.handleAccountClick = () => {
    if (session.authenticated) {
        window.renderAccountMenu("nav-account");
    } else {
        renderLoginModal(
            // refreshSession() (inside afterLoginSuccess) has already run by
            // the time this runs, so `session.role` here is the freshly
            // logged-in one, not stale - a staff login lands on the new
            // staff dashboard instead of the customer home page.
            (loginResult) => afterLoginSuccess(loginResult, () => window.showPage(KITCHEN_ROLES.includes(session.role) ? "staff-home" : "home")),
            { title: "LOGIN OR CONTINUE AS GUEST", allowGuest: true, allowRegister: true }
        );
    }
};

/**
 * Small dropdown under the account button - kept separate from Account
 * Settings (rather than nesting Logout inside that modal) so Logout stays a
 * one-click action as more account features get added to Settings later.
 * Shared by the customer nav's account button (#nav-account) and the staff
 * shell's single identity button (#staff-account-btn, see staff-shell.js) -
 * one dropdown pattern for "who am I / settings / log out" everywhere,
 * rather than a separate one-off version for staff.
 */
window.renderAccountMenu = (triggerBtnId = "nav-account") => {
    document.getElementById("account-menu")?.remove();
    const btn = document.getElementById(triggerBtnId);
    if (!btn) return;

    const menu = document.createElement("div");
    menu.id = "account-menu";
    const rect = btn.getBoundingClientRect();
    const menuWidth = 180;

    const items = [];
    if (session.role !== "guest") {
        items.push({ label: "ACCOUNT SETTINGS", action: () => renderAccountSettingsModal(session) });
    }
    // Only a customer/guest gets this (staff always work at their own
    // assigned store - see js/features/store-logic.js) and only when
    // there's actually more than one store to choose from.
    if (TRACKING_ROLES.includes(session.role) && StoreSystem.hasMultipleStores()) {
        const store = StoreSystem.getSelectedStore();
        items.push({ label: store ? `STORE: ${store.name.toUpperCase()}` : "SELECT STORE", action: () => window.openStorePicker() });
    }
    items.push({ label: "LOG OUT", action: doLogout, danger: true });

    // Left-align to the button (not right-align) - right-aligning a menu
    // wider than a short button (e.g. "OWNER") pulls it left underneath
    // whatever nav tab sits before it, which looked like a placement bug.
    // Falls back to right-aligned only if left-aligning would overflow the
    // viewport (e.g. a narrow mobile screen).
    const overflowsRight = rect.left + menuWidth > window.innerWidth;
    const horizontalRule = overflowsRight ? `right: ${window.innerWidth - rect.right}px;` : `left: ${rect.left}px;`;
    // Opens downward by default; flips to opening upward (like the menu
    // page's own category jump popup, which always opens above its FAB)
    // when there isn't room below - the staff rail's account button sits
    // fixed at the very bottom of the screen, where opening down would run
    // the menu off-screen entirely.
    const estimatedMenuHeight = items.length * 41 + 2;
    const opensUp = rect.bottom + 6 + estimatedMenuHeight > window.innerHeight;
    const verticalRule = opensUp ? `bottom: ${window.innerHeight - rect.top + 6}px;` : `top: ${rect.bottom + 6}px;`;
    menu.style.cssText = `
        position: fixed; ${verticalRule} ${horizontalRule}
        background: var(--color-surface); border: 1px solid var(--color-accent);
        min-width: ${menuWidth}px; z-index: 5500; font-family: 'Courier New', monospace;
        box-shadow: 4px 4px 0 rgba(0,0,0,0.4);
    `;

    menu.innerHTML = items
        .map(
            (item, i) => `
        <button data-menu-index="${i}" style="display:block; width:100%; text-align:left; background:none; border:none; ${i > 0 ? "border-top:1px solid var(--color-border);" : ""} color:${item.danger ? "var(--color-danger)" : "var(--color-text)"}; padding:12px 16px; cursor:pointer; font-family:inherit; font-size:8pt; text-transform:uppercase;">${item.label}</button>
    `
        )
        .join("");

    document.body.appendChild(menu);
    menu.querySelectorAll("[data-menu-index]").forEach((el, i) => {
        el.addEventListener("click", () => {
            menu.remove();
            items[i].action();
        });
    });

    setTimeout(() => {
        document.addEventListener(
            "click",
            function closeMenu(e) {
                if (!menu.contains(e.target) && e.target !== btn) {
                    menu.remove();
                    document.removeEventListener("click", closeMenu);
                }
            },
            { once: false }
        );
    }, 0);
}

function doLogout() {
    AuthSystem.logout().then(async () => {
        await refreshSession();
        await refreshBranding();
        window.showPage("home");
    });
}

/**
 * Small toast used to confirm actions like "Settings saved" - several admin
 * save buttons had no feedback at all before, so it looked like clicking
 * them did nothing even when the save succeeded.
 */
/** Stacks (doesn't replace) - a single #app-toast that removed any earlier
 *  one meant an order-ready notice could clobber (or get clobbered by) an
 *  unrelated "Item added"/"Bill updated" toast firing around the same
 *  moment. Each toast is independent, appended to a shared bottom-right
 *  column, so several can be visible/passing by at once. */
window.showToast = (message, tone = "success") => {
    let stack = document.getElementById("app-toast-stack");
    if (!stack) {
        stack = document.createElement("div");
        stack.id = "app-toast-stack";
        stack.style.cssText = "position: fixed; bottom: 24px; right: 24px; z-index: 9000; display: flex; flex-direction: column-reverse; gap: 8px; align-items: flex-end; pointer-events: none;";
        document.body.appendChild(stack);
    }
    const color = tone === "error" ? "var(--color-danger)" : tone === "info" ? "var(--color-cyan)" : "var(--color-success)";
    const toast = document.createElement("div");
    toast.style.cssText = `
        background: var(--color-surface); border: 1px solid ${color}; color: ${color};
        padding: 12px 20px; font-family: 'Courier New', monospace; font-size: 9pt;
        font-weight: bold; box-shadow: 4px 4px 0 rgba(0,0,0,0.4);
        transform: translateY(20px); opacity: 0; transition: transform 0.25s ease, opacity 0.25s ease;
    `;
    toast.textContent = (tone === "error" ? "\u2717 " : tone === "info" ? "" : "\u2713 ") + message;
    stack.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.transform = "translateY(0)";
        toast.style.opacity = "1";
    });
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
        setTimeout(() => toast.remove(), 300);
    }, 2200);
};

/**
 * NAVIGATION & VIEW CONTROL
 */
window.setViewMode = (mode) => {
    viewMode = mode;
    renderMenu(document.getElementById("menu-search")?.value || "");
};

window.showPage = async (pageId) => {
    if (pageId !== "track") stopTrackPolling();

    const needsKitchenRole = pageId === "kitchen" || pageId === "orders" || pageId === "staff-home" || pageId === "billing";
    const needsAdminRole = pageId === "admin";

    if (needsKitchenRole || needsAdminRole) {
        await refreshSession();
        const allowedRoles = needsAdminRole ? MANAGER_UP_ROLES : KITCHEN_ROLES;
        if (!allowedRoles.includes(session.role)) {
            if (session.authenticated) {
                alert("Your account doesn't have access to this page.");
                return;
            }
            renderLoginModal(
                (loginResult) => afterLoginSuccess(loginResult, () => window.showPage(pageId)),
                { title: "STAFF LOGIN REQUIRED", allowGuest: false, allowRegister: false }
            );
            return;
        }
    }

    document.querySelectorAll(".page").forEach((p) => {
        p.style.display = "none";
        p.classList.remove("active");
    });

    const targetPage = document.getElementById(`page-${pageId}`);
    if (targetPage) {
        targetPage.style.display = "block";
        targetPage.classList.add("active");
    }
    // Every OTHER page is display:none while inactive, so switching between
    // them doesn't actually create a new scroll position - the whole
    // document just keeps whatever scrollY the PREVIOUS page was left at,
    // landing a newly-shown page already scrolled partway down. Cart-quantity
    // changes on the menu page are the one deliberate exception to "reset on
    // change" (see renderMenuKeepScroll()) - this only runs on real page
    // navigation, never from those call sites.
    window.scrollTo(0, 0);

    document.querySelectorAll(".system-nav button").forEach((btn) => {
        btn.classList.remove("active-tab");
        if (btn.dataset.navPage === pageId) {
            btn.classList.add("active-tab");
        }
    });

    // Keep the shell's highlighted tab in sync no matter what triggered
    // this navigation (its own nav buttons, or e.g. staff-home's "NEW
    // ORDER" button, or the home hero's "START ORDER" button, calling
    // showPage('menu') directly). The shell shows for EVERY visitor now,
    // including a fully anonymous one (see updateStaffShellForSession()) -
    // this used to gate on session.role, a leftover from when the shell was
    // staff-exclusive, so an anonymous visitor's tab click updated
    // StaffShell.activeTab in memory (see wireButtons()) but the nav DOM
    // never actually re-rendered to show it - Home stayed visually
    // highlighted forever after the first paint.
    StaffShell.setActiveFromPageId(pageId);
    StaffShell.render();

    if (pageId === "staff-home") {
        await renderStaffHome(session);
    }
    if (pageId === "billing") {
        await renderBillingPage();
        ensureOrdersStream();
    }
    if (pageId === "admin") {
        const module = await import("./ui/admin-portal.js");
        await module.AdminPortal.init();
        ensureOrdersStream();
    }
    if (pageId === "menu") renderMenu();
    if (pageId === "kitchen" || pageId === "orders") {
        await KitchenSystem.fetchOrders();
        if (currentKitchenStation === "TABLES") {
            await renderTablesPanel(); // refresh tab totals if the Tables view was left open
        } else {
            renderKitchen();
        }
        ensureOrdersStream();
    }
    if (pageId === "home") {
        renderPopularPicks();
        renderHomeStoreFacts();
        renderHomeRoastSteps();
        renderHomeVisitRows();
        await refreshOrderStatusWidget();
        refreshHomeArcadeButton();
        if (TRACKING_ROLES.includes(session.role)) ensureOrdersStream();
    }
    if (pageId === "arcade") {
        const module = await ensureArcadePageLoaded();
        await module.ArcadePage.init();
        ensureOrdersStream();
    }
    if (pageId === "track") {
        renderTrackPage(new URLSearchParams(window.location.search).get("track"));
    }
};

/** Compact "which store" pill shown next to the LOGIN button for a fully
 *  anonymous visitor (no session at all) - once signed in (even as a
 *  guest), the same control moves into the account dropdown instead (see
 *  renderAccountMenu()) rather than living in two places at once. Exposed
 *  on window since staff-shell.js's identityHtml() (not this module)
 *  renders the anonymous LOGIN button. */
window.storeIndicatorHtml = () => {
    if (!StoreSystem.hasMultipleStores()) return "";
    const store = StoreSystem.getSelectedStore();
    return `<button type="button" id="anon-store-indicator" class="staff-auth-identity"><span class="staff-auth-name">${store ? escapeHtml(store.name.toUpperCase()) : "SELECT STORE"}</span></button>`;
};

window.openStorePicker = () => {
    renderStorePickerModal(async (storeId) => {
        await Promise.all([loadMenu(), AdminConfig.loadSettings(storeId)]);
        window.applyBranding(AdminConfig.settings);
        window.renderFooter(AdminConfig.settings);
        const activePageId = document.querySelector(".page.active")?.id.replace("page-", "");
        if (activePageId === "menu") {
            renderMenu();
        } else if (activePageId === "home") {
            renderHomeStoreFacts();
            renderHomeVisitRows();
        }
        StaffShell.render(); // refreshes the anonymous store pill / dropdown label either way
        window.showToast?.(`Now showing ${StoreSystem.getSelectedStore()?.name || "your store"}`);
    });
};

/** "SERVED" is kitchen-board jargon (an item physically handed to someone
 *  at the counter) - to a customer looking at their own order status it
 *  reads as an odd, ambiguous non-answer ("served... to who? is that
 *  done?"). Every OTHER status word already doubles as a customer-facing
 *  label, this is the one exception, only relabeled where a customer/guest
 *  actually sees it (the kitchen board itself keeps "SERVED", the term its
 *  own staff already know). */
function customerStatusLabel(status) {
    return status === "SERVED" ? "CLOSED" : status;
}

function soundIconSvg(muted) {
    return muted
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:block;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:block;"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03z"/><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
}

// The order this popup click handler shows - kept as module state rather
// than re-fetched on click, since the compact nav widget already has it
// fresh from the render that's currently on screen.
let activeOrderForPopup = null;

async function refreshOrderStatusWidget() {
    // Lives in the nav shell now (rail + topbar, next to the account button)
    // instead of a fixed home-page card, so it's visible from any page - see
    // staff-shell.js's renderRail()/renderTopbar(), which call this after
    // every render (login, logout, layout switch, page navigation).
    const targets = [document.getElementById("rail-order-widget"), document.getElementById("topbar-order-widget"), document.getElementById("mobile-nav-order-widget")].filter(Boolean);
    if (targets.length === 0) return;

    if (!TRACKING_ROLES.includes(session.role)) {
        targets.forEach((el) => (el.innerHTML = ""));
        activeOrderForPopup = null;
        return;
    }

    // "Previous order" fallback opens the same order-history modal as
    // before (with ratings) - see window.openMyOrders().
    const renderFallback = () => {
        targets.forEach((el) => {
            el.innerHTML = `<button type="button" class="nav-order-widget-btn nav-order-widget-prev">Previous order</button>`;
            el.querySelector("button").addEventListener("click", () => window.openMyOrders());
        });
        activeOrderForPopup = null;
    };

    const orders = await KitchenSystem.fetchMine();
    // "Active" = still being made, or reached a terminal state (READY/
    // SERVED) recently enough that the confirmation is still useful - once
    // that's been true for a while, or once there's simply no order, this
    // falls back to "Previous order" instead of showing a stale card forever.
    const READY_VISIBLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
    const activeOrders = orders.filter((o) => {
        if (o.status !== "READY" && o.status !== "SERVED") return true;
        return Date.now() - new Date(o.createdAt).getTime() < READY_VISIBLE_WINDOW_MS;
    });
    if (activeOrders.length === 0) {
        renderFallback();
        return;
    }

    // A customer with two orders running at once (e.g. dine-in + a top-up
    // takeaway) previously only ever saw whichever one .find() happened to
    // land on - the other's status change (including its ready chime) was
    // silently invisible until they reloaded. Check every active order for
    // a chime-worthy transition, not just whichever one gets the compact
    // slot, and always surface an "ALL ORDERS" link so the rest are never
    // more than one tap away.
    for (const o of activeOrders) {
        const previousStatus = lastSeenOrderStatuses[o.id];
        if (o.status === "READY" && previousStatus && previousStatus !== "READY") {
            SoundSystem.playReadyChime();
            NotificationSystem.notifyOrderReady(o);
            // A floating toast alongside the sound/browser-notification -
            // works even when sound is muted or hasn't been unlocked yet
            // (see checkout-modal.js's own notify-permission prompt), and
            // stacks rather than clobbers whatever other toast might be
            // showing at the same moment (see showToast() above).
            window.showToast(`Order #${o.orderNumber || o.id} is ready!`, "success");
        }
        lastSeenOrderStatuses[o.id] = o.status;
    }

    // Pick the single order the compact slot shows inline - READY beats
    // still-cooking (most actionable), ties broken by most recent.
    const STATUS_RANK = { READY: 0, PREPARING: 1, RECEIVED: 1, SERVED: 2 };
    const order = activeOrders.slice().sort((a, b) => {
        const rankDiff = (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1);
        return rankDiff !== 0 ? rankDiff : new Date(b.createdAt) - new Date(a.createdAt);
    })[0];
    activeOrderForPopup = order;
    const STATUS_COLORS = { RECEIVED: "var(--color-accent)", PREPARING: "var(--color-cyan)", READY: "var(--color-success)", SERVED: "var(--color-text-muted)" };
    const statusColor = STATUS_COLORS[order.status] || "var(--color-accent)";
    const extraCount = activeOrders.length - 1;

    // Minimal by design - order number, live status color, that's it. Full
    // detail (items, paid/pending, notification/sound toggles) is one click
    // away in the popup - see window.openOrderStatusPopup(). "ALL ORDERS" is
    // its own always-present link (not just a no-active-order fallback) so a
    // second/third concurrent order is never hidden behind this one.
    const compactHtml = `
        <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" class="nav-order-widget-btn" style="flex:1;">
                <span class="nav-order-widget-num">#${escapeHtml(String(order.orderNumber || order.id))}${extraCount > 0 ? ` <span style="opacity:0.7;">+${extraCount}</span>` : ""}</span>
                <span class="nav-order-widget-status" style="color:${statusColor};">${escapeHtml(customerStatusLabel(order.status))}</span>
            </button>
            <button type="button" class="nav-order-widget-all-btn" title="See all your orders" aria-label="See all your orders" style="flex:none; background:none; border:1px solid var(--color-border); color:var(--color-text-muted); font-size:7pt; letter-spacing:0.05em; padding:0 8px; height:100%; min-height:40px; cursor:pointer; font-family:inherit; text-transform:uppercase;">ALL</button>
        </div>
    `;
    targets.forEach((el) => {
        el.innerHTML = compactHtml;
        el.querySelector(".nav-order-widget-btn").addEventListener("click", () => window.openOrderStatusPopup());
        el.querySelector(".nav-order-widget-all-btn").addEventListener("click", () => window.openMyOrders());
    });
}

/** Full order detail, shown as a popup when the compact nav widget is
 *  clicked - same content the old fixed home-page card used to show
 *  inline, just on demand now instead of always taking up layout space. */
window.openOrderStatusPopup = () => {
    const order = activeOrderForPopup;
    if (!order) return;
    document.getElementById("order-status-popup")?.remove();
    const STATUS_COLORS = { RECEIVED: "var(--color-accent)", PREPARING: "var(--color-cyan)", READY: "var(--color-success)", SERVED: "var(--color-text-muted)" };
    const statusColor = STATUS_COLORS[order.status] || "var(--color-accent)";
    const notifyPromptHtml =
        NotificationSystem.permission() === "default"
            ? `<button id="order-popup-notify-btn" style="background:none; border:none; cursor:pointer; color:var(--color-text-muted); font-size:11pt; padding:0;" title="Get a notification when your order is ready" aria-label="Get a notification when your order is ready">\u{1F514}</button>`
            : "";

    const overlay = document.createElement("div");
    overlay.id = "order-status-popup";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "4500";
    overlay.innerHTML = `
        <div class="modal-content" style="background:var(--color-surface); border:2px solid var(--color-accent); padding:24px; width:min(360px, 92vw); box-sizing:border-box; font-family:'Courier New',monospace;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <span style="font-size:14px; font-weight:bold;">#${escapeHtml(String(order.orderNumber || order.id))}</span>
                <span style="display:flex; align-items:center; gap:8px;">
                    ${notifyPromptHtml}
                    <button id="order-popup-sound-btn" title="${SoundSystem.isMuted() ? "Unmute order-ready sound" : "Mute order-ready sound"}" aria-label="${SoundSystem.isMuted() ? "Unmute order-ready sound" : "Mute order-ready sound"}" style="background:none; border:none; cursor:pointer; color:var(--color-accent); opacity:${SoundSystem.isMuted() ? "0.5" : "1"}; padding:0;">${soundIconSvg(SoundSystem.isMuted())}</button>
                    <span style="color:${statusColor}; font-weight:bold;">${escapeHtml(customerStatusLabel(order.status))}</span>
                </span>
            </div>
            <div style="font-size:10pt; color:var(--color-text-muted); margin-bottom:10px;">${order.items.map((i) => `${i.quantity}x ${escapeHtml(i.name)}`).join(", ")}</div>
            <div style="font-size:10pt; margin-bottom:18px;">${order.isPaid ? "\u2713 Paid" : "Payment pending"} \u00b7 ${currencySymbol()}${order.total.toFixed(2)}</div>
            <button type="button" id="order-popup-close-btn" style="width:100%; padding:11px; background:var(--color-border); color:var(--color-text); border:none; cursor:pointer; text-transform:uppercase; font-family:inherit;">Close</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#order-popup-notify-btn")?.addEventListener("click", (e) => window.requestOrderNotifications(e.currentTarget));
    overlay.querySelector("#order-popup-sound-btn")?.addEventListener("click", (e) => window.toggleOrderSound(e.currentTarget));
    overlay.querySelector("#order-popup-close-btn")?.addEventListener("click", () => overlay.remove());
};
window.refreshOrderStatusWidget = refreshOrderStatusWidget;

/** The hero's second button used to just duplicate "Start order" ("See the
 *  menu" pointed at the same page) - now it's the arcade shortcut instead,
 *  shown only once the same server check the Arcade page itself uses
 *  (ArcadeSystem.checkAccess) says it's actually unlocked. */
async function refreshHomeArcadeButton() {
    const btn = document.getElementById("home-hero-arcade-btn");
    if (!btn) return;
    const access = await ArcadeSystem.checkAccess();
    btn.style.display = access.allowed ? "inline-block" : "none";
}

/**
 * Opens the live-updates connection once per session so every station
 * (kitchen screen, admin view) picks up changes made anywhere else without
 * needing a manual refresh.
 */
let arcadePageModule = null;
async function ensureArcadePageLoaded() {
    if (!arcadePageModule) arcadePageModule = await import("./features/arcade/arcade-page.js");
    return arcadePageModule;
}

function ensureOrdersStream() {
    if (ordersStream) return;
    ordersStream = KitchenSystem.connectLiveUpdates(
        async () => {
            const kitchenPage = document.getElementById("page-kitchen") || document.getElementById("page-orders");
            const kitchenActive = kitchenPage && kitchenPage.classList.contains("active");
            if (kitchenActive) {
                await KitchenSystem.fetchOrders();
                renderKitchen();
            }
            // The order-status widget lives in the nav rail/topbar, not the
            // home page body (see refreshOrderStatusWidget()'s own comment)
            // - it (and the ready chime inside it) needs to refresh no
            // matter which page is showing, not just while home is active.
            if (TRACKING_ROLES.includes(session.role)) {
                await refreshOrderStatusWidget();
            }
            // The staff nav's "Orders" badge (StaffShell.setBadge) also needs
            // a fresh count regardless of which page is showing - re-fetching
            // here only if the Kitchen page didn't already just do it above.
            if (KITCHEN_ROLES.includes(session.role)) {
                if (!kitchenActive) await KitchenSystem.fetchOrders();
                const awaitingFire = KitchenSystem.orders.filter((o) => !o.items.every((i) => i.isDone)).length;
                StaffShell.setBadge("orders", awaitingFire);
            }
        },
        () => {
            const arcadePage = document.getElementById("page-arcade");
            if (arcadePage && arcadePage.classList.contains("active") && arcadePageModule) {
                arcadePageModule.ArcadePage.onArcadeChanged();
            }
        }
    );
}

/**
 * Belt-and-suspenders fallback for customer/guest order status: SSE
 * (ensureOrdersStream) is instant when it works, but a long-lived streaming
 * connection can silently sit buffered/stalled behind a reverse proxy or
 * tunnel that doesn't flush it (confirmed happening through a Cloudflare
 * quick tunnel specifically - the same request streams immediately on a
 * direct connection). A plain periodic re-fetch can't be blocked that way
 * since it's just a normal request/response each time, so this guarantees
 * the widget (and its ready chime) self-corrects within one interval even
 * if the SSE push never arrives at all.
 */
function ensureOrderStatusPolling() {
    if (orderStatusPollTimer) return;
    orderStatusPollTimer = setInterval(() => {
        if (TRACKING_ROLES.includes(session.role)) refreshOrderStatusWidget();
    }, 15000);
}

/**
 * CART LOGIC
 *
 * Because items can carry customization (size/milk/extras/notes), the same
 * menu item id can appear as several distinct cart lines - one per unique
 * combination of choices. Each line gets a stable cartKey (see
 * CustomizationSystem.lineKey) so identical repeat picks merge quantity
 * instead of duplicating, while different picks stay separate.
 */
window.openCustomize = async (id) => {
    const product = menuData.items.find((i) => i.id === id);
    if (!product) return;
    await CustomizationSystem.loadOptions();
    renderCustomizeModal({
        item: product,
        onAdd: (custom) => addCartLine(product, custom)
    });
};

/** The plain, no-frills version of an item (no size/milk/extras/notes) -
 *  what the ADD BIT +/- stepper quick-adds, as distinct from any
 *  customized line created via the CUSTOMIZE modal. */
function defaultCartKey(itemId) {
    return CustomizationSystem.lineKey(itemId, { size: "regular", milk: "regular", extras: [], notes: "" });
}

/** renderMenu() tears down and rebuilds #menu-root's whole innerHTML, which
 *  loses scroll position on mobile Safari (iPad, confirmed) even though the
 *  visible item set hasn't actually changed - just one button's state. Every
 *  cart-quantity change (ADD BIT, the +/- stepper, ADD COMBO) re-renders the
 *  menu this way, so wrap those specific call sites to restore the scroll
 *  position afterward. Filter/category/store-switch re-renders deliberately
 *  keep calling renderMenu() directly instead - scrolling back to the top
 *  when the item set itself changes is expected there. */
function renderMenuKeepScroll() {
    const y = window.scrollY;
    renderMenu();
    window.scrollTo(0, y);
}

window.quickAdd = (itemId) => {
    const product = menuData.items.find((i) => i.id === itemId);
    if (!product) return;
    addCartLine(product, { size: "regular", milk: "regular", extras: [], notes: "", quantity: 1 });
};

window.quickRemove = (itemId) => {
    const cartKey = defaultCartKey(itemId);
    const line = cart.find((c) => c.cartKey === cartKey);
    if (!line) return;
    line.quantity -= 1;
    if (line.quantity <= 0) cart = cart.filter((c) => c.cartKey !== cartKey);
    updateCartUI();
    renderMenuKeepScroll();
    if (document.getElementById("modal-overlay")) {
        if (cart.length === 0) window.closeModal();
        else renderCheckoutModal(cart, serviceChargeActive, tipApplied);
    }
};

function addCartLine(product, custom) {
    const cartKey = CustomizationSystem.lineKey(product.id, custom);
    const existing = cart.find((c) => c.cartKey === cartKey);
    if (existing) {
        existing.quantity += custom.quantity;
    } else {
        const opts = CustomizationSystem.options || { sizeOptions: [], milkOptions: [], extraOptions: [] };
        const sizeOpt = opts.sizeOptions.find((o) => o.key === custom.size);
        const milkOpt = opts.milkOptions.find((o) => o.key === custom.milk);
        const extraObjs = (custom.extras || [])
            .map((k) => opts.extraOptions.find((o) => o.key === k))
            .filter(Boolean);
        cart.push({
            ...product,
            cartKey,
            quantity: custom.quantity,
            price: CustomizationSystem.estimateUnitPrice(discountedBasePrice(product), custom),
            originalPrice: CustomizationSystem.estimateUnitPrice(product.price, custom),
            promoDiscount: product.promoDiscount || null,
            size: sizeOpt ? sizeOpt.key : null,
            sizeLabel: sizeOpt ? sizeOpt.label : null,
            sizePriceDelta: sizeOpt ? sizeOpt.priceDelta : 0,
            milk: milkOpt ? milkOpt.key : null,
            milkLabel: milkOpt ? milkOpt.label : null,
            milkPriceDelta: milkOpt ? milkOpt.priceDelta : 0,
            extras: extraObjs,
            notes: custom.notes || ""
        });
    }
    updateCartUI();
    renderMenuKeepScroll();
}

window.adjustCartLine = (cartKey, delta) => {
    const item = cart.find((c) => c.cartKey === cartKey);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) cart = cart.filter((c) => c.cartKey !== cartKey);
    updateCartUI();
    renderMenuKeepScroll();
    if (document.getElementById("modal-overlay")) {
        if (cart.length === 0) window.closeModal();
        else renderCheckoutModal(cart, serviceChargeActive, tipApplied);
    }
};

window.removeCartLine = (cartKey) => {
    cart = cart.filter((c) => c.cartKey !== cartKey);
    updateCartUI();
    renderMenuKeepScroll();
    if (document.getElementById("modal-overlay")) {
        if (cart.length === 0) window.closeModal();
        else renderCheckoutModal(cart, serviceChargeActive, tipApplied);
    }
};

window.addCombo = (comboId) => {
    const combo = comboData.find((c) => c.id === comboId);
    if (!combo) return;
    const cartKey = `combo-${combo.id}`;
    const existing = cart.find((c) => c.cartKey === cartKey);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({
            cartKey,
            id: null,
            isCombo: true,
            comboId: combo.id,
            name: combo.name,
            price: combo.price,
            quantity: 1,
            extras: [],
            notes: ""
        });
    }
    updateCartUI();
    renderMenuKeepScroll();
    if (document.getElementById("modal-overlay")) renderCheckoutModal(cart, serviceChargeActive, tipApplied);
};

/** Mirrors quickRemove() for combos, so the ADD COMBO button turns into the
 *  same -/qty/+ stepper as ADD BIT once one is in the cart, instead of a
 *  separate "(N in cart)" label glued onto the add button. */
window.comboRemove = (comboId) => {
    const cartKey = `combo-${comboId}`;
    const line = cart.find((c) => c.cartKey === cartKey);
    if (!line) return;
    line.quantity -= 1;
    if (line.quantity <= 0) cart = cart.filter((c) => c.cartKey !== cartKey);
    updateCartUI();
    renderMenuKeepScroll();
    if (document.getElementById("modal-overlay")) {
        if (cart.length === 0) window.closeModal();
        else renderCheckoutModal(cart, serviceChargeActive, tipApplied);
    }
};

function updateCartUI() {
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const counter = document.getElementById("cart-count");
    if (counter) counter.innerText = totalItems;
}

/**
 * PRINTING SYSTEM (BILL & KOT)
 * Both now print exactly what the server confirmed (order.subtotal / .cgst /
 * .sgst / .serviceCharge / .tipAmount / .total) - there's no re-calculation
 * here, so the printed receipt can never drift from what was actually
 * charged/quoted.
 */
/** The receipt content itself - shared by the print window (printBill) and
 *  the on-screen preview (showBillPreview) so clicking an order number ever
 *  shows anything other than exactly what would come out of the printer. */
function billReceiptBodyHtml(order) {
    return `
            <div class="center">
                ${siteConfig.logoUrl ? `<img src="${escapeHtml(siteConfig.logoUrl)}" style="max-width:120px; max-height:60px; margin-bottom:6px;" />` : ""}
                <h3>${escapeHtml(siteConfig.shopName || "SEVEN BITS COFFEE")}</h3>
                <p style="font-size: 8pt;">${siteConfig.footer?.address ? escapeHtml(siteConfig.footer.address) + "<br>" : ""}#${order.orderNumber || order.id} | ${new Date(order.createdAt).toLocaleString()}</p>
                ${siteConfig.gstNumber ? `<p style="font-size: 7pt;">GSTIN: ${escapeHtml(siteConfig.gstNumber)}</p>` : ""}
                ${order.tableNumber ? `<p style="font-size: 10pt; font-weight:bold;">TABLE ${escapeHtml(order.tableNumber)}</p>` : ""}
            </div>
            <div class="hr"></div>
            ${order.items
                .map((item) => {
                    const tags = customizationTagsText(item);
                    return `
                <div class="row" style="align-items: flex-start; flex-direction: column;">
                    <div style="display:flex; justify-content:space-between; width:100%;">
                        <span>${item.quantity}x ${escapeHtml(item.name)}</span>
                        <span>${currencySymbol()}${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                    ${tags ? `<div style="font-size:7pt; color:#555; padding-left:10px;">${tags}</div>` : ""}
                    ${item.notes ? `<div style="font-size:7pt; color:#555; font-style:italic; padding-left:10px;">"${escapeHtml(item.notes)}"</div>` : ""}
                </div>
            `;
                })
                .join("")}
            <div class="hr"></div>
            <div class="row">SUBTOTAL: <span>${currencySymbol()}${order.subtotal.toFixed(2)}</span></div>
            ${order.promoDiscountTotal > 0 ? `<div class="row">PROMO SAVINGS: <span>-${currencySymbol()}${order.promoDiscountTotal.toFixed(2)}</span></div>` : ""}
            ${order.discountAmount > 0 ? `<div class="row">DISCOUNT${order.couponCode ? ` (${escapeHtml(order.couponCode)})` : ""}: <span>-${currencySymbol()}${order.discountAmount.toFixed(2)}</span></div>` : ""}
            <div class="row">TAX (CGST+SGST): <span>${currencySymbol()}${(order.cgst + order.sgst).toFixed(2)}</span></div>
            ${order.serviceChargeActive ? `<div class="row">SVC CHG: <span>${currencySymbol()}${order.serviceCharge.toFixed(2)}</span></div>` : ""}
            ${order.tipApplied ? `<div class="row">GINGER TIP: <span>${currencySymbol()}${order.tipAmount.toFixed(2)}</span></div>` : ""}
            <div class="row total">TOTAL: <span>${currencySymbol()}${order.total.toFixed(2)}</span></div>
            <div class="hr"></div>
            <p class="center" style="font-size: 8pt;">${escapeHtml(siteConfig.receiptFooterText || "Thank you for visiting!")}</p>
            ${
                order.trackingToken
                    ? `<div class="hr"></div>
            <div class="center">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(`${location.origin}${location.pathname}?track=${order.trackingToken}`)}" width="100" height="100" alt="Track order QR" />
                <p style="font-size: 7pt; margin-top: 4px;">SCAN TO TRACK THIS ORDER</p>
            </div>`
                    : ""
            }
    `;
}

/** `.bill-receipt` (not a bare `body` selector) so this same rule block is
 *  safe to reuse inline in the main page's own DOM (showBillPreview) as well
 *  as inside the print window's isolated document (printBill) - a bare
 *  `body{...}` rule would otherwise leak out and restyle the whole app. */
const RECEIPT_STYLE_TAG = `
    <style>
        .bill-receipt { font-family: 'Courier New', monospace; width: 80mm; max-width: 100%; box-sizing: border-box; padding: 10px; color: #000; margin: 0 auto; }
        .bill-receipt .center { text-align: center; }
        .bill-receipt .hr { border-bottom: 1px dashed #000; margin: 10px 0; }
        .bill-receipt .row { display: flex; justify-content: space-between; font-size: 9pt; margin: 3px 0; }
        .bill-receipt .total { font-weight: bold; font-size: 12pt; border-top: 1px solid #000; padding-top: 5px; }
    </style>
`;

window.printBill = (order) => {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
        <html>
        <head>${RECEIPT_STYLE_TAG}</head>
        <body class="bill-receipt" onload="window.print(); window.close();">
            ${billReceiptBodyHtml(order)}
        </body>
        </html>
    `);
    printWindow.document.close();
};

/** On-screen bill preview - clicking an order/bill number (My Orders, Order
 *  History) shows exactly this same receipt markup instead of immediately
 *  triggering a print dialog, with PRINT/CLOSE actions of its own. */
window.showBillPreview = (order) => {
    document.getElementById("bill-preview-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "bill-preview-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5200";
    overlay.innerHTML = `
        <div class="modal-content" style="background:#fff; padding:0; width:min(360px, 92vw); max-height:88vh; overflow-y:auto; border: 2px solid var(--color-accent);">
            ${RECEIPT_STYLE_TAG}
            <div class="bill-receipt" style="padding:16px; width:auto;">${billReceiptBodyHtml(order)}</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:0 16px 16px;">
                <button type="button" id="bill-preview-print" style="padding:11px; background:var(--color-accent); color:var(--color-accent-contrast); border:none; font-weight:bold; cursor:pointer; text-transform:uppercase; font-family:'Courier New', monospace;">Print</button>
                <button type="button" id="bill-preview-close" style="padding:11px; background:#ddd; color:#000; border:none; cursor:pointer; text-transform:uppercase; font-family:'Courier New', monospace;">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("bill-preview-print").addEventListener("click", () => window.printBill(order));
    document.getElementById("bill-preview-close").addEventListener("click", () => overlay.remove());
};

window.printKOT = (order) => {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
        <html>
        <head>
            <style>
                body { font-family: 'Courier New', monospace; width: 80mm; padding: 10px; }
                .header { border-bottom: 2px solid #000; padding-bottom: 5px; text-align: center; }
                .item { font-size: 14pt; font-weight: bold; margin: 10px 0; border-bottom: 1px dashed #ccc; }
            </style>
        </head>
        <body onload="window.print(); window.close();">
            <div class="header">
                <h2>KITCHEN TICKET</h2>
                <p>#${order.orderNumber || order.id} | TYPE: ${order.method}</p>
                ${order.tableNumber ? `<p style="font-size:16pt; font-weight:bold;">TABLE ${escapeHtml(order.tableNumber)}</p>` : ""}
            </div>
            ${order.items
                .map((item) => {
                    const tags = customizationTagsText(item);
                    return `
                <div class="item">
                    ${item.quantity}x ${escapeHtml(item.name)}
                    ${tags ? `<div style="font-size:9pt; font-weight:normal;">${tags}</div>` : ""}
                    ${item.notes ? `<div style="font-size:9pt; font-weight:normal; font-style:italic;">"${escapeHtml(item.notes)}"</div>` : ""}
                </div>
            `;
                })
                .join("")}
            <div style="margin-top: 20px; text-align: center; font-size: 8pt;">${new Date(order.createdAt).toLocaleTimeString()}</div>
        </body>
        </html>
    `);
    printWindow.document.close();
};

/**
 * TRANSACTION FLOW
 * 1. startCheckout() sends the cart to the server and gets back the
 *    authoritative order (real prices, real total, real QR amount).
 * 2. renderPaymentConfirmation() shows that server-confirmed info.
 * 3. finalizeOrder() clears the cart, and prints from the server's order
 *    only for staff/counter flows - customers/guests just see a thank-you
 *    screen with their order number, amount, and an approximate wait time.
 */
window.startCheckout = async (method) => {
    const isStaffCheckout = KITCHEN_ROLES.includes(session.role);
    const btn = document.getElementById("btn-checkout-staff") || document.getElementById(method === "ONLINE" ? "btn-pay-online" : "btn-pay-cash");
    const errorBox = document.getElementById("checkout-error");
    if (errorBox) errorBox.textContent = "";

    // Only staff placing an order on someone's behalf have the guest/phone
    // fields at all - a customer/guest checking themselves out already has
    // an identity from their own session, so their phone is never re-asked.
    const guestOrder = isStaffCheckout ? document.getElementById("checkout-guest-order")?.checked || false : false;
    const phone = isStaffCheckout ? document.getElementById("checkout-phone")?.value || "" : session.phone || "";
    if (isStaffCheckout && !guestOrder && !phone.trim()) {
        if (errorBox) errorBox.textContent = "Enter a phone number, or check GUEST.";
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = "PROCESSING...";
    }

    try {
        const tableSessionId = document.getElementById("checkout-table-session")?.value || null;
        const discount = window.__checkoutDiscount || {};
        const order = await KitchenSystem.pushOrder(cart, method, {
            serviceChargeActive,
            tipApplied,
            phone,
            markPaidNow: false,
            tableSessionId,
            couponCode: discount.couponCode || null,
            redeemPoints: discount.redeemPoints || 0,
            guestOrder,
            orderType,
            // Ignored server-side for a staff session (already tied to its
            // own store) - only matters for a customer/guest who's picked
            // one from the store bar.
            storeId: isStaffCheckout ? null : StoreSystem.getSelectedStoreId()
        });
        pendingOrder = order;

        cart = [];
        serviceChargeActive = true;
        tipApplied = false;
        orderType = "takeaway";
        updateCartUI();
        window.closeModal();

        // Staff hand off to Billing to actually settle the payment (cash,
        // UPI, card, wallet) rather than choosing a method here - the order
        // itself is always created the same way (unpaid, COUNTER) regardless
        // of which checkout button was clicked. Wrapped separately from the
        // order-creation try/catch above: the checkout modal (and its error
        // box) is already gone by this point, so a failure here has to reach
        // the user through a toast instead or it disappears silently.
        if (isStaffCheckout) {
            try {
                selectBillForOrder(order.id);
                await window.showPage("billing");
            } catch (navError) {
                window.showToast?.(`Order #${order.orderNumber || order.id} was created, but opening Billing failed: ${navError.message}`, "error");
            }
            return;
        }

        renderPaymentConfirmation(order, method, { isCustomerFacing: TRACKING_ROLES.includes(session.role) });
    } catch (e) {
        if (errorBox) errorBox.textContent = e.message;
        if (btn) {
            btn.disabled = false;
            btn.textContent = btn.id === "btn-checkout-staff" ? "[ CHECKOUT ]" : method === "ONLINE" ? "PAY ONLINE (UPI)" : "PAY CASH";
        }
    }
};

window.finalizeOrder = (shouldPrint) => {
    const order = pendingOrder;
    pendingOrder = null;

    cart = [];
    serviceChargeActive = true;
    tipApplied = false;
    updateCartUI();
    document.getElementById("payment-overlay")?.remove();
    window.closeModal();
    renderMenu();
    refreshOrderStatusWidget();

    if (order && shouldPrint) {
        setTimeout(() => {
            window.printBill(order);
            window.printKOT(order);
        }, 300);
    }
};

/**
 * DYNAMIC MENU ENGINE
 */
window.initSearchBar = () => {
    const searchInput = document.getElementById("menu-search");
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener("input", (e) => {
            clearTimeout(debounceTimer);
            const value = e.target.value;
            menuSectionPages = {};
            debounceTimer = setTimeout(() => renderMenu(value), 150);
        });
    }
};

window.toggleJumpMenu = (e) => {
    e?.stopPropagation();
    const menu = document.getElementById("jump-menu");
    if (!menu) return;

    if (menu.style.display === "block") {
        menu.style.display = "none";
    } else {
        menu.innerHTML = `
            <div class="jump-header">Categories:</div>
            ${
                comboData.length > 0
                    ? `<div class="jump-option" data-jump="combos"><span class="jump-id">COMBO DEALS</span></div>`
                    : ""
            }
            ${menuData.sections
                .map(
                    (s) => `
                <div class="jump-option" data-jump="${s.id}">
                    <span class="jump-id">${s.title.toUpperCase()}</span>
                </div>
            `
                )
                .join("")}
        `;
        menu.querySelectorAll(".jump-option").forEach((el) => {
            el.addEventListener("click", () => window.jumpTo(el.dataset.jump));
        });
        menu.style.display = "block";
    }
};

/**
 * Menu items no longer live under per-section scroll anchors (see
 * renderMenu - it's one flat, paginated grid/list now, matching the design
 * mockup). This jump menu now drives the same category-chip filter instead
 * of a scroll target, so the existing FAB entry point still works rather
 * than silently doing nothing.
 */
window.jumpTo = (sectionId) => {
    if (sectionId === "combos") {
        activeCategory = "All";
    } else {
        const section = menuData.sections.find((s) => s.id === sectionId);
        if (!section) return;
        activeCategory = section.title;
    }
    menuSectionPages = {};
    renderMenu(document.getElementById("menu-search")?.value || "");
    document.getElementById("menu-root")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("jump-menu").style.display = "none";
};

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Short "Large · Oat Milk · +Extra Shot" style tag list for a customized order/cart line, HTML-escaped. */
function customizationTagsText(item) {
    const tags = [];
    if (item.sizeLabel && item.sizeLabel !== "Regular") tags.push(item.sizeLabel);
    if (item.milkLabel && item.milkLabel !== "Regular Milk") tags.push(item.milkLabel);
    (item.extras || []).forEach((e) => tags.push(`+${e.label}`));
    return tags.map(escapeHtml).join(" \u00b7 ");
}

/** Renders an item's icon - a custom admin-uploaded image if configured for that key, else the built-in CSS icon. */
function iconMarkup(iconKey) {
    const customUrl = siteConfig.customIcons && siteConfig.customIcons[iconKey];
    if (customUrl) {
        return `<img src="${customUrl}" alt="" style="width:32px; height:32px; object-fit:contain;" />`;
    }
    return `<span class="icon icon-${iconKey}"></span>`;
}

/** A menu item's own photo (item.imageUrl, set from Admin > Menu Items)
 *  takes priority over its icon - icons are a placeholder for items that
 *  don't have a real photo yet, not meant to be shown alongside one. */
function itemImageMarkup(item) {
    if (item.imageUrl) {
        return `<img src="${item.imageUrl}" alt="" class="menu-item-photo" />`;
    }
    return iconMarkup(item.icon);
}

/** Standard Indian veg (green square, green dot) / non-veg (brown square,
 *  brown triangle) diet mark - shown on every item, not just non-default
 *  ones, since diet status is always meaningful to a customer regardless
 *  of which way it goes. Pure CSS shapes, no icon asset needed. */
function dietIconHtml(item) {
    if (item.isVeg === false) {
        return `<span class="diet-icon diet-icon-nonveg" role="img" aria-label="Non-vegetarian" title="Non-vegetarian"><span class="diet-icon-triangle"></span></span>`;
    }
    return `<span class="diet-icon diet-icon-veg" role="img" aria-label="Vegetarian" title="Vegetarian"><span class="diet-icon-dot"></span></span>`;
}

/** Only rendered when the item actually has allergens set - clicking OR
 *  hovering shows them. Hover/focus alone (via .field-tooltip's own CSS
 *  popover, already used for admin tooltips) doesn't reliably work on a
 *  touch device, so this also wires a real click handler (toast) rather
 *  than depending on :hover for mobile. */
function allergenBadgeHtml(allergens) {
    const escaped = escapeHtml(allergens);
    return ` <span class="allergen-badge field-tooltip" tabindex="0" role="img" aria-label="Allergens: ${escaped}" title="Allergens: ${escaped}" data-tip="Allergens: ${escaped}" data-allergens="${escaped}" style="font-size:9px;">&#9888;</span>`;
}

/** ALL/VEG/NON-VEG toggle - its own row below the category chips (see
 *  index.html's comment on why it's separate from that row's own
 *  width-measured overflow logic). Rebuilt on every renderMenu() the same
 *  way the chips are, so the active state always matches dietFilter. */
function renderMenuDietFilter() {
    const root = document.getElementById("menu-diet-filter");
    if (!root) return;
    const options = [
        { key: "all", label: "ALL" },
        { key: "veg", label: `${dietIconHtml({ isVeg: true })} VEG` },
        { key: "nonveg", label: `${dietIconHtml({ isVeg: false })} NON-VEG` }
    ];
    root.innerHTML = options
        .map((o) => `<button type="button" class="menu-diet-chip${dietFilter === o.key ? " active" : ""}" data-diet="${o.key}">${o.label}</button>`)
        .join("");
    root.querySelectorAll(".menu-diet-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
            dietFilter = btn.dataset.diet;
            menuSectionPages = {};
            renderMenu(document.getElementById("menu-search")?.value || "");
            // Plain scroll-to-top, not scrollIntoView(#menu-root) - #menu-root
            // sits right below the position:sticky header, so aligning ITS
            // top edge to the viewport top puts it exactly where the sticky
            // header then pins itself too, hiding the section heading and
            // first row of items behind that opaque bar.
            window.scrollTo({ top: 0, behavior: "auto" });
        });
    });
}

/**
 * Category pill row above the menu grid/list, mirroring the mockup's
 * category-chip filter - built fresh each render since it needs to reflect
 * the current activeCategory highlight, and menuData.sections is small.
 *
 * Chips no longer wrap onto their own extra rows at a narrower window width
 * (which used to push the Grid/List toggle down and overlap it) - the row
 * stays single-line, and whichever chips don't fit collapse into a "⋯"
 * overflow button with a popover listing the rest, same idea as the jump
 * menu's popover. The active category always stays visible in the main
 * row (bumping the last chip that fits into overflow instead) so you can
 * always see what's currently selected without opening the popover.
 */
function renderMenuCategoryChips() {
    const root = document.getElementById("menu-cat-chips");
    if (!root) return;
    const cats = ["All", ...menuData.sections.map((s) => s.title)];

    const wireChip = (btn) => {
        btn.addEventListener("click", () => {
            activeCategory = btn.dataset.cat;
            menuSectionPages = {};
            renderMenu(document.getElementById("menu-search")?.value || "");
            // Switching category can shrink the page dramatically (e.g. ALL's
            // long combined list down to one short section) - if the window
            // was scrolled deep into the old list, the browser force-clamps
            // scrollY to whatever now fits, which can yank the sticky cart
            // panel to the literal top of the viewport with no warning.
            // Deliberately scrolling to the top instead makes every filter
            // change land in the same predictable spot. Plain window scroll,
            // not scrollIntoView(#menu-root) - see the comment in
            // renderMenuDietFilter() for why that hides content behind the
            // sticky header instead of revealing it.
            window.scrollTo({ top: 0, behavior: "auto" });
        });
    };
    const chipHtml = (name) => `<button type="button" class="menu-cat-chip${activeCategory === name ? " active" : ""}" data-cat="${escapeHtml(name)}">${escapeHtml(name)}</button>`;

    // Render everything first so widths are measurable, then trim.
    root.innerHTML = cats.map(chipHtml).join("");
    root.querySelectorAll(".menu-cat-chip").forEach(wireChip);

    const containerWidth = root.getBoundingClientRect().width;
    if (containerWidth === 0) return; // not laid out yet (e.g. hidden page) - nothing to measure

    const OVERFLOW_BTN_WIDTH = 44; // reserve room for the "⋯" button, in case it's needed
    const chipEls = Array.from(root.querySelectorAll(".menu-cat-chip"));
    const gap = 7; // matches .menu-cat-chips gap in theme.css
    let usedWidth = 0;
    let visibleCount = chipEls.length;
    for (let i = 0; i < chipEls.length; i++) {
        const w = chipEls[i].getBoundingClientRect().width + (i > 0 ? gap : 0);
        const budget = i < chipEls.length - 1 ? containerWidth - OVERFLOW_BTN_WIDTH - gap : containerWidth;
        if (usedWidth + w > budget) {
            visibleCount = i;
            break;
        }
        usedWidth += w;
    }

    if (visibleCount >= cats.length) return; // everything fits - no overflow menu needed

    const activeIndex = cats.indexOf(activeCategory);
    // Keep the active chip visible even if it would otherwise overflow - swap
    // it in for whichever visible chip would be last, so the active category
    // is never hidden behind the "⋯" popover.
    const visibleIndexes = Array.from({ length: visibleCount }, (_, i) => i);
    if (activeIndex >= visibleCount) {
        visibleIndexes[visibleIndexes.length - 1] = activeIndex;
    }
    const hiddenIndexes = cats.map((_, i) => i).filter((i) => !visibleIndexes.includes(i));

    root.innerHTML = visibleIndexes.map((i) => chipHtml(cats[i])).join("");
    root.querySelectorAll(".menu-cat-chip").forEach(wireChip);

    const overflowBtn = document.createElement("button");
    overflowBtn.type = "button";
    overflowBtn.className = "menu-cat-chip menu-cat-overflow-btn";
    overflowBtn.setAttribute("aria-label", "More categories");
    overflowBtn.textContent = "⋯";
    root.appendChild(overflowBtn);

    overflowBtn.addEventListener("click", () => {
        document.getElementById("menu-cat-overflow-menu")?.remove();
        const rect = overflowBtn.getBoundingClientRect();
        const menu = document.createElement("div");
        menu.id = "menu-cat-overflow-menu";
        menu.className = "menu-cat-overflow-menu";
        menu.style.cssText = `position:fixed; top:${rect.bottom + 6}px; left:${rect.left}px;`;
        menu.innerHTML = hiddenIndexes
            .map((i) => `<button type="button" class="menu-cat-chip${activeCategory === cats[i] ? " active" : ""}" data-cat="${escapeHtml(cats[i])}">${escapeHtml(cats[i])}</button>`)
            .join("");
        document.body.appendChild(menu);
        menu.querySelectorAll(".menu-cat-chip").forEach(wireChip);
        setTimeout(() => {
            document.addEventListener(
                "click",
                function closeMenu(e) {
                    if (!menu.contains(e.target) && e.target !== overflowBtn) {
                        menu.remove();
                        document.removeEventListener("click", closeMenu);
                    }
                },
                { once: false }
            );
        }, 0);
    });
}

/** Prev/Next pager for one section's item grid/list - reuses the same
 *  «‹ X-Y of Z ›» pattern (.admin-pg-btn, see theme.css) already used for
 *  order history/menu-items tables in Admin. Each section paginates on its
 *  own (menuSectionPages[sectionId]), so paging one category doesn't affect
 *  any other. Appended right after that section's grid/list container; a
 *  no-op when that section's items all fit on one page. */
function renderSectionPager(container, sectionId, currentPage, totalItems, totalPages) {
    if (totalPages <= 1) return;

    const pageStart = (currentPage - 1) * MENU_PAGE_SIZE;
    const label = `${pageStart + 1}-${Math.min(pageStart + MENU_PAGE_SIZE, totalItems)} of ${totalItems}`;

    const pagerEl = document.createElement("div");
    pagerEl.className = "menu-pager";
    pagerEl.innerHTML = `
        <button type="button" class="admin-pg-btn" data-page="1" ${currentPage <= 1 ? "disabled" : ""} title="First page">«</button>
        <button type="button" class="admin-pg-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""} title="Previous page">‹</button>
        <span class="menu-pager-label">${label}</span>
        <button type="button" class="admin-pg-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""} title="Next page">›</button>
        <button type="button" class="admin-pg-btn" data-page="${totalPages}" ${currentPage >= totalPages ? "disabled" : ""} title="Last page">»</button>
    `;
    container.appendChild(pagerEl);
    pagerEl.querySelectorAll("[data-page]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const page = Number(btn.dataset.page);
            if (!page || page < 1 || page > totalPages) return;
            menuSectionPages[sectionId] = page;
            renderMenu(document.getElementById("menu-search")?.value || "");
        });
    });
}

function renderMenu(filterQuery = "") {
    const root = document.getElementById("menu-root");
    if (!root) return;
    root.innerHTML = "";
    renderMenuCategoryChips();
    renderMenuDietFilter();
    document.getElementById("menu-view-grid-btn")?.classList.toggle("active", viewMode === "grid");
    document.getElementById("menu-view-list-btn")?.classList.toggle("active", viewMode === "list");

    if (!favoritesFilterActive && !filterQuery && activeCategory === "All" && comboData.length > 0) {
        const comboSection = document.createElement("section");
        comboSection.id = "section-combos";
        comboSection.className = "section-container";
        comboSection.innerHTML = `<h2 class="section-title">COMBO DEALS</h2>`;
        const comboContainer = document.createElement("div");
        comboContainer.className = viewMode === "grid" ? "menu-grid" : "menu-list";
        comboData.forEach((combo) => {
            const count = cart.filter((c) => c.cartKey === `combo-${combo.id}`).reduce((sum, c) => sum + c.quantity, 0);
            const itemList = combo.items
                .map((ci) => {
                    const product = menuData.items.find((m) => m.id === ci.id);
                    return product ? `${ci.quantity}x ${product.name}` : null;
                })
                .filter(Boolean)
                .join(" + ");
            const buttonHTML =
                count > 0
                    ? `<div class="btn-qty-container">
                    <button type="button" class="combo-remove-btn" aria-label="Remove one ${escapeHtml(combo.name)}">-</button>
                    <span>${count}</span>
                    <button type="button" class="combo-add-btn" aria-label="Add one ${escapeHtml(combo.name)}">+</button>
                </div>`
                    : `<button class="btn-add-fixed combo-add-btn">ADD COMBO</button>`;
            const comboEl = document.createElement("div");
            comboEl.className = "menu-item";
            comboEl.innerHTML = `
                <div class="menu-item-banner"><span class="icon icon-cake"></span></div>
                <div class="info">
                    <div class="name">${escapeHtml(combo.name)}</div>
                    <div class="story">${itemList}${combo.description ? ` &middot; ${escapeHtml(combo.description)}` : ""}</div>
                </div>
                <div class="item-controls">
                    <div class="price-fixed">${currencySymbol()}${combo.price}</div>
                    <div class="action-fixed">${buttonHTML}</div>
                </div>
            `;
            comboEl.querySelector(".combo-remove-btn")?.addEventListener("click", () => window.comboRemove(combo.id));
            comboEl.querySelector(".combo-add-btn")?.addEventListener("click", () => window.addCombo(combo.id));
            const comboWrapperEl = document.createElement("div");
            comboWrapperEl.className = "menu-item-wrapper";
            comboWrapperEl.appendChild(comboEl);
            comboContainer.appendChild(comboWrapperEl);
        });
        comboSection.appendChild(comboContainer);
        root.appendChild(comboSection);
    }

    // Each section paginates independently (10 items/page) - not one flat
    // list spanning every section, so paging category A never touches
    // category B's page number. Sections with zero matching items (after
    // the search/favorites filter) are skipped entirely.
    let anyItemsRendered = false;

    menuData.sections.forEach((section) => {
        if (activeCategory !== "All" && activeCategory !== section.title) return;

        const sectionItems = menuData.items.filter((item) => {
            if (item.section !== section.id) return false;
            if (!item.name.toLowerCase().includes(filterQuery.toLowerCase())) return false;
            if (favoritesFilterActive && !FavoritesSystem.isFavorite(item.id)) return false;
            if (dietFilter === "veg" && item.isVeg === false) return false;
            if (dietFilter === "nonveg" && item.isVeg !== false) return false;
            return true;
        });
        if (sectionItems.length === 0) return;
        anyItemsRendered = true;

        const totalPages = Math.max(1, Math.ceil(sectionItems.length / MENU_PAGE_SIZE));
        const currentPage = Math.min(Math.max(1, menuSectionPages[section.id] || 1), totalPages);
        menuSectionPages[section.id] = currentPage;
        const pageStart = (currentPage - 1) * MENU_PAGE_SIZE;
        const items = sectionItems.slice(pageStart, pageStart + MENU_PAGE_SIZE);

        const headerEl = document.createElement("h2");
        headerEl.className = "section-title";
        headerEl.textContent = section.title;
        root.appendChild(headerEl);

        const itemsContainer = document.createElement("div");
        itemsContainer.className = viewMode === "grid" ? "menu-grid" : "menu-list";

        items.forEach((item) => {
            const isSoldOut = item.stockCount === 0;
            const isUnavailable = item.available === false || isSoldOut;
            const isLowStock = item.stockCount != null && item.stockCount > 0 && item.stockCount <= 5;

            // A "default" (no size/milk/extras/notes) line is what ADD BIT quick-adds/removes.
            // Customize creates additional, separately-tracked lines for other combinations -
            // each distinct customization is its own cart/order line (see addCartLine).
            const defaultKey = defaultCartKey(item.id);
            const defaultLine = cart.find((c) => c.cartKey === defaultKey);
            const defaultCount = defaultLine ? defaultLine.quantity : 0;
            const customizedLines = cart.filter((c) => c.id === item.id && c.cartKey !== defaultKey);

            const quickControlsHTML = isUnavailable
                ? `<button class="btn-add-fixed" disabled style="opacity:0.4; cursor:not-allowed;">UNAVAILABLE</button>`
                : defaultCount > 0
                  ? `<div class="btn-qty-container">
                    <button type="button" class="quick-remove-btn" aria-label="Remove one ${escapeHtml(item.name)}">-</button>
                    <span>${defaultCount}</span>
                    <button type="button" class="quick-add-btn" aria-label="Add one ${escapeHtml(item.name)}">+</button>
                </div>`
                  : `<button class="btn-add-fixed quick-add-btn">ADD BIT</button>`;

            const showFavorite = TRACKING_ROLES.includes(session.role);
            const isFav = showFavorite && FavoritesSystem.isFavorite(item.id);
            const favButton = showFavorite
                ? `<button type="button" class="btn-favorite fav-toggle-btn" title="${isFav ? "Remove from favorites" : "Add to favorites"}" aria-label="${isFav ? "Remove from favorites" : "Add to favorites"}" aria-pressed="${isFav}" style="background:none; border:none; cursor:pointer; font-size: 14pt; line-height:1; color: ${isFav ? "var(--color-accent)" : "var(--color-text-muted)"};">${isFav ? "\u2605" : "\u2606"}</button>`
                : "";

            // Staff can flag an item as needing to come off the menu (e.g. out of
            // stock) without themselves having permission to take it down - a
            // manager/owner reviews it from Admin > Menu Items.
            const hasPendingRequest = (item.disableRequests || []).length > 0;
            const staffRequestHtml =
                session.role === "employee" && !isUnavailable
                    ? hasPendingRequest
                        ? `<div style="font-size:6.5pt; color:var(--color-text-muted); margin-top:4px;">DISABLE REQUEST PENDING REVIEW</div>`
                        : `<button class="btn-customize-link request-disable-btn" style="background:none; border:none; color:var(--color-danger); text-decoration:underline; font-size:7pt; cursor:pointer; font-family:inherit; padding:0; margin-top:4px; display:block;">\u26a0 REQUEST DISABLE</button>`
                    : "";

            // Each customized variant already in the cart gets its own row with a
            // +/- stepper right here on the menu page - "+" repeats that exact
            // customization, "-" removes it down to zero, no need to open checkout
            // just to adjust or take off a customized order.
            const customizedRowsHtml = customizedLines
                .map((line) => {
                    const tags = CustomizationSystem.describeLine(line);
                    const label = tags.length ? tags.join(" \u00b7 ") : "Customized";
                    return `
                    <div class="customized-line-row" style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:5px 0; border-top:1px dashed var(--color-border);">
                        <div style="font-size:7.5pt; color:var(--color-text-muted); flex:1;">
                            <span style="color:var(--color-accent);">CUSTOMIZED</span> ${escapeHtml(label)}
                            ${line.notes ? `<div style="font-style:italic;">"${escapeHtml(line.notes)}"</div>` : ""}
                        </div>
                        <div class="btn-qty-container">
                            <button type="button" class="customized-line-btn" data-cart-key="${line.cartKey}" data-delta="-1" title="Remove one" aria-label="Remove one">-</button>
                            <span>${line.quantity}</span>
                            <button type="button" class="customized-line-btn" data-cart-key="${line.cartKey}" data-delta="1" title="Repeat this exact customization" aria-label="Repeat this exact customization">+</button>
                        </div>
                    </div>
                `;
                })
                .join("");

            const customizedPanelHtml = customizedLines.length ? `<div class="customized-lines-panel" style="margin-top:8px;">${customizedRowsHtml}</div>` : "";

            // The customized panel is appended OUTSIDE the .menu-item card (in a plain
            // block wrapper) rather than inside its flex row - .menu-item is a row flex
            // in list view and a COLUMN flex in grid view, and wrapping overflow inside a
            // column-direction flex container opens a new adjacent column instead of
            // stacking below it, which visually overlapped the icon. A wrapper sidesteps
            // that entirely, in both view modes.
            const wrapperEl = document.createElement("div");
            wrapperEl.className = "menu-item-wrapper";

            const promoPrice = discountedBasePrice(item);
            const onPromo = item.promoDiscount && promoPrice < item.price;
            const priceHTML = onPromo
                ? `<span style="text-decoration:line-through; color:var(--color-text-muted); font-size:0.8em;">${currencySymbol()}${item.price}</span> ${currencySymbol()}${promoPrice.toFixed(2)}`
                : `${currencySymbol()}${item.price}`;

            const itemEl = document.createElement("div");
            itemEl.className = "menu-item";
            if (isUnavailable) itemEl.style.opacity = "0.45";
            itemEl.innerHTML = `
                <div class="menu-item-banner">${itemImageMarkup(item)}</div>
                <div class="info">
                    <div class="name">${dietIconHtml(item)}${favButton}${item.name}${item.allergens ? allergenBadgeHtml(item.allergens) : ""}${isSoldOut ? ' <span style="font-size:7pt; color:var(--color-danger); font-weight:normal;">(SOLD OUT)</span>' : isUnavailable ? ' <span style="font-size:7pt; color:var(--color-danger); font-weight:normal;">(UNAVAILABLE)</span>' : isLowStock ? ` <span style="font-size:7pt; color:var(--color-danger); font-weight:normal;">(${item.stockCount} LEFT)</span>` : ""}${onPromo ? ' <span style="color:var(--color-accent); font-size:0.7em;">PROMO</span>' : ""}</div>
                    <div class="story">${item.story}</div>
                    ${isUnavailable ? "" : `<button class="btn-customize-link open-customize-btn" style="display:inline-flex; align-items:baseline; gap:3px; background:none; border:none; color:var(--color-accent); font-size:7pt; cursor:pointer; font-family:inherit; padding:0; margin-top:4px;"><span>+</span><span style="text-decoration:underline;">CUSTOMIZE</span></button>`}
                    ${staffRequestHtml}
                </div>
                <div class="item-controls">
                    <div class="price-fixed">${priceHTML}</div>
                    <div class="action-fixed">${quickControlsHTML}</div>
                </div>
            `;
            wrapperEl.appendChild(itemEl);
            if (customizedPanelHtml) wrapperEl.insertAdjacentHTML("beforeend", customizedPanelHtml);
            wrapperEl.querySelector(".quick-remove-btn")?.addEventListener("click", () => window.quickRemove(item.id));
            wrapperEl.querySelector(".quick-add-btn")?.addEventListener("click", () => window.quickAdd(item.id));
            wrapperEl.querySelector(".fav-toggle-btn")?.addEventListener("click", () => window.toggleFavorite(item.id));
            wrapperEl.querySelector(".allergen-badge")?.addEventListener("click", (e) => {
                window.showToast(e.currentTarget.dataset.allergens, "info");
            });
            wrapperEl.querySelector(".request-disable-btn")?.addEventListener("click", () => window.requestDisableItem(item.id));
            wrapperEl.querySelector(".open-customize-btn")?.addEventListener("click", () => window.openCustomize(item.id));
            wrapperEl.querySelectorAll(".customized-line-btn").forEach((btn) => {
                btn.addEventListener("click", () => window.adjustCartLine(btn.dataset.cartKey, Number(btn.dataset.delta)));
            });
            itemsContainer.appendChild(wrapperEl);
        });

        root.appendChild(itemsContainer);
        renderSectionPager(root, section.id, currentPage, sectionItems.length, totalPages);
    });

    if (!anyItemsRendered) {
        root.innerHTML += favoritesFilterActive
            ? `<p style="text-align:center; padding: 30px; font-size: 9pt; color: var(--color-text-muted);">No favorites yet - tap the \u2606 on any item to add one.</p>`
            : `<p style="text-align:center; padding: 30px; font-size: 9pt; color: var(--color-text-muted);">No items match.</p>`;
    }

    const footer = document.getElementById("footer-actions");
    const cartBar = document.getElementById("cart-status");
    const jumpFab = document.querySelector(".btn-jump-fab");

    if (footer) footer.style.display = "flex";
    if (cartBar) cartBar.style.display = cart.length > 0 ? "flex" : "none";
    // The jump-to-category FAB only earns its place when "All" is selected -
    // once a specific chip narrows the grid down already, a second way to
    // jump to a category is just clutter.
    if (jumpFab) jumpFab.style.display = activeCategory === "All" ? "" : "none";

    renderMenuCartPanel();
}

/**
 * Persistent Cart/KOT panel beside the menu grid, for everyone - see
 * .menu-cart-panel in theme.css and the comment in index.html for why this
 * exists alongside (not instead of) the footer cart bar + checkout modal
 * (the desktop-only breakpoint hides that bar once this panel is showing).
 * Re-runs every time renderMenu() does, which already happens after every
 * cart mutation (addCartLine/adjustCartLine/etc. all call renderMenu()), so
 * this stays in sync for free rather than needing its own set of
 * cart-change listeners.
 */
function renderMenuCartPanel() {
    const panel = document.getElementById("menu-cart-panel");
    if (!panel) return;
    panel.style.display = "flex";

    const breakdown = CartSystem.calculateBreakdown(cart, siteConfig);
    const totalItems = cart.reduce((sum, c) => sum + c.quantity, 0);

    // Group each item's default line together with its own customized
    // variants (rather than raw insertion order) so a size/milk/extras
    // version of something already in the cart lands next to it instead of
    // trailing at the end of the list - same grouping the menu grid/list
    // itself uses (defaultLine + customizedLines side by side per item).
    const seenItemIds = [];
    cart.forEach((line) => {
        if (!seenItemIds.includes(line.id)) seenItemIds.push(line.id);
    });
    const groupedCart = seenItemIds.flatMap((id) => cart.filter((line) => line.id === id));

    panel.innerHTML = `
        <div style="padding:16px 18px 14px; border-bottom:1px dashed var(--color-border); flex:none;">
            <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px;">
                <h2 style="font-size:12.5px; font-weight:bold; letter-spacing:.18em; margin:0; text-transform:uppercase; color:var(--color-accent);">Cart / KOT</h2>
                <span style="font-size:10.5px; color:var(--color-text-muted);">${totalItems} item${totalItems === 1 ? "" : "s"}</span>
            </div>
        </div>
        <div style="flex:1 1 auto; min-height:0; overflow-y:auto; padding:4px 18px;">
            ${
                groupedCart.length === 0
                    ? `<p style="padding:36px 0; text-align:center; color:var(--color-text-muted); font-size:11px; line-height:1.8;">Cart is empty.<br>Tap an item to add it.</p>`
                    : groupedCart
                          .map((line, i) => {
                              const isCustomized = line.cartKey !== defaultCartKey(line.id);
                              // Same shape as the checkout modal's own "CUSTOMIZED" breakdown
                              // (CustomizationSystem.describeLineWithAmounts) - each choice on
                              // its own row with what it added, not just a name tag. Same base
                              // row styling as a plain line too - a customized line isn't a
                              // visually different kind of cart entry, just one with more detail.
                              // Collapsed by default (like the checkout modal's own CUSTOMIZED
                              // tag) - a 3-4 line breakdown per line adds up fast with several
                              // customized items in the cart at once.
                              const detailLines = isCustomized ? CustomizationSystem.describeLineWithAmounts(line) : [];
                              const extraTotal = detailLines.reduce((sum, d) => sum + d.amount, 0);
                              const breakdownId = `menu-cart-breakdown-${i}`;
                              const detailsHtml = isCustomized
                                  ? `
                        <div style="margin-top:4px;">
                            <button type="button" class="menu-cart-customized-toggle" data-target="${breakdownId}" aria-expanded="false" aria-controls="${breakdownId}" style="font-size:9px; font-weight:bold; letter-spacing:.08em; color:var(--color-accent); text-transform:uppercase; cursor:pointer; text-decoration:underline; background:none; border:none; padding:0; font-family:inherit;">Customized</button>
                            <span style="font-size:9px; color:var(--color-text-muted); margin-left:4px;">${currencySymbol()}${extraTotal.toFixed(2)}</span>
                            <div id="${breakdownId}" style="display:none; margin-top:3px;">
                                ${detailLines
                                    .map(
                                        (d) => `
                                <div style="display:flex; justify-content:space-between; gap:8px; font-size:9.5px; color:var(--color-text-muted); padding:1px 0 1px 8px;">
                                    <span>${escapeHtml(d.label)}</span><span>${currencySymbol()}${d.amount.toFixed(2)}</span>
                                </div>`
                                    )
                                    .join("")}
                            </div>
                        </div>`
                                  : "";
                              return `
                <div style="display:flex; align-items:center; gap:10px; padding:11px 0; border-bottom:1px dashed var(--color-border);">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:11.5px; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(line.name)}</div>
                        <div style="font-size:9.5px; color:var(--color-text-muted); margin-top:3px;">${currencySymbol()}${line.price.toFixed(2)} each</div>
                        ${detailsHtml}
                        ${line.notes ? `<div style="font-size:9.5px; color:var(--color-text-muted); font-style:italic; margin-top:2px;">"${escapeHtml(line.notes)}"</div>` : ""}
                    </div>
                    <div class="btn-qty-container">
                        <button type="button" class="menu-cart-qty-btn" data-cart-key="${line.cartKey}" data-delta="-1" aria-label="Decrease quantity of ${escapeHtml(line.name)}">-</button>
                        <span>${line.quantity}</span>
                        <button type="button" class="menu-cart-qty-btn" data-cart-key="${line.cartKey}" data-delta="1" aria-label="Increase quantity of ${escapeHtml(line.name)}">+</button>
                    </div>
                    <span style="width:56px; flex:none; text-align:right; font-size:11px; font-weight:bold;">${currencySymbol()}${(line.price * line.quantity).toFixed(2)}</span>
                </div>
            `;
                          })
                          .join("")
            }
        </div>
        <div style="padding:14px 18px 18px; border-top:1px solid var(--color-border); flex:none;">
            <div style="margin-bottom:12px;">
                <div id="cart-order-type-label" style="font-size:9.5px; font-weight:bold; letter-spacing:.1em; color:var(--color-text-muted); margin-bottom:6px;">ORDER TYPE</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;" role="group" aria-labelledby="cart-order-type-label">
                    <button type="button" class="cart-order-type-btn" data-order-type="takeaway" aria-pressed="${orderType === "takeaway"}" style="padding:9px 6px; background:${orderType === "takeaway" ? "var(--color-accent)" : "transparent"}; color:${orderType === "takeaway" ? "var(--color-accent-contrast)" : "var(--color-text-muted)"}; border:1px solid var(--color-accent); font-size:10px; font-weight:bold; letter-spacing:.08em; text-transform:uppercase; cursor:pointer;">Takeaway</button>
                    <button type="button" class="cart-order-type-btn" data-order-type="dine-in" aria-pressed="${orderType === "dine-in"}" style="padding:9px 6px; background:${orderType === "dine-in" ? "var(--color-accent)" : "transparent"}; color:${orderType === "dine-in" ? "var(--color-accent-contrast)" : "var(--color-text-muted)"}; border:1px solid var(--color-accent); font-size:10px; font-weight:bold; letter-spacing:.08em; text-transform:uppercase; cursor:pointer;">Dine-in</button>
                </div>
            </div>
            <!-- Deliberately no tax/service-charge breakdown here - just the
                 items subtotal while still browsing/adding. Tax, service
                 charge, and tip are calculated (and shown) starting at
                 checkout - see renderCheckoutModal() - and again on the
                 Billing page and the printed bill, not before. -->
            <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px; padding:10px 0 14px;">
                <span style="font-size:11px; font-weight:bold; letter-spacing:.1em;">SUBTOTAL</span>
                <span style="font-size:22px; font-weight:bold; color:var(--color-accent);">${currencySymbol()}${breakdown.subtotal.toFixed(2)}</span>
            </div>
            <button id="staff-cart-checkout-btn" ${cart.length === 0 ? "disabled" : ""} style="width:100%; padding:12px; background:${cart.length ? "var(--color-accent)" : "var(--color-border)"}; color:${cart.length ? "var(--color-accent-contrast)" : "var(--color-text-muted)"}; border:none; font-size:11.5px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; cursor:${cart.length ? "pointer" : "not-allowed"}; min-height:44px;">[ Checkout ]</button>
            <div style="font-size:9px; color:var(--color-text-muted); text-align:center; margin-top:8px; line-height:1.5;">Tax, service charge & tip shown at checkout.</div>
        </div>
    `;
    panel.querySelector("#staff-cart-checkout-btn")?.addEventListener("click", () => window.handleCartStatusClick());
    panel.querySelectorAll(".cart-order-type-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            orderType = btn.dataset.orderType;
            renderMenuCartPanel();
        });
    });
    panel.querySelectorAll(".menu-cart-customized-toggle").forEach((el) => {
        el.addEventListener("click", () => {
            const target = document.getElementById(el.dataset.target);
            if (!target) return;
            const opening = target.style.display === "none";
            target.style.display = opening ? "block" : "none";
            el.setAttribute("aria-expanded", String(opening));
        });
    });
    panel.querySelectorAll(".menu-cart-qty-btn").forEach((btn) => {
        btn.addEventListener("click", () => window.adjustCartLine(btn.dataset.cartKey, Number(btn.dataset.delta)));
    });
}

function paintFavoritesFilterStar() {
    const star = document.getElementById("favorites-filter-star");
    if (!star) return;
    star.innerHTML = favoritesFilterActive ? "&#9733;" : "&#9734;";
    star.style.color = favoritesFilterActive ? "var(--color-accent)" : "var(--color-text-muted)";
}

window.toggleFavoritesFilter = () => {
    favoritesFilterActive = !favoritesFilterActive;
    menuSectionPages = {};
    paintFavoritesFilterStar();
    renderMenu(document.getElementById("menu-search")?.value || "");
};

window.toggleFavorite = async (itemId) => {
    if (!TRACKING_ROLES.includes(session.role)) return;
    try {
        await FavoritesSystem.toggle(itemId);
    } catch (e) {
        alert(e.message || "Could not update favorites");
    }
    renderMenu(document.getElementById("menu-search")?.value || "");
};

window.requestDisableItem = async (itemId) => {
    const note = prompt("Why should this item be taken off the menu? (e.g. out of stock)");
    if (note === null) return; // cancelled
    try {
        const res = await fetch(`/api/menu/${itemId}/disable-request`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note })
        });
        if (!res.ok) throw new Error((await res.json()).error || "Could not send request");
        await loadMenu();
        renderMenu(document.getElementById("menu-search")?.value || "");
        alert("Request sent to management.");
    } catch (e) {
        alert(e.message || "Could not send request");
    }
};

/**
 * MY ORDERS / REORDER
 */
window.openMyOrders = async () => {
    await refreshSession();
    if (!session.authenticated) {
        renderLoginModal(
            (loginResult) => afterLoginSuccess(loginResult, async () => window.openMyOrders()),
            { title: "LOGIN OR CONTINUE AS GUEST", allowGuest: true, allowRegister: true }
        );
        return;
    }
    const orders = await KitchenSystem.fetchMine();
    renderMyOrdersModal(orders, { onReorder: reorderPastOrder });
};

/** Re-adds every line from a past order back into the cart, including its
 *  original size/milk/extras/notes - prices are never copied from the old
 *  order, only item ids, so checkout always recomputes fresh. */
function reorderPastOrder(order) {
    let addedCount = 0;
    order.items.forEach((line) => {
        const product = menuData.items.find((i) => i.id === line.id);
        if (!product) return; // menu item may have been removed/renamed since
        addCartLine(product, {
            size: line.size,
            milk: line.milk,
            extras: (line.extras || []).map((e) => e.key),
            notes: line.notes || "",
            quantity: line.quantity
        });
        addedCount++;
    });
    if (addedCount < order.items.length) {
        alert("Some items from that order are no longer on the menu and were skipped.");
    }
    window.showPage("menu");
}

// NOTE: the cart bar's onclick in index.html calls window.handleCartStatusClick()
// - the previous build only ever wired a separate addEventListener (and the
// onclick target function didn't exist at all), which threw a console error
// on every click even though the bar still happened to work. Defining the
// actual function it calls fixes that and removes the duplicate listener.
window.handleCartStatusClick = async () => {
    if (cart.length === 0) {
        alert("SYSTEM IDLE: Select bits.");
        return;
    }

    await refreshSession();
    if (!session.authenticated) {
        renderLoginModal(
            (loginResult) =>
                afterLoginSuccess(loginResult, async () => {
                    await renderCheckoutModal(cart, serviceChargeActive, tipApplied);
                }),
            { title: "LOGIN OR CONTINUE AS GUEST", allowGuest: true, allowRegister: true }
        );
        return;
    }

    await renderCheckoutModal(cart, serviceChargeActive, tipApplied);
};

/**
 * KITCHEN MANAGEMENT
 */
let kitchenStatusFilter = "active"; // "active" | "history" | "all"
let kitchenSortOrder = "newest"; // "newest" | "oldest"
let kitchenPage = 1; // 1-based; reset to 1 whenever the filtered ticket set changes
const KITCHEN_PAGE_SIZE = 10;

window.filterKitchen = async (station) => {
    currentKitchenStation = station;
    kitchenPage = 1;

    document.querySelectorAll(".kitchen-tabs .admin-tab-btn").forEach((btn) => {
        btn.classList.remove("active");
        if (btn.getAttribute("data-station") === station) {
            btn.classList.add("active");
        }
    });

    const isTablesView = station === "TABLES";
    document.getElementById("kitchen-status-toolbar").style.display = isTablesView ? "none" : "flex";
    document.getElementById("kitchen-orders-root").style.display = isTablesView ? "none" : "flex";
    document.getElementById("tables-panel-root").style.display = isTablesView ? "block" : "none";

    if (isTablesView) {
        await renderTablesPanel();
    } else {
        renderKitchen();
    }
};

/**
 * TABLE SESSIONS (POSTPAID TABS) - staff-only view on the Orders/Kitchen page,
 * selected via the TABLES/TABS tab alongside the station tabs (see filterKitchen).
 */

async function renderTablesPanel() {
    const root = document.getElementById("tables-panel-root");
    const openTables = await TableSessionsSystem.list("open");
    const tableCount = (await AdminConfig.loadSettings()).tableCount ?? 10;

    root.innerHTML = `
        <div style="border:1px solid var(--color-border); padding:14px; background:var(--color-surface);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h3 style="font-size:9pt; letter-spacing:1px; color:var(--color-accent); margin:0;">OPEN TABLES</h3>
                <button class="admin-btn admin-btn-primary" id="open-table-btn">+ OPEN TABLE</button>
            </div>
            ${
                openTables.length === 0
                    ? `<p style="font-size:8pt; color:var(--color-text-muted);">No open tabs right now.</p>`
                    : openTables
                          .map(
                              (t) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px dashed var(--color-border); font-size:9pt;">
                        <div>
                            <strong>TABLE ${escapeHtml(t.tableNumber)}</strong>
                            ${t.customerName || t.customerPhone ? `<span style="color:var(--color-accent); font-size:7pt;"> &middot; ${escapeHtml(t.customerName || "")} ${t.customerPhone ? `(${escapeHtml(t.customerPhone)})` : ""}</span>` : ""}
                            <span style="color:var(--color-text-muted); font-size:7pt;"> &middot; ${t.orderCount} order${t.orderCount === 1 ? "" : "s"} &middot; ${currencySymbol()}${t.total.toFixed(2)} &middot; opened by ${escapeHtml(t.openedBy)}</span>
                        </div>
                        <div>
                            <button class="admin-btn" data-edit-table="${t.id}">EDIT</button>
                            <button class="admin-btn" data-items-table="${t.id}">ITEMS</button>
                            <button class="admin-btn" data-close-table="${t.id}">CLOSE &amp; BILL</button>
                        </div>
                    </div>
                `
                          )
                          .join("")
            }
        </div>
    `;

    document.getElementById("open-table-btn").addEventListener("click", () => {
        renderTableModal({
            tableCount,
            onSave: async (payload) => {
                await TableSessionsSystem.open(payload.tableNumber, payload.note, payload.customerName, payload.customerPhone);
                await renderTablesPanel();
            }
        });
    });

    root.querySelectorAll("[data-edit-table]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const table = openTables.find((t) => t.id === btn.dataset.editTable);
            renderTableModal({
                tableCount,
                table,
                onSave: async (payload) => {
                    await TableSessionsSystem.update(table.id, payload);
                    await renderTablesPanel();
                }
            });
        });
    });

    root.querySelectorAll("[data-close-table], [data-items-table]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.closeTable || btn.dataset.itemsTable;
            const table = await TableSessionsSystem.get(id);
            if (!table) return;
            // Same modal either way now - it's the general "manage this
            // table's bill" view (add/adjust/remove items any time before
            // it's closed), not exclusively a pre-close confirmation. Only
            // difference is which button the staff member actually reached
            // it from; CANCEL always just dismisses without closing.
            renderTableBillModal({
                table,
                onClose: async (markPaid) => {
                    try {
                        await TableSessionsSystem.close(table.id, markPaid);
                        await renderTablesPanel();
                    } catch (e) {
                        alert(e.message);
                    }
                },
                onDismiss: () => renderTablesPanel()
            });
        });
    });
}

window.setKitchenStatusFilter = (filter) => {
    kitchenStatusFilter = filter;
    kitchenPage = 1;
    document.querySelectorAll("[data-status-filter]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.statusFilter === filter);
    });
    renderKitchen();
};

window.setKitchenSort = (sort) => {
    kitchenSortOrder = sort;
    kitchenPage = 1;
    renderKitchen();
};

function renderKitchen() {
    const root = document.getElementById("kitchen-orders-root");
    if (!root) return;
    root.innerHTML = "";

    const sorted = KitchenSystem.orders.slice().sort((a, b) => {
        const diff = new Date(a.createdAt) - new Date(b.createdAt);
        return kitchenSortOrder === "newest" ? -diff : diff;
    });

    // Filter first, THEN paginate the filtered set (10 tickets/page) - the
    // old version filtered and rendered in the same pass, which had no
    // natural place to slice for pagination.
    const isMaster = currentKitchenStation === "MASTER";
    const matchingOrders = [];
    sorted.forEach((order) => {
        const orderIsComplete = !!order.servedAt;
        // ACTIVE hides served orders; HISTORY shows only served ones;
        // ALL shows everything regardless of status.
        if (kitchenStatusFilter === "active" && orderIsComplete) return;
        if (kitchenStatusFilter === "history" && !orderIsComplete) return;

        const itemsToDisplay = isMaster
            ? order.items
            : order.items.filter((i) => {
                  const station = i.station || KitchenSystem.getStation(i);
                  return station === currentKitchenStation && (!i.isDone || kitchenStatusFilter !== "active");
              });
        if (!isMaster && itemsToDisplay.length === 0) return;

        matchingOrders.push({ order, itemsToDisplay });
    });

    if (matchingOrders.length === 0) {
        root.innerHTML = `<p style="color:var(--color-text-muted); font-family:'Courier New',monospace; font-size:9pt;">No ${kitchenStatusFilter === "history" ? "completed" : kitchenStatusFilter === "active" ? "active" : ""} orders${currentKitchenStation !== "MASTER" ? ` for ${currentKitchenStation}` : ""}.</p>`;
        return;
    }

    const totalPages = Math.max(1, Math.ceil(matchingOrders.length / KITCHEN_PAGE_SIZE));
    kitchenPage = Math.min(Math.max(1, kitchenPage), totalPages);
    const pageStart = (kitchenPage - 1) * KITCHEN_PAGE_SIZE;
    const pageOrders = matchingOrders.slice(pageStart, pageStart + KITCHEN_PAGE_SIZE);

    pageOrders.forEach(({ order, itemsToDisplay }) => {
            const allItemsDone = order.items.every((i) => i.isDone);
            const hasPendingItems = itemsToDisplay.some((i) => !i.isDone);
            const status = KitchenSystem.statusOf(order);
            const statusColor = KitchenSystem.STATUS_COLORS[status];

            const ticket = document.createElement("div");
            ticket.className = "kot-ticket";
            ticket.style.borderTop = `4px solid ${statusColor}`;

            const primaryActionHtml = hasPendingItems
                ? `<button class="kot-mark-completed-btn" style="flex:1; padding:10px; background:var(--color-accent); border:2px solid var(--color-accent); color:var(--color-accent-contrast); font-size:11px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; cursor:pointer;">${isMaster ? "Mark all done" : "Mark done"}</button>`
                : isMaster && allItemsDone && !order.servedAt
                  ? `<button class="kot-mark-served-btn" style="flex:1; padding:10px; background:var(--color-success); border:2px solid var(--color-success); color:#000; font-size:11px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; cursor:pointer;">&gt; Mark served</button>`
                  : `<span style="flex:1; padding:10px; text-align:center; font-size:11px; color:var(--color-text-muted); letter-spacing:.08em; text-transform:uppercase;">// served</span>`;

            // Settling a bill (and now, editing its items) is the Billing
            // tab's job exclusively - this used to be a one-tap "Bill"
            // shortcut right here, but that meant two different places could
            // both mark an order paid with no item-editing safety net either
            // one. This is a plain status indicator now, not a control.
            const paidActionHtml = order.isPaid
                ? `<span style="padding:10px 13px; background:none; border:2px solid var(--color-border); color:var(--color-success); font-size:11px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase;">\u2713 Paid</span>`
                : `<span style="padding:10px 13px; background:none; border:2px solid var(--color-border); color:var(--color-text-muted); font-size:11px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase;">Unpaid</span>`;

            ticket.innerHTML = `
            <div class="kot-header">
                <div style="min-width:0;">
                    <div style="font-size:11px; color:var(--color-text-muted); letter-spacing:.08em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">#${escapeHtml(order.orderNumber || order.id)} &middot; ${new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    <div style="font-size:15px; font-weight:bold; margin-top:6px; letter-spacing:.08em; text-transform:uppercase;">${order.tableNumber ? `TABLE ${escapeHtml(order.tableNumber)}` : "COUNTER"}</div>
                </div>
                <span style="flex:none; padding:5px 8px; font-size:10px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; border:1px solid ${statusColor}; color:${statusColor};">${status}</span>
            </div>
            <div class="kot-body">
                ${itemsToDisplay
                    .map((i) => {
                        const tags = customizationTagsText(i);
                        return `
                    <div class="${i.isDone ? "item-done" : "item-pending"}" style="font-size:12.5px; letter-spacing:.04em;">
                        <strong style="color:var(--color-accent);">${i.quantity}x</strong> ${escapeHtml(i.name)}
                        ${isMaster && i.isDone ? '<span style="font-size:10px; opacity:0.5; margin-left:5px;">[OK]</span>' : ""}
                        ${tags ? `<div style="font-size:10.5px; color: var(--color-accent); font-weight:normal;">${tags}</div>` : ""}
                        ${i.notes ? `<div style="font-size:10.5px; color: var(--color-text-muted); font-weight:normal; font-style:italic;">"${escapeHtml(i.notes)}"</div>` : ""}
                    </div>
                `;
                    })
                    .join("")}
            </div>
            <div style="display:flex; gap:8px; margin-top:2px;">${primaryActionHtml}${paidActionHtml}</div>
        `;
            ticket.querySelector(".kot-mark-completed-btn")?.addEventListener("click", () => window.markCompleted(order.id));
            ticket.querySelector(".kot-mark-served-btn")?.addEventListener("click", () => window.markServed(order.id));
            root.appendChild(ticket);
        });

    renderKitchenPager(matchingOrders.length, totalPages);
}

/** Prev/Next pager for the Orders/Kitchen ticket grid - reuses the same
 *  «‹ X-Y of Z ›» pattern (.admin-pg-btn) as the menu grid/list's own
 *  per-section pager and Admin's order-history table. Appended right after
 *  the ticket grid; a no-op when everything fits on one page. */
function renderKitchenPager(totalOrders, totalPages) {
    if (totalPages <= 1) return;
    const root = document.getElementById("kitchen-orders-root");
    if (!root) return;

    const pageStart = (kitchenPage - 1) * KITCHEN_PAGE_SIZE;
    const label = `${pageStart + 1}-${Math.min(pageStart + KITCHEN_PAGE_SIZE, totalOrders)} of ${totalOrders}`;

    const pagerEl = document.createElement("div");
    pagerEl.className = "menu-pager";
    // #kitchen-orders-root is a CSS grid (see theme.css) - without this the
    // pager becomes a grid cell itself instead of spanning the full row.
    pagerEl.style.gridColumn = "1 / -1";
    pagerEl.innerHTML = `
        <button type="button" class="admin-pg-btn" data-page="1" ${kitchenPage <= 1 ? "disabled" : ""} title="First page">«</button>
        <button type="button" class="admin-pg-btn" data-page="${kitchenPage - 1}" ${kitchenPage <= 1 ? "disabled" : ""} title="Previous page">‹</button>
        <span class="menu-pager-label">${label}</span>
        <button type="button" class="admin-pg-btn" data-page="${kitchenPage + 1}" ${kitchenPage >= totalPages ? "disabled" : ""} title="Next page">›</button>
        <button type="button" class="admin-pg-btn" data-page="${totalPages}" ${kitchenPage >= totalPages ? "disabled" : ""} title="Last page">»</button>
    `;
    root.appendChild(pagerEl);
    pagerEl.querySelectorAll("[data-page]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const page = Number(btn.dataset.page);
            if (!page || page < 1 || page > totalPages) return;
            kitchenPage = page;
            renderKitchen();
        });
    });
}

window.markCompleted = async (orderId) => {
    await KitchenSystem.markDone(orderId, currentKitchenStation);
    const order = KitchenSystem.orders.find((o) => o.id === orderId);

    if (order) {
        let msg = `Order #${order.orderNumber || orderId}: `;
        const allDone = order.items.every((i) => i.isDone);

        if (allDone) {
            msg += "Ready";
        } else {
            const stationLabels = { DESSERTS: "Dessert ready", KITCHEN: "Food ready", BARISTA: "Drink ready" };
            msg += stationLabels[currentKitchenStation] || "Done";
        }

        window.triggerGingerAnimation(msg);
    }

    renderKitchen();
};

window.markServed = async (orderId) => {
    try {
        await KitchenSystem.markServed(orderId);
    } catch (e) {
        window.showToast(e.message, "error");
    }
    renderKitchen();
};

/**
 * UI HELPERS & MODALS
 */
window.closeModal = () => document.getElementById("modal-overlay")?.remove();
window.toggleOrderSound = (btn) => {
    const muted = !SoundSystem.isMuted();
    SoundSystem.setMuted(muted);
    btn.innerHTML = soundIconSvg(muted);
    btn.style.opacity = muted ? "0.5" : "1";
    btn.title = muted ? "Unmute order-ready sound" : "Mute order-ready sound";
    btn.setAttribute("aria-label", muted ? "Unmute order-ready sound" : "Mute order-ready sound");
};
window.requestOrderNotifications = async (btn) => {
    await NotificationSystem.requestPermission();
    // Either granted or denied, the browser's choice is final for this
    // origin - re-render so the bell disappears (permission is no longer
    // "default") instead of leaving a now-inert button in the widget.
    btn.remove();
};
/**
 * Both of these used to closeModal() then re-trigger the cart bar's click
 * handler to reopen it - which itself awaits refreshSession() first. That
 * gap between removing the overlay and re-inserting it was long enough for
 * the browser to paint the in-between (no-overlay) frame, causing a visible
 * flash of the page behind the modal. Re-rendering the checkout modal
 * directly (same remove-then-insert renderCheckoutModal already does, but
 * with no async gap in between) keeps it to a single paint.
 */
window.toggleTip = (check) => {
    tipApplied = check;
    renderCheckoutModal(cart, serviceChargeActive, tipApplied);
};
window.removeServiceCharge = () => {
    serviceChargeActive = false;
    renderCheckoutModal(cart, serviceChargeActive, tipApplied);
};

window.triggerGingerAnimation = (message) => {
    const alertBox = document.createElement("div");
    alertBox.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: -300px;
        background: #d97706;
        color: black;
        padding: 12px 25px;
        z-index: 10000;
        border: 2px solid black;
        font-family: 'Courier New', monospace;
        font-weight: bold;
        box-shadow: 5px 5px 0px black;
        transition: all 1s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    `;
    alertBox.innerText = message;
    document.body.appendChild(alertBox);

    setTimeout(() => {
        alertBox.style.left = "20px";
    }, 100);
    setTimeout(() => {
        alertBox.style.left = "110%";
        setTimeout(() => alertBox.remove(), 1000);
    }, 4000);
};

/**
 * GLOBAL EVENT LISTENERS
 */
document.addEventListener("click", (event) => {
    const jumpMenu = document.getElementById("jump-menu");
    const jumpButton = document.querySelector(".btn-jump-fab");

    if (jumpMenu && jumpMenu.style.display === "block") {
        if (!jumpMenu.contains(event.target) && !jumpButton.contains(event.target)) {
            jumpMenu.style.display = "none";
        }
    }
});

/**
 * Renders the home page footer (store details) from admin-configured
 * settings. Sections with nothing filled in are simply omitted rather than
 * showing empty labels.
 */
function footerFieldValueHtml(c) {
    const text = escapeHtml(c.value || c.label);
    return c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;">${text}</a>` : text;
}

window.renderFooter = (config) => {
    const root = document.getElementById("site-footer");
    if (!root) return;
    const f = config.footer || {};
    const customFields = (config.customFooterFields || []).filter((c) => c.value || c.label);
    const socialFields = customFields.filter((c) => c.type === "social");
    const careerFields = customFields.filter((c) => c.type === "career");
    const otherFields = customFields.filter((c) => c.type !== "social" && c.type !== "career");
    const hasAnyDetail = f.address || f.phone || f.email || f.hours || customFields.length > 0;

    if (!hasAnyDetail && !f.tagline) {
        root.innerHTML = "";
        return;
    }

    root.innerHTML = `
        <div class="footer-inner">
            ${f.tagline ? `<div class="footer-tagline">${f.tagline}</div>` : ""}
            <div class="footer-columns">
                ${
                    f.address
                        ? `<div><div class="footer-col-title">Location</div><div class="footer-line">${f.address}</div></div>`
                        : ""
                }
                ${
                    f.phone || f.email
                        ? `<div><div class="footer-col-title">Contact</div><div class="footer-line">${[f.phone, f.email].filter(Boolean).join("\n")}</div></div>`
                        : ""
                }
                ${
                    f.hours
                        ? `<div><div class="footer-col-title">Hours</div><div class="footer-line">${f.hours}</div></div>`
                        : ""
                }
                ${
                    socialFields.length
                        ? `<div><div class="footer-col-title">Social</div>${socialFields.map((c) => `<div class="footer-line">${footerFieldValueHtml(c)}</div>`).join("")}</div>`
                        : ""
                }
                ${
                    careerFields.length
                        ? `<div><div class="footer-col-title">Careers</div>${careerFields.map((c) => `<div class="footer-line">${footerFieldValueHtml(c)}</div>`).join("")}</div>`
                        : ""
                }
                ${otherFields
                    .map((c) => `<div><div class="footer-col-title">${escapeHtml(c.label)}</div><div class="footer-line">${footerFieldValueHtml(c)}</div></div>`)
                    .join("")}
            </div>
        </div>
    `;
};

/**
 * Home page "This week's picks" - a handful of featured items so there's
 * something to click right on arrival, not just an empty page below the
 * hero. Clicking a card adds it to the cart and jumps to the Menu page so
 * the person can see it land there. Which items show and their badge/tag
 * text come from Admin > Branding's "This week's picks" section
 * (siteConfig.homePicks) when the admin has actually curated one; an
 * untouched fresh install falls back to the first few items in the top
 * menu section with a generic static badge set, same as before this was
 * configurable.
 */
function renderPopularPicks() {
    const root = document.getElementById("popular-picks-grid");
    if (!root || !menuData.items.length) return;

    const configuredPicks = (siteConfig.homePicks || [])
        .map((p) => ({ item: menuData.items.find((i) => i.id === p.itemId && !i.deleted), tag: p.tag }))
        .filter((p) => p.item);

    const FALLBACK_BADGES = ["House favourite", "Slow steep", "Baker's pick"];
    let picks;
    if (configuredPicks.length > 0) {
        picks = configuredPicks;
    } else {
        // First section's items are the intended "signature" picks; fall back
        // to the first few items overall if that section is ever empty/renamed.
        const firstSectionId = menuData.sections[0]?.id;
        const items = (firstSectionId ? menuData.items.filter((i) => i.section === firstSectionId) : menuData.items).slice(0, 3);
        picks = items.map((item, i) => ({ item, tag: FALLBACK_BADGES[i] || "" }));
    }

    root.innerHTML = picks
        .map(
            ({ item, tag }) => `
        <button type="button" class="home-pick-card" data-item-id="${item.id}">
            <div class="home-pick-banner">
                ${itemImageMarkup(item)}
                <span class="home-pick-badge">${escapeHtml(tag || "")}</span>
            </div>
            <div class="home-pick-body">
                <span class="home-pick-name">${escapeHtml(item.name)}</span>
                <span class="home-pick-note">${escapeHtml(item.story || "")}</span>
                <div class="home-pick-footer">
                    <span class="home-pick-price">${currencySymbol()}${item.price}</span>
                    <span class="home-pick-add">+ Add</span>
                </div>
            </div>
        </button>
    `
        )
        .join("");
    root.querySelectorAll(".home-pick-card").forEach((btn) => {
        btn.addEventListener("click", () => window.pickFromHome(Number(btn.dataset.itemId)));
    });
}

/**
 * Store-facts strip under the hero - two real, live facts from the public
 * stats endpoint (same data the old live-stats-ticker showed) plus two
 * static facts from Branding config, laid out as one 4-up bar matching the
 * design mockup's storeFacts row.
 */
async function renderHomeStoreFacts() {
    const root = document.getElementById("home-store-facts");
    if (!root) return;

    let stats = null;
    try {
        const res = await fetch("/api/stats/public");
        if (res.ok) stats = await res.json();
    } catch (e) {
        stats = null;
    }

    const waitMins = await fetchCurrentWaitMins();

    const facts = [
        { label: "Open today", value: siteConfig.footer?.hours || "See hours below", color: "var(--color-success)" },
        { label: "Address", value: siteConfig.footer?.address || "-", color: "var(--color-text)" },
        { label: "Orders today", value: stats ? String(stats.ordersToday) : "-", color: "var(--color-text)" },
        { label: "Bits brewed today", value: stats ? String(stats.itemsServedToday) : "-", color: "var(--color-accent)" }
    ];
    if (waitMins != null) {
        facts.push({ label: "Current wait", value: `~${waitMins} min${waitMins === 1 ? "" : "s"}`, color: "var(--color-accent)" });
    }
    root.innerHTML = facts
        .map(
            (f) => `
        <div class="home-fact">
            <div class="home-fact-label">${escapeHtml(f.label)}</div>
            <div class="home-fact-value" style="color:${f.color};">${escapeHtml(f.value)}</div>
        </div>
    `
        )
        .join("");
}

/**
 * "How we roast" process steps - admin-editable from Branding > Home Page
 * Content (siteConfig.roastSteps) so a different shop can tell its own
 * story instead of this one's coffee-roasting specifics. Falls back to the
 * original hardcoded steps on a fresh install with nothing curated yet.
 */
function renderHomeRoastSteps() {
    const root = document.getElementById("home-roast-steps");
    if (!root) return;
    const DEFAULT_STEPS = [
        { name: "Sourced", detail: "Small-batch beans, bought direct, one sack at a time." },
        { name: "Drum roast", detail: "Twelve-minute profile, logged to the second." },
        { name: "Rested", detail: "A few days off-gas before the first pour." },
        { name: "Poured", detail: "Ground to order, never before you walk in." }
    ];
    const configured = siteConfig.roastSteps && siteConfig.roastSteps.length ? siteConfig.roastSteps : DEFAULT_STEPS;
    const steps = configured.map((s, i) => ({ no: String(i + 1).padStart(2, "0"), name: s.name, detail: s.detail }));
    root.innerHTML = steps
        .map(
            (r) => `
        <div class="home-roast-step">
            <span class="home-roast-step-no">${r.no}</span>
            <span class="home-roast-step-name">${escapeHtml(r.name)}</span>
            <span class="home-roast-step-detail">${escapeHtml(r.detail)}</span>
        </div>
    `
        )
        .join("");
}

/** "Find us" widget - real store details from Branding config, skipping any field that isn't set rather than showing a blank row. */
function renderHomeVisitRows() {
    const root = document.getElementById("home-visit-rows");
    if (!root) return;
    const f = siteConfig.footer || {};
    const rows = [
        { label: "Address", value: f.address },
        { label: "Phone", value: f.phone },
        { label: "Email", value: f.email },
        { label: "Hours", value: f.hours },
        // Admin-added fields beyond the fixed set above (Instagram, GST no,
        // WhatsApp, whatever a given shop wants) - see Content -> Store
        // Details -> "+ ADD FIELD".
        ...(siteConfig.customFooterFields || []).map((c) => ({ label: c.label, value: c.value }))
    ].filter((r) => r.value);
    root.innerHTML = rows.length
        ? rows
              .map(
                  (r) => `
        <div class="home-visit-row">
            <span class="home-visit-label">${escapeHtml(r.label)}</span>
            <span class="home-visit-value">${escapeHtml(r.value)}</span>
        </div>
    `
              )
              .join("")
        : `<p style="color:var(--color-text-muted); font-size:11.5px; margin-top:10px;">Store details coming soon.</p>`;
}

window.pickFromHome = (itemId) => {
    window.showPage("menu");
    window.openCustomize(itemId);
};

/** Wires the plain ".system-nav" buttons (HOME/MENU/ARCADE + account) that
 *  index.html starts with. StaffShell.show() (called from refreshSession(),
 *  which runs after this) takes over the nav for every real session -
 *  hiding it (rail layout) or replacing its innerHTML wholesale (topbar
 *  layout, see StaffShell.renderTopbar()) - so this markup/wiring is only
 *  ever live for the brief anonymous window before that first session
 *  check resolves. Exposed on window (not just called once at boot)
 *  because StaffShell.hide() also restores this exact markup from a
 *  string snapshot - dead code today (nothing calls hide()), but calling
 *  this again there if that ever changes costs nothing. */
window.wireCustomerNav = () => {
    document.querySelectorAll(".system-nav button[data-nav-page]").forEach((btn) => {
        btn.addEventListener("click", () => window.showPage(btn.dataset.navPage));
    });
    document.getElementById("nav-account")?.addEventListener("click", () => window.handleAccountClick());
};

/** Everything else with a static onclick-turned-listener lives in markup
 *  that's part of index.html and never gets wholesale innerHTML-replaced
 *  after the initial page load (unlike the customer nav above), so this
 *  only ever needs to run once, here at boot. */
function wireStaticControls() {
    window.wireCustomerNav();
    document.getElementById("home-hero-start-btn")?.addEventListener("click", () => window.showPage("menu"));
    document.getElementById("home-hero-arcade-btn")?.addEventListener("click", () => window.showPage("arcade"));
    document.getElementById("menu-view-grid-btn")?.addEventListener("click", () => window.setViewMode("grid"));
    document.getElementById("menu-view-list-btn")?.addEventListener("click", () => window.setViewMode("list"));
    document.getElementById("favorites-filter-label")?.addEventListener("click", () => window.toggleFavoritesFilter());
    document.getElementById("cart-status")?.addEventListener("click", () => window.handleCartStatusClick());
    document.getElementById("jump-menu-fab-btn")?.addEventListener("click", (e) => window.toggleJumpMenu(e));
    document.querySelectorAll(".kitchen-tabs [data-station]").forEach((btn) => {
        btn.addEventListener("click", () => window.filterKitchen(btn.dataset.station));
    });
    document.querySelectorAll(".kitchen-status-filter [data-status-filter]").forEach((btn) => {
        btn.addEventListener("click", () => window.setKitchenStatusFilter(btn.dataset.statusFilter));
    });
    document.getElementById("kitchen-sort")?.addEventListener("change", (e) => window.setKitchenSort(e.target.value));
}

/**
 * BOOT
 */
(async () => {
    document.addEventListener("click", () => SoundSystem.unlock(), { once: true });
    wireStaticControls();
    StaffShell.captureCustomerNav(); // before refreshSession() can possibly swap it out for an already-logged-in staff session
    await StoreSystem.loadStores();
    await loadMenu();
    await loadCombos();
    await CustomizationSystem.loadOptions();
    // Config/branding loads BEFORE refreshSession() - the shell now renders
    // for every visitor including anonymous ones (see updateStaffShellForSession()),
    // and it reads AdminConfig.settings (shop name, default nav layout) the
    // moment it renders - loading config after would flash the "YOUR SHOP"
    // fallback wordmark first. The stored store choice is safe to send even
    // before we know if this is a customer or a staff member logging back
    // in - the server only ever honors it for a session with no store of
    // its own (see configForSession() in server.js).
    const config = await AdminConfig.loadSettings(StoreSystem.getSelectedStoreId());
    window.applyBranding(config);
    window.renderFooter(config);
    await refreshSession();
    window.initSearchBar();
    // A scanned tracking QR (?track=<token>) is an explicit deep link - takes
    // priority over the normal landing page even for a signed-in session.
    if (new URLSearchParams(window.location.search).get("track")) {
        await window.showPage("track");
    } else {
        await window.showPage(KITCHEN_ROLES.includes(session.role) ? "staff-home" : "home");
    }
    // Only now - after the role-appropriate page is actually showing - is it
    // safe to reveal what was underneath (see the overlay's own comment in
    // index.html for why it's there at all).
    document.getElementById("boot-loading-overlay")?.remove();
})().catch(() => {
    // However boot failed, a customer stuck staring at "LOADING..." forever
    // is worse than seeing the plain static homepage - reveal it rather than
    // hide the failure behind an overlay with no way through.
    document.getElementById("boot-loading-overlay")?.remove();
});
