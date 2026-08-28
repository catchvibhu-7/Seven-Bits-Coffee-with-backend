/**
 * SEVEN BITS COFFEE - MAIN APPLICATION LOGIC
 * Location: /js/app.js
 */
import { KitchenSystem } from "./features/kitchen-logic.js";
import { CartSystem, discountedBasePrice } from "./features/cart-logic.js";
import { AuthSystem } from "./features/auth-logic.js";
import { AdminConfig } from "./features/config-logic.js";
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
import { SoundSystem } from "./features/sound-logic.js";
import { NotificationSystem } from "./features/notification-logic.js";
import { StaffShell } from "./ui/staff-shell.js";
import { renderStaffHome } from "./ui/staff-home.js";
import { renderBillingPage } from "./ui/billing-page.js";
import { ArcadeSystem } from "./features/arcade-logic.js";

// --- System State ---
let cart = [];
let serviceChargeActive = true;
let tipApplied = false;
let currentKitchenStation = "MASTER"; // matches the "ALL" tab that's marked active by default in index.html
let viewMode = "list";
let menuData = { sections: [], items: [] };
let siteConfig = {}; // last-loaded config (colors/customIcons/etc.) for icon rendering + branding
let pendingOrder = null; // order returned by the server, waiting to be printed
let ordersStream = null; // SSE connection, opened once after the first authenticated view
let session = { authenticated: false, role: null, name: null, phone: null }; // current login state
let favoritesFilterActive = false;
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
    const res = await fetch("/api/menu");
    menuData = await res.json();
}

async function loadCombos() {
    const res = await fetch("/api/combos");
    comboData = res.ok ? await res.json() : [];
}

async function refreshSession() {
    session = await AuthSystem.getSession();
    updateStaffShellForSession();
    updateNavForSession();
    if (TRACKING_ROLES.includes(session.role)) {
        await FavoritesSystem.load();
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
 * tab CONTENTS differ by role. Only a fully anonymous visitor with no
 * session at all (never logged in, registered, or started a guest checkout)
 * falls back to the untouched customer top nav. This is the one place that
 * decision gets made, on every session refresh (login, logout, and initial
 * page load).
 */
function updateStaffShellForSession() {
    const currentPageId = document.querySelector(".page.active")?.id.replace("page-", "") || null;
    if (session.role) {
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
    } else {
        StaffShell.hide();
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

    // #my-orders-link-section's visibility is owned by refreshOrderStatusWidget()
    // now (it shares one widget-card slot with #order-status-section on the
    // redesigned home page) rather than being force-shown here.

    const favFilterLabel = document.getElementById("favorites-filter-label");
    if (favFilterLabel) favFilterLabel.style.display = TRACKING_ROLES.includes(session.role) ? "flex" : "none";
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
                await proceed();
            },
            async () => {
                await AuthSystem.logout();
                await refreshSession();
                window.showPage("home");
            }
        );
        return;
    }
    await refreshSession();
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
    if (captionEl) captionEl.textContent = "The counter" + (config.footer?.address ? ` · ${config.footer.address}` : "");

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
    // member too, so they always have the shell active.
    const btn = document.getElementById("staff-timeclock-btn");
    if (!btn) return;

    if (!PAYROLL_ROLES.includes(session.role)) {
        btn.style.display = "none";
        return;
    }

    btn.style.display = "";
    const status = await PayrollSystem.clockStatus();
    btn.dataset.clockedIn = status.clockedIn ? "1" : "0";
    btn.textContent = status.clockedIn ? "\u23f9 CLOCK OUT" : "\u23f5 CLOCK IN";
    btn.style.background = status.clockedIn ? "var(--color-danger)" : "var(--color-success)";
    btn.style.color = "#000";
    btn.style.border = "none";
}

window.handleTimeclockClick = async () => {
    const btn = document.getElementById("staff-timeclock-btn");
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
        window.showPage("home");
    });
}

/**
 * Small toast used to confirm actions like "Settings saved" - several admin
 * save buttons had no feedback at all before, so it looked like clicking
 * them did nothing even when the save succeeded.
 */
window.showToast = (message, tone = "success") => {
    document.getElementById("app-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "app-toast";
    const color = tone === "error" ? "var(--color-danger)" : "var(--color-success)";
    toast.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 9000;
        background: var(--color-surface); border: 1px solid ${color}; color: ${color};
        padding: 12px 20px; font-family: 'Courier New', monospace; font-size: 9pt;
        font-weight: bold; box-shadow: 4px 4px 0 rgba(0,0,0,0.4);
        transform: translateY(20px); opacity: 0; transition: all 0.25s ease;
    `;
    toast.textContent = (tone === "error" ? "\u2717 " : "\u2713 ") + message;
    document.body.appendChild(toast);
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

    document.querySelectorAll(".system-nav button").forEach((btn) => {
        btn.classList.remove("active-tab");
        if (btn.getAttribute("onclick") && btn.getAttribute("onclick").includes(`'${pageId}'`)) {
            btn.classList.add("active-tab");
        }
    });

    // Keep the staff shell's highlighted tab in sync no matter what
    // triggered this navigation (its own nav buttons, or e.g. staff-home's
    // "NEW ORDER" button calling showPage('menu') directly).
    if (KITCHEN_ROLES.includes(session.role)) {
        StaffShell.setActiveFromPageId(pageId);
        StaffShell.render();
    }

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
};

/**
 * Shows the signed-in customer's/guest's current order and its live status
 * on the home page - but ONLY when there's an actual order in progress.
 * Staff, nobody logged in, a customer/guest with no orders, and a
 * customer/guest whose only orders are already fully completed all just
 * don't show this section at all, rather than an empty/prompt state taking
 * up space on every visit.
 */
function soundIconSvg(muted) {
    return muted
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:block;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:block;"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03z"/><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
}

async function refreshOrderStatusWidget() {
    const section = document.getElementById("order-status-section");
    const root = document.getElementById("order-status-root");
    const myOrdersLink = document.getElementById("my-orders-link-section");
    if (!section || !root) return;

    // The two share one widget-card slot (see index.html) - whichever isn't
    // showing the live order falls back to the always-available reorder
    // shortcut, so that card is never empty.
    const showFallback = () => {
        section.style.display = "none";
        if (myOrdersLink) myOrdersLink.style.display = "block";
    };

    if (!TRACKING_ROLES.includes(session.role)) {
        showFallback();
        return;
    }

    const orders = await KitchenSystem.fetchMine();
    // "Active" = still being made, or reached a terminal state (READY/
    // SERVED) recently enough that the confirmation is still useful - once
    // that's been true for a while, or once there's simply no order, this
    // section just disappears rather than showing an empty/prompt state
    // indefinitely.
    const READY_VISIBLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
    const activeOrder = orders.find((o) => {
        if (o.status !== "READY" && o.status !== "SERVED") return true;
        return Date.now() - new Date(o.createdAt).getTime() < READY_VISIBLE_WINDOW_MS;
    });
    if (!activeOrder) {
        showFallback();
        return;
    }

    const order = activeOrder;
    const STATUS_COLORS = { RECEIVED: "var(--color-accent)", PREPARING: "var(--color-cyan)", READY: "var(--color-success)", SERVED: "var(--color-text-muted)" };
    const statusColor = STATUS_COLORS[order.status] || "var(--color-accent)";

    // Only chime on the moment an order becomes READY (not on every poll
    // while it stays READY, and not for an order that was already READY the
    // first time we ever saw it - e.g. a page refresh after pickup was
    // already announced).
    const previousStatus = lastSeenOrderStatuses[order.id];
    if (order.status === "READY" && previousStatus && previousStatus !== "READY") {
        SoundSystem.playReadyChime();
        NotificationSystem.notifyOrderReady(order);
    }
    lastSeenOrderStatuses[order.id] = order.status;

    // Only offer the "enable notifications" prompt when we haven't asked yet
    // (permission === "default") - once granted or denied, the browser's
    // own choice stands and nagging again would just be annoying.
    const notifyPromptHtml =
        NotificationSystem.permission() === "default"
            ? `<button onclick="window.requestOrderNotifications(this)" style="background:none; border:none; cursor:pointer; color:var(--color-text-muted); font-size:11pt; padding:0;" title="Get a notification when your order is ready">\u{1F514}</button>`
            : "";

    section.style.display = "block";
    if (myOrdersLink) myOrdersLink.style.display = "none";
    root.innerHTML = `
        <div class="status-card" style="border:1px solid var(--color-accent); padding:15px; font-family:'Courier New',monospace;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <span>#${order.orderNumber || order.id}</span>
                <span style="display:flex; align-items:center; gap:8px;">
                    ${notifyPromptHtml}
                    <button onclick="window.toggleOrderSound(this)" title="${SoundSystem.isMuted() ? "Unmute order-ready sound" : "Mute order-ready sound"}" style="background:none; border:none; cursor:pointer; color:var(--color-accent); opacity:${SoundSystem.isMuted() ? "0.5" : "1"}; padding:0;">${soundIconSvg(SoundSystem.isMuted())}</button>
                    <span style="color:${statusColor}; font-weight:bold;">${order.status}</span>
                </span>
            </div>
            <div style="font-size:9pt; color:var(--color-text-muted);">${order.items.map((i) => `${i.quantity}x ${i.name}`).join(", ")}</div>
            <div style="font-size:9pt; margin-top:8px;">${order.isPaid ? "\u2713 Paid" : "Payment pending"} \u00b7 \u20b9${order.total.toFixed(2)}</div>
        </div>
    `;
}

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
    if (!arcadePageModule) arcadePageModule = await import("./ui/arcade-page.js");
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
            const homePage = document.getElementById("page-home");
            if (homePage && homePage.classList.contains("active")) {
                await refreshOrderStatusWidget();
            }
            // The staff nav's "Orders" badge (StaffShell.setBadge) needs a
            // fresh count regardless of which page is showing, unlike the
            // two blocks above which only bother re-rendering a page the
            // person is actually looking at - re-fetching here only if the
            // Kitchen page didn't already just do it above.
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
    renderMenu();
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
    renderMenu();
}

window.adjustCartLine = (cartKey, delta) => {
    const item = cart.find((c) => c.cartKey === cartKey);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) cart = cart.filter((c) => c.cartKey !== cartKey);
    updateCartUI();
    renderMenu();
    if (document.getElementById("modal-overlay")) {
        if (cart.length === 0) window.closeModal();
        else renderCheckoutModal(cart, serviceChargeActive, tipApplied);
    }
};

window.removeCartLine = (cartKey) => {
    cart = cart.filter((c) => c.cartKey !== cartKey);
    updateCartUI();
    renderMenu();
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
    renderMenu();
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
    renderMenu();
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
window.printBill = (order) => {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
        <html>
        <head>
            <style>
                body { font-family: 'Courier New', monospace; width: 80mm; padding: 10px; color: #000; }
                .center { text-align: center; }
                .hr { border-bottom: 1px dashed #000; margin: 10px 0; }
                .row { display: flex; justify-content: space-between; font-size: 9pt; margin: 3px 0; }
                .total { font-weight: bold; font-size: 12pt; border-top: 1px solid #000; padding-top: 5px; }
            </style>
        </head>
        <body onload="window.print(); window.close();">
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
                        <span>\u20b9${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                    ${tags ? `<div style="font-size:7pt; color:#555; padding-left:10px;">${tags}</div>` : ""}
                    ${item.notes ? `<div style="font-size:7pt; color:#555; font-style:italic; padding-left:10px;">"${escapeHtml(item.notes)}"</div>` : ""}
                </div>
            `;
                })
                .join("")}
            <div class="hr"></div>
            <div class="row">SUBTOTAL: <span>\u20b9${order.subtotal.toFixed(2)}</span></div>
            ${order.promoDiscountTotal > 0 ? `<div class="row">PROMO SAVINGS: <span>-\u20b9${order.promoDiscountTotal.toFixed(2)}</span></div>` : ""}
            ${order.discountAmount > 0 ? `<div class="row">DISCOUNT${order.couponCode ? ` (${escapeHtml(order.couponCode)})` : ""}: <span>-\u20b9${order.discountAmount.toFixed(2)}</span></div>` : ""}
            <div class="row">TAX (CGST+SGST): <span>\u20b9${(order.cgst + order.sgst).toFixed(2)}</span></div>
            ${order.serviceChargeActive ? `<div class="row">SVC CHG: <span>\u20b9${order.serviceCharge.toFixed(2)}</span></div>` : ""}
            ${order.tipApplied ? `<div class="row">GINGER TIP: <span>\u20b9${order.tipAmount.toFixed(2)}</span></div>` : ""}
            <div class="row total">TOTAL: <span>\u20b9${order.total.toFixed(2)}</span></div>
            <div class="hr"></div>
            <p class="center" style="font-size: 8pt;">${escapeHtml(siteConfig.receiptFooterText || "Thank you for visiting!")}</p>
        </body>
        </html>
    `);
    printWindow.document.close();
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
    const btn = document.getElementById(method === "ONLINE" ? "btn-pay-online" : "btn-pay-cash");
    const errorBox = document.getElementById("checkout-error");
    if (errorBox) errorBox.textContent = "";

    const phone = document.getElementById("checkout-phone")?.value || "";
    if (!phone.trim()) {
        if (errorBox) errorBox.textContent = "Enter a phone number so this order can be tracked.";
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = "PROCESSING...";
    }

    try {
        const markPaidNow = document.getElementById("checkout-mark-paid-now")?.checked || false;
        const tableSessionId = document.getElementById("checkout-table-session")?.value || null;
        const discount = window.__checkoutDiscount || {};
        const order = await KitchenSystem.pushOrder(cart, method, {
            serviceChargeActive,
            tipApplied,
            phone,
            markPaidNow,
            tableSessionId,
            couponCode: discount.couponCode || null,
            redeemPoints: discount.redeemPoints || 0
        });
        pendingOrder = order;
        renderPaymentConfirmation(order, method, { isCustomerFacing: TRACKING_ROLES.includes(session.role) });
    } catch (e) {
        if (errorBox) errorBox.textContent = e.message;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = method === "ONLINE" ? "PAY ONLINE (UPI)" : "PAY CASH";
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

window.toggleJumpMenu = () => {
    if (event) event.stopPropagation();
    const menu = document.getElementById("jump-menu");
    if (!menu) return;

    if (menu.style.display === "block") {
        menu.style.display = "none";
    } else {
        menu.innerHTML = `
            <div class="jump-header">Categories:</div>
            ${
                comboData.length > 0
                    ? `<div class="jump-option" onclick="window.jumpTo('combos')"><span class="jump-id">COMBO DEALS</span></div>`
                    : ""
            }
            ${menuData.sections
                .map(
                    (s) => `
                <div class="jump-option" onclick="window.jumpTo('${s.id}')">
                    <span class="jump-id">${s.title.toUpperCase()}</span>
                </div>
            `
                )
                .join("")}
        `;
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
                    <button onclick="window.comboRemove(${combo.id})">-</button>
                    <span>${count}</span>
                    <button onclick="window.addCombo(${combo.id})">+</button>
                </div>`
                    : `<button class="btn-add-fixed" onclick="window.addCombo(${combo.id})">ADD COMBO</button>`;
            const comboEl = document.createElement("div");
            comboEl.className = "menu-item";
            comboEl.innerHTML = `
                <div class="menu-item-banner"><span class="icon icon-cake"></span></div>
                <div class="info">
                    <div class="name">${escapeHtml(combo.name)}</div>
                    <div class="story">${itemList}${combo.description ? ` &middot; ${escapeHtml(combo.description)}` : ""}</div>
                </div>
                <div class="item-controls">
                    <div class="price-fixed">\u20b9${combo.price}</div>
                    <div class="action-fixed">${buttonHTML}</div>
                </div>
            `;
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
                    <button onclick="window.quickRemove(${item.id})">-</button>
                    <span>${defaultCount}</span>
                    <button onclick="window.quickAdd(${item.id})">+</button>
                </div>`
                  : `<button class="btn-add-fixed" onclick="window.quickAdd(${item.id})">ADD BIT</button>`;

            const showFavorite = TRACKING_ROLES.includes(session.role);
            const isFav = showFavorite && FavoritesSystem.isFavorite(item.id);
            const favButton = showFavorite
                ? `<button class="btn-favorite" onclick="window.toggleFavorite(${item.id})" title="${isFav ? "Remove from favorites" : "Add to favorites"}" style="background:none; border:none; cursor:pointer; font-size: 14pt; line-height:1; color: ${isFav ? "var(--color-accent)" : "var(--color-text-muted)"};">${isFav ? "\u2605" : "\u2606"}</button>`
                : "";

            // Staff can flag an item as needing to come off the menu (e.g. out of
            // stock) without themselves having permission to take it down - a
            // manager/owner reviews it from Admin > Menu Items.
            const hasPendingRequest = (item.disableRequests || []).length > 0;
            const staffRequestHtml =
                session.role === "employee" && !isUnavailable
                    ? hasPendingRequest
                        ? `<div style="font-size:6.5pt; color:var(--color-text-muted); margin-top:4px;">DISABLE REQUEST PENDING REVIEW</div>`
                        : `<button class="btn-customize-link" onclick="window.requestDisableItem(${item.id})" style="background:none; border:none; color:var(--color-danger); text-decoration:underline; font-size:7pt; cursor:pointer; font-family:inherit; padding:0; margin-top:4px; display:block;">\u26a0 REQUEST DISABLE</button>`
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
                            <button onclick="window.adjustCartLine('${line.cartKey}', -1)" title="Remove one">-</button>
                            <span>${line.quantity}</span>
                            <button onclick="window.adjustCartLine('${line.cartKey}', 1)" title="Repeat this exact customization">+</button>
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
                ? `<span style="text-decoration:line-through; color:var(--color-text-muted); font-size:0.8em;">\u20b9${item.price}</span> \u20b9${promoPrice.toFixed(2)}`
                : `\u20b9${item.price}`;

            const itemEl = document.createElement("div");
            itemEl.className = "menu-item";
            if (isUnavailable) itemEl.style.opacity = "0.45";
            itemEl.innerHTML = `
                <div class="menu-item-banner">${itemImageMarkup(item)}</div>
                <div class="info">
                    <div class="name">${favButton}${item.name}${isSoldOut ? ' <span style="font-size:7pt; color:var(--color-danger); font-weight:normal;">(SOLD OUT)</span>' : isUnavailable ? ' <span style="font-size:7pt; color:var(--color-danger); font-weight:normal;">(UNAVAILABLE)</span>' : isLowStock ? ` <span style="font-size:7pt; color:var(--color-danger); font-weight:normal;">(${item.stockCount} LEFT)</span>` : ""}${onPromo ? ' <span style="color:var(--color-accent); font-size:0.7em;">PROMO</span>' : ""}</div>
                    <div class="story">${item.story}</div>
                    ${isUnavailable ? "" : `<button class="btn-customize-link" onclick="window.openCustomize(${item.id})" style="background:none; border:none; color:var(--color-accent); text-decoration:underline; font-size:7pt; cursor:pointer; font-family:inherit; padding:0; margin-top:4px;">+ CUSTOMIZE (SIZE/MILK/EXTRAS)</button>`}
                    ${staffRequestHtml}
                </div>
                <div class="item-controls">
                    <div class="price-fixed">${priceHTML}</div>
                    <div class="action-fixed">${quickControlsHTML}</div>
                </div>
            `;
            wrapperEl.appendChild(itemEl);
            if (customizedPanelHtml) wrapperEl.insertAdjacentHTML("beforeend", customizedPanelHtml);
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
                            <span onclick="const el=document.getElementById('${breakdownId}'); el.style.display = el.style.display === 'none' ? 'block' : 'none';" style="font-size:9px; font-weight:bold; letter-spacing:.08em; color:var(--color-accent); text-transform:uppercase; cursor:pointer; text-decoration:underline;">Customized</span>
                            <span style="font-size:9px; color:var(--color-text-muted); margin-left:4px;">₹${extraTotal.toFixed(2)}</span>
                            <div id="${breakdownId}" style="display:none; margin-top:3px;">
                                ${detailLines
                                    .map(
                                        (d) => `
                                <div style="display:flex; justify-content:space-between; gap:8px; font-size:9.5px; color:var(--color-text-muted); padding:1px 0 1px 8px;">
                                    <span>${escapeHtml(d.label)}</span><span>₹${d.amount.toFixed(2)}</span>
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
                        <div style="font-size:9.5px; color:var(--color-text-muted); margin-top:3px;">₹${line.price.toFixed(2)} each</div>
                        ${detailsHtml}
                        ${line.notes ? `<div style="font-size:9.5px; color:var(--color-text-muted); font-style:italic; margin-top:2px;">"${escapeHtml(line.notes)}"</div>` : ""}
                    </div>
                    <div class="btn-qty-container">
                        <button onclick="window.adjustCartLine('${line.cartKey}', -1)">-</button>
                        <span>${line.quantity}</span>
                        <button onclick="window.adjustCartLine('${line.cartKey}', 1)">+</button>
                    </div>
                    <span style="width:56px; flex:none; text-align:right; font-size:11px; font-weight:bold;">₹${(line.price * line.quantity).toFixed(2)}</span>
                </div>
            `;
                          })
                          .join("")
            }
        </div>
        <div style="padding:14px 18px 18px; border-top:1px solid var(--color-border); flex:none;">
            <!-- Deliberately no tax/service-charge breakdown here - just the
                 items subtotal while still browsing/adding. Tax, service
                 charge, and tip are calculated (and shown) starting at
                 checkout - see renderCheckoutModal() - and again on the
                 Billing page and the printed bill, not before. -->
            <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px; padding:10px 0 14px;">
                <span style="font-size:11px; font-weight:bold; letter-spacing:.1em;">SUBTOTAL</span>
                <span style="font-size:22px; font-weight:bold; color:var(--color-accent);">₹${breakdown.subtotal.toFixed(2)}</span>
            </div>
            <button id="staff-cart-checkout-btn" ${cart.length === 0 ? "disabled" : ""} style="width:100%; padding:12px; background:${cart.length ? "var(--color-accent)" : "var(--color-border)"}; color:${cart.length ? "var(--color-accent-contrast)" : "var(--color-text-muted)"}; border:none; font-size:11.5px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; cursor:${cart.length ? "pointer" : "not-allowed"}; min-height:44px;">[ Checkout ]</button>
            <div style="font-size:9px; color:var(--color-text-muted); text-align:center; margin-top:8px; line-height:1.5;">Tax, service charge & tip shown at checkout.</div>
        </div>
    `;
    panel.querySelector("#staff-cart-checkout-btn")?.addEventListener("click", () => window.handleCartStatusClick());
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
                            <span style="color:var(--color-text-muted); font-size:7pt;"> &middot; ${t.orderCount} order${t.orderCount === 1 ? "" : "s"} &middot; \u20b9${t.total.toFixed(2)} &middot; opened by ${escapeHtml(t.openedBy)}</span>
                        </div>
                        <div>
                            <button class="admin-btn" data-edit-table="${t.id}">EDIT</button>
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

    root.querySelectorAll("[data-close-table]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const table = await TableSessionsSystem.get(btn.dataset.closeTable);
            if (!table) return;
            renderTableBillModal({
                table,
                onClose: async (markPaid) => {
                    try {
                        await TableSessionsSystem.close(table.id, markPaid);
                        await renderTablesPanel();
                    } catch (e) {
                        alert(e.message);
                    }
                }
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
                ? `<button style="flex:1; padding:10px; background:var(--color-accent); border:2px solid var(--color-accent); color:var(--color-accent-contrast); font-size:11px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; cursor:pointer;" onclick="window.markCompleted('${order.id}')">${isMaster ? "Mark all done" : "Mark done"}</button>`
                : isMaster && allItemsDone && !order.servedAt
                  ? `<button style="flex:1; padding:10px; background:var(--color-success); border:2px solid var(--color-success); color:#000; font-size:11px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; cursor:pointer;" onclick="window.markServed('${order.id}')">&gt; Mark served</button>`
                  : `<span style="flex:1; padding:10px; text-align:center; font-size:11px; color:var(--color-text-muted); letter-spacing:.08em; text-transform:uppercase;">// served</span>`;

            const paidActionHtml = order.isPaid
                ? `<span style="padding:10px 13px; background:none; border:2px solid var(--color-border); color:var(--color-success); font-size:11px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase;">\u2713 Paid</span>`
                : `<button style="padding:10px 13px; background:#000; border:2px solid var(--color-border); color:var(--color-text); font-size:11px; font-weight:bold; letter-spacing:.1em; text-transform:uppercase; cursor:pointer;" onclick="window.markPaid('${order.id}')">Bill</button>`;

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

window.markPaid = async (orderId) => {
    await KitchenSystem.markPaid(orderId);
    renderKitchen();
};

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
window.renderFooter = (config) => {
    const root = document.getElementById("site-footer");
    if (!root) return;
    const f = config.footer || {};
    const hasAnyDetail = f.address || f.phone || f.email || f.hours;

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
        <button type="button" class="home-pick-card" onclick="window.pickFromHome(${item.id})">
            <div class="home-pick-banner">
                ${itemImageMarkup(item)}
                <span class="home-pick-badge">${escapeHtml(tag || "")}</span>
            </div>
            <div class="home-pick-body">
                <span class="home-pick-name">${escapeHtml(item.name)}</span>
                <span class="home-pick-note">${escapeHtml(item.story || "")}</span>
                <div class="home-pick-footer">
                    <span class="home-pick-price">\u20b9${item.price}</span>
                    <span class="home-pick-add">+ Add</span>
                </div>
            </div>
        </button>
    `
        )
        .join("");
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

    const facts = [
        { label: "Open today", value: siteConfig.footer?.hours || "See hours below", color: "var(--color-success)" },
        { label: "Address", value: siteConfig.footer?.address || "-", color: "var(--color-text)" },
        { label: "Orders today", value: stats ? String(stats.ordersToday) : "-", color: "var(--color-text)" },
        { label: "Bits brewed today", value: stats ? String(stats.itemsServedToday) : "-", color: "var(--color-accent)" }
    ];
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
        { label: "Hours", value: f.hours }
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

/**
 * BOOT
 */
(async () => {
    document.addEventListener("click", () => SoundSystem.unlock(), { once: true });
    StaffShell.captureCustomerNav(); // before refreshSession() can possibly swap it out for an already-logged-in staff session
    await loadMenu();
    await loadCombos();
    await CustomizationSystem.loadOptions();
    await refreshSession();
    const config = await AdminConfig.loadSettings();
    window.applyBranding(config);
    window.renderFooter(config);
    window.initSearchBar();
    window.showPage(KITCHEN_ROLES.includes(session.role) ? "staff-home" : "home");
})();
