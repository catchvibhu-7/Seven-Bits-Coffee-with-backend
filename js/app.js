/**
 * SEVEN BITS COFFEE - MAIN APPLICATION LOGIC
 * Location: /js/app.js
 */
import { KitchenSystem } from "./features/kitchen-logic.js";
import { discountedBasePrice } from "./features/cart-logic.js";
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
    updateNavForSession();
    if (TRACKING_ROLES.includes(session.role)) {
        await FavoritesSystem.load();
    } else {
        FavoritesSystem.ids = [];
    }
    return session;
}

/**
 * Shows/hides the Kitchen and Admin nav tabs based on role, and updates the
 * account button's label - purely visual, the server enforces the real
 * access control on every request regardless of what the nav shows.
 */
function updateNavForSession() {
    const kitchenTab = document.getElementById("nav-kitchen");
    const adminTab = document.getElementById("nav-admin");
    const accountBtn = document.getElementById("nav-account");

    if (kitchenTab) kitchenTab.style.display = KITCHEN_ROLES.includes(session.role) ? "" : "none";
    if (adminTab) {
        adminTab.style.display = MANAGER_UP_ROLES.includes(session.role) ? "" : "none";
        // Same page underneath (see admin-portal.js's role-aware tab list) -
        // the label just reflects that a manager gets a scoped subset, not
        // the full Admin panel.
        adminTab.textContent = session.role === "manager" ? "DASHBOARD" : "ADMIN";
    }

    if (accountBtn) {
        if (session.authenticated) {
            const label = session.role === "guest" ? "GUEST" : session.name || session.role.toUpperCase();
            accountBtn.textContent = `\u2b95 ${label}`;
        } else {
            accountBtn.textContent = "LOGIN";
        }
    }

    updateTimeclockWidget();

    const myOrdersLink = document.getElementById("my-orders-link-section");
    if (myOrdersLink) myOrdersLink.style.display = "block"; // always available - openMyOrders() itself prompts login if needed

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

    const heroEl = document.querySelector(".icon-logo-hero");
    if (heroEl) {
        if (config.heroImageUrl) {
            heroEl.style.backgroundImage = `url(${JSON.stringify(config.heroImageUrl).slice(1, -1)})`;
            heroEl.style.backgroundSize = "contain";
            heroEl.style.backgroundRepeat = "no-repeat";
            heroEl.style.backgroundPosition = "center";
        } else {
            heroEl.style.backgroundImage = "";
        }
    }

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
    if (shopNameEl && config.shopName) shopNameEl.textContent = config.shopName;
    const taglineEl = document.getElementById("hero-tagline");
    if (taglineEl && config.heroTagline) taglineEl.textContent = config.heroTagline;
};

/**
 * Small "Clock In / Clock Out" nav button, visible only to employee/manager
 * accounts. Backs the payroll system's hourly-rate calculations with real
 * timestamps instead of manually-guessed hours.
 */
async function updateTimeclockWidget() {
    const btn = document.getElementById("nav-timeclock");
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
    const btn = document.getElementById("nav-timeclock");
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
        renderAccountMenu();
    } else {
        renderLoginModal(
            (loginResult) => afterLoginSuccess(loginResult, () => window.showPage("home")),
            { title: "LOGIN OR CONTINUE AS GUEST", allowGuest: true, allowRegister: true }
        );
    }
};

/**
 * Small dropdown under the account nav button - kept separate from Account
 * Settings (rather than nesting Logout inside that modal) so Logout stays a
 * one-click action as more account features get added to Settings later.
 */
function renderAccountMenu() {
    document.getElementById("account-menu")?.remove();
    const btn = document.getElementById("nav-account");
    if (!btn) return;

    const menu = document.createElement("div");
    menu.id = "account-menu";
    const rect = btn.getBoundingClientRect();
    const menuWidth = 180;
    // Left-align to the button (not right-align) - right-aligning a menu
    // wider than a short button (e.g. "OWNER") pulls it left underneath
    // whatever nav tab sits before it, which looked like a placement bug.
    // Falls back to right-aligned only if left-aligning would overflow the
    // viewport (e.g. a narrow mobile screen).
    const overflowsRight = rect.left + menuWidth > window.innerWidth;
    const horizontalRule = overflowsRight ? `right: ${window.innerWidth - rect.right}px;` : `left: ${rect.left}px;`;
    menu.style.cssText = `
        position: fixed; top: ${rect.bottom + 6}px; ${horizontalRule}
        background: var(--color-surface); border: 1px solid var(--color-accent);
        min-width: ${menuWidth}px; z-index: 5500; font-family: 'Courier New', monospace;
        box-shadow: 4px 4px 0 rgba(0,0,0,0.4);
    `;

    const items = [];
    if (session.role !== "guest") {
        items.push({ label: "ACCOUNT SETTINGS", action: () => renderAccountSettingsModal(session) });
    }
    items.push({ label: "LOG OUT", action: doLogout, danger: true });

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
    const needsKitchenRole = pageId === "kitchen" || pageId === "orders";
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
        renderLiveStatsTicker();
        await refreshOrderStatusWidget();
        if (TRACKING_ROLES.includes(session.role)) ensureOrdersStream();
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
async function refreshOrderStatusWidget() {
    const section = document.getElementById("order-status-section");
    const root = document.getElementById("order-status-root");
    if (!section || !root) return;

    if (!TRACKING_ROLES.includes(session.role)) {
        section.style.display = "none";
        return;
    }

    const orders = await KitchenSystem.fetchMine();
    // "Active" = still being made, or just became ready recently (so the
    // customer still sees "come pick it up") - once it's been ready for a
    // while, or once there's simply no order, this section just disappears
    // rather than showing an empty/prompt state indefinitely.
    const READY_VISIBLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
    const activeOrder = orders.find((o) => {
        if (o.status !== "READY") return true;
        return Date.now() - new Date(o.createdAt).getTime() < READY_VISIBLE_WINDOW_MS;
    });
    if (!activeOrder) {
        section.style.display = "none";
        return;
    }

    const order = activeOrder;
    const statusColor = order.status === "READY" ? "var(--color-success)" : order.status === "PREPARING" ? "var(--color-cyan)" : "var(--color-accent)";

    // Only chime on the moment an order becomes READY (not on every poll
    // while it stays READY, and not for an order that was already READY the
    // first time we ever saw it - e.g. a page refresh after pickup was
    // already announced).
    const previousStatus = lastSeenOrderStatuses[order.id];
    if (order.status === "READY" && previousStatus && previousStatus !== "READY") {
        SoundSystem.playReadyChime();
    }
    lastSeenOrderStatuses[order.id] = order.status;

    section.style.display = "block";
    root.innerHTML = `
        <div class="status-card" style="border:1px solid var(--color-accent); padding:15px; font-family:'Courier New',monospace;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <span>#${order.orderNumber || order.id}</span>
                <span style="display:flex; align-items:center; gap:8px;">
                    <button onclick="window.toggleOrderSound(this)" title="${SoundSystem.isMuted() ? "Unmute order-ready sound" : "Mute order-ready sound"}" style="background:none; border:none; cursor:pointer; color:var(--color-text-muted); font-size:11pt; padding:0;">${SoundSystem.isMuted() ? "\u{1F507}" : "\u{1F50A}"}</button>
                    <span style="color:${statusColor}; font-weight:bold;">${order.status}</span>
                </span>
            </div>
            <div style="font-size:9pt; color:var(--color-text-muted);">${order.items.map((i) => `${i.quantity}x ${i.name}`).join(", ")}</div>
            <div style="font-size:9pt; margin-top:8px;">${order.isPaid ? "\u2713 Paid" : "Payment pending"} \u00b7 \u20b9${order.total.toFixed(2)}</div>
        </div>
    `;
}

/**
 * Opens the live-updates connection once per session so every station
 * (kitchen screen, admin view) picks up changes made anywhere else without
 * needing a manual refresh.
 */
function ensureOrdersStream() {
    if (ordersStream) return;
    ordersStream = KitchenSystem.connectLiveUpdates(async () => {
        const kitchenPage = document.getElementById("page-kitchen") || document.getElementById("page-orders");
        if (kitchenPage && kitchenPage.classList.contains("active")) {
            await KitchenSystem.fetchOrders();
            renderKitchen();
        }
        const homePage = document.getElementById("page-home");
        if (homePage && homePage.classList.contains("active")) {
            await refreshOrderStatusWidget();
        }
    });
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
                <h3>SEVEN BITS COFFEE</h3>
                <p style="font-size: 8pt;">Hazaribagh, Jharkhand<br>#${order.orderNumber || order.id} | ${new Date(order.createdAt).toLocaleString()}</p>
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
            <p class="center" style="font-size: 8pt;">- G=7 | Processed with precision -</p>
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

window.jumpTo = (sectionId) => {
    const section = document.getElementById(`section-${sectionId}`);
    if (section) {
        const titleElement = section.querySelector("h2") || section.querySelector(".section-header");

        if (titleElement) {
            const headerOffset = 90;
            const elementPosition = titleElement.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

            window.scrollTo({ top: offsetPosition, behavior: "smooth" });
        } else {
            section.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        document.getElementById("jump-menu").style.display = "none";
    }
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
        return `<img src="${item.imageUrl}" alt="" class="menu-item-photo" style="width:56px; height:56px; object-fit:cover; border-radius:6px; flex-shrink:0;" />`;
    }
    return iconMarkup(item.icon);
}

function renderMenu(filterQuery = "") {
    const root = document.getElementById("menu-root");
    if (!root) return;
    root.innerHTML = "";

    if (!favoritesFilterActive && !filterQuery && comboData.length > 0) {
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
                <span class="icon icon-cake"></span>
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

    menuData.sections.forEach((section) => {
        const items = menuData.items.filter(
            (item) =>
                item.section === section.id &&
                item.name.toLowerCase().includes(filterQuery.toLowerCase()) &&
                (!favoritesFilterActive || FavoritesSystem.isFavorite(item.id))
        );

        if (items.length === 0) return;

        const sectionEl = document.createElement("section");
        sectionEl.id = `section-${section.id}`;
        sectionEl.className = "section-container";
        sectionEl.innerHTML = `<h2 class="section-title">${section.title}</h2>`;

        const itemsContainer = document.createElement("div");
        itemsContainer.className = viewMode === "grid" ? "menu-grid" : "menu-list";

        items.forEach((item) => {
            const isUnavailable = item.available === false;

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
                ${itemImageMarkup(item)}
                <div class="info">
                    <div class="name">${favButton}${item.name}${isUnavailable ? ' <span style="font-size:7pt; color:var(--color-danger); font-weight:normal;">(UNAVAILABLE)</span>' : ""}${onPromo ? ' <span style="color:var(--color-accent); font-size:0.7em;">PROMO</span>' : ""}</div>
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

        sectionEl.appendChild(itemsContainer);
        root.appendChild(sectionEl);
    });

    if (favoritesFilterActive && !root.hasChildNodes()) {
        root.innerHTML = `<p style="text-align:center; padding: 30px; font-size: 9pt; color: var(--color-text-muted);">No favorites yet - tap the \u2606 on any item to add one.</p>`;
    }

    const footer = document.getElementById("footer-actions");
    const cartBar = document.getElementById("cart-status");

    if (footer) footer.style.display = "flex";
    if (cartBar) cartBar.style.display = cart.length > 0 ? "flex" : "none";
}

window.toggleFavoritesFilter = (checked) => {
    favoritesFilterActive = checked;
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

window.filterKitchen = async (station) => {
    currentKitchenStation = station;

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
    document.querySelectorAll("[data-status-filter]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.statusFilter === filter);
    });
    renderKitchen();
};

window.setKitchenSort = (sort) => {
    kitchenSortOrder = sort;
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

    let visibleCount = 0;

    sorted.forEach((order) => {
            const isMaster = currentKitchenStation === "MASTER";
            const orderIsComplete = order.items.every((i) => i.isDone);

            // ACTIVE hides fully-completed orders; HISTORY shows only
            // completed ones; ALL shows everything regardless of status.
            if (kitchenStatusFilter === "active" && orderIsComplete) return;
            if (kitchenStatusFilter === "history" && !orderIsComplete) return;

            const itemsToDisplay = isMaster
                ? order.items
                : order.items.filter((i) => {
                      const station = i.station || KitchenSystem.getStation(i);
                      return station === currentKitchenStation && (!i.isDone || kitchenStatusFilter !== "active");
                  });

            if (!isMaster && itemsToDisplay.length === 0) return;

            visibleCount++;
            const hasPendingItems = itemsToDisplay.some((i) => !i.isDone);

            const ticket = document.createElement("div");
            ticket.className = "kot-ticket";
            const paidStatus = order.isPaid
                ? "\u2713 PAID"
                : `<button onclick="window.markPaid('${order.id}')" style="cursor:pointer; border:1px solid var(--color-accent); background:none; color:var(--color-accent); font-size:7pt;">MARK PAID</button>`;

            ticket.innerHTML = `
            <div class="kot-header">
                <span>#${order.orderNumber || order.id}</span>
                <span style="float:right;">${paidStatus}</span>
            </div>
            ${order.tableNumber ? `<div style="font-size:9pt; font-weight:bold; color:var(--color-accent); margin-bottom:4px;">TABLE ${escapeHtml(order.tableNumber)}</div>` : ""}
            <div style="font-size:7pt; color:var(--color-text-muted); margin-bottom:6px;">${new Date(order.createdAt).toLocaleString()}</div>
            <div class="kot-body">
                ${itemsToDisplay
                    .map((i) => {
                        const tags = customizationTagsText(i);
                        return `
                    <div class="${i.isDone ? "item-done" : "item-pending"}">
                        <strong>${i.quantity}x</strong> ${escapeHtml(i.name)}
                        ${isMaster && i.isDone ? '<span style="font-size:7pt; opacity:0.5; margin-left:5px;">[OK]</span>' : ""}
                        ${tags ? `<div style="font-size:7pt; color: var(--color-accent); font-weight:normal;">${tags}</div>` : ""}
                        ${i.notes ? `<div style="font-size:7pt; color: var(--color-text-muted); font-weight:normal; font-style:italic;">"${escapeHtml(i.notes)}"</div>` : ""}
                    </div>
                `;
                    })
                    .join("")}
            </div>

            ${
                hasPendingItems
                    ? `
                <button class="btn-primary"
                        style="width:100%; margin-top:10px; font-size:9pt; background:var(--color-accent); color:var(--color-accent-contrast); border:none; padding:8px; font-weight:bold; cursor:pointer;"
                        onclick="window.markCompleted('${order.id}')">
                    ${isMaster ? "MARK ALL DONE" : "MARK DONE"}
                </button>
            `
                    : ""
            }
        `;
            root.appendChild(ticket);
        });

    if (visibleCount === 0) {
        root.innerHTML = `<p style="color:var(--color-text-muted); font-family:'Courier New',monospace; font-size:9pt;">No ${kitchenStatusFilter === "history" ? "completed" : kitchenStatusFilter === "active" ? "active" : ""} orders${currentKitchenStation !== "MASTER" ? ` for ${currentKitchenStation}` : ""}.</p>`;
    }
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

/**
 * UI HELPERS & MODALS
 */
window.closeModal = () => document.getElementById("modal-overlay")?.remove();
window.toggleOrderSound = (btn) => {
    const muted = !SoundSystem.isMuted();
    SoundSystem.setMuted(muted);
    btn.textContent = muted ? "\u{1F507}" : "\u{1F50A}";
    btn.title = muted ? "Unmute order-ready sound" : "Mute order-ready sound";
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
 * Home page "Popular Picks" - a handful of featured items so there's
 * something to click right on arrival, not just an empty page below the
 * hero. Clicking a card adds it to the cart and jumps to the Menu page so
 * the person can see it land there.
 */
function renderPopularPicks() {
    const root = document.getElementById("popular-picks-grid");
    if (!root || !menuData.items.length) return;

    // First section's items are the intended "signature" picks; fall back
    // to the first few items overall if that section is ever empty/renamed.
    const firstSectionId = menuData.sections[0]?.id;
    const picks = (firstSectionId ? menuData.items.filter((i) => i.section === firstSectionId) : menuData.items).slice(0, 4);

    root.innerHTML = picks
        .map(
            (item, i) => `
        <div class="popular-pick-card" style="transition-delay: ${i * 60}ms;" onclick="window.pickFromHome(${item.id})">
            ${itemImageMarkup(item)}
            <div class="name">${item.name}</div>
            <div class="price">\u20b9${item.price}</div>
        </div>
    `
        )
        .join("");

    // Fade cards in as they scroll into view rather than all at once - see
    // .popular-pick-card / .in-view in theme.css for the actual animation.
    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("in-view");
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.15 }
        );
        root.querySelectorAll(".popular-pick-card").forEach((card) => observer.observe(card));
    } else {
        root.querySelectorAll(".popular-pick-card").forEach((card) => card.classList.add("in-view"));
    }
}

/**
 * Small "live" ticker on the home page showing today's real order/item
 * counts - not decorative fake numbers. Uses the public, non-sensitive
 * stats endpoint (no revenue, no names) so it works for anyone, logged in
 * or not.
 */
async function renderLiveStatsTicker() {
    const root = document.getElementById("live-stats-ticker");
    if (!root) return;
    try {
        const res = await fetch("/api/stats/public");
        if (!res.ok) throw new Error();
        const stats = await res.json();
        root.innerHTML = `
            <span class="live-dot"></span>
            <span><strong>${stats.ordersToday}</strong> ORDER${stats.ordersToday === 1 ? "" : "S"} TODAY</span>
            <span style="opacity:0.4;">\u00b7</span>
            <span><strong>${stats.itemsServedToday}</strong> BITS BREWED TODAY</span>
        `;
    } catch (e) {
        root.style.display = "none";
    }
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
    await loadMenu();
    await loadCombos();
    await CustomizationSystem.loadOptions();
    await refreshSession();
    const config = await AdminConfig.loadSettings();
    window.applyBranding(config);
    window.renderFooter(config);
    window.initSearchBar();
    window.showPage("home");
})();
