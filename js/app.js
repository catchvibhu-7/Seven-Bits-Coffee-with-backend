/**
 * SEVEN BITS COFFEE - MAIN APPLICATION LOGIC
 * Location: /js/app.js
 */
import { KitchenSystem } from "./features/kitchen-logic.js";
import { discountedUnitPrice } from "./features/cart-logic.js";
import { SoundSystem } from "./features/sound-logic.js";
import { AuthSystem } from "./features/auth-logic.js";
import { AdminConfig } from "./features/config-logic.js";
import { renderCheckoutModal, renderPaymentConfirmation } from "./ui/checkout-modal.js";
import { renderLoginModal, renderForceChangePasswordModal } from "./ui/login-modal.js";
import { renderAccountSettingsModal } from "./ui/account-settings-modal.js";

// --- System State ---
let cart = [];
let serviceChargeActive = true;
let tipApplied = false;
let appliedCoupon = null; // {code, type, value} from a validated /api/coupons/validate response, or null
let lastSeenOrderStatuses = {}; // orderId -> last status seen by refreshOrderStatusWidget, so the ready chime fires once per transition, not on every poll
let currentKitchenStation = "MASTER"; // matches the "ALL" tab that's marked active by default in index.html
let viewMode = "list";
let menuData = { sections: [], items: [] };
let siteConfig = {}; // last-loaded config (colors/customIcons/etc.) for icon rendering + branding
let pendingOrder = null; // order returned by the server, waiting to be printed
let ordersStream = null; // SSE connection, opened once after the first authenticated view
let session = { authenticated: false, role: null, name: null, phone: null }; // current login state

const KITCHEN_ROLES = ["employee", "admin", "owner"];
const ADMIN_ROLES = ["admin", "owner"];
const TRACKING_ROLES = ["customer", "guest"];

async function loadMenu() {
    const res = await fetch("/api/menu");
    menuData = await res.json();
}

async function refreshSession() {
    session = await AuthSystem.getSession();
    updateNavForSession();
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
    if (adminTab) adminTab.style.display = ADMIN_ROLES.includes(session.role) ? "" : "none";

    if (accountBtn) {
        if (session.authenticated) {
            const label = session.role === "guest" ? "GUEST" : session.name || session.role.toUpperCase();
            accountBtn.textContent = `\u2b95 ${label}`;
        } else {
            accountBtn.textContent = "LOGIN";
        }
    }
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
    menu.style.cssText = `
        position: fixed; top: ${rect.bottom + 6}px; right: ${window.innerWidth - rect.right}px;
        background: var(--color-surface); border: 1px solid var(--color-accent);
        min-width: 180px; z-index: 5500; font-family: 'Courier New', monospace;
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
        const allowedRoles = needsAdminRole ? ADMIN_ROLES : KITCHEN_ROLES;
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
        renderKitchen();
        ensureOrdersStream();
    }
    if (pageId === "home") {
        renderPopularPicks();
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
 */
window.addToCart = (id) => {
    const item = cart.find((i) => i.id === id);
    if (item) {
        item.quantity++;
    } else {
        const product = menuData.items.find((i) => i.id === id);
        if (product) cart.push({ ...product, quantity: 1 });
    }
    updateCartUI();
    renderMenu();
};

window.removeFromCart = (id) => {
    const item = cart.find((i) => i.id === id);
    if (item) {
        item.quantity--;
        if (item.quantity <= 0) cart = cart.filter((i) => i.id !== id);
    }
    updateCartUI();
    renderMenu();
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
            </div>
            <div class="hr"></div>
            ${order.items
                .map(
                    (item) => `
                <div class="row">
                    <span>${item.quantity}x ${item.name}</span>
                    <span>\u20b9${(item.price * item.quantity).toFixed(2)}</span>
                </div>
            `
                )
                .join("")}
            <div class="hr"></div>
            <div class="row">SUBTOTAL: <span>\u20b9${order.subtotal.toFixed(2)}</span></div>
            ${order.promoDiscountTotal > 0 ? `<div class="row">PROMO SAVINGS: <span>-\u20b9${order.promoDiscountTotal.toFixed(2)}</span></div>` : ""}
            ${order.couponDiscount > 0 ? `<div class="row">COUPON (${order.couponCode}): <span>-\u20b9${order.couponDiscount.toFixed(2)}</span></div>` : ""}
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
            </div>
            ${order.items
                .map(
                    (item) => `
                <div class="item">${item.quantity}x ${item.name}</div>
            `
                )
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
 * 3. finalizeAndPrint() clears the cart and prints from the server's order.
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
        const order = await KitchenSystem.pushOrder(cart, method, { serviceChargeActive, tipApplied, phone, couponCode: appliedCoupon?.code || null });
        pendingOrder = order;
        renderPaymentConfirmation(order, method);
    } catch (e) {
        if (errorBox) errorBox.textContent = e.message;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = method === "ONLINE" ? "PAY ONLINE (UPI)" : "PAY CASH";
        }
    }
};

window.finalizeAndPrint = () => {
    const order = pendingOrder;
    pendingOrder = null;

    cart = [];
    serviceChargeActive = true;
    tipApplied = false;
    appliedCoupon = null;
    updateCartUI();
    document.getElementById("payment-overlay")?.remove();
    window.closeModal();
    renderMenu();
    refreshOrderStatusWidget();

    if (order) {
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

/** Renders an item's icon - a custom admin-uploaded image if configured for that key, else the built-in CSS icon. */
function iconMarkup(iconKey) {
    const customUrl = siteConfig.customIcons && siteConfig.customIcons[iconKey];
    if (customUrl) {
        return `<img src="${customUrl}" alt="" style="width:32px; height:32px; object-fit:contain;" />`;
    }
    return `<span class="icon icon-${iconKey}"></span>`;
}

function renderMenu(filterQuery = "") {
    const root = document.getElementById("menu-root");
    if (!root) return;
    root.innerHTML = "";

    menuData.sections.forEach((section) => {
        const items = menuData.items.filter(
            (item) => item.section === section.id && item.name.toLowerCase().includes(filterQuery.toLowerCase())
        );

        if (items.length === 0) return;

        const sectionEl = document.createElement("section");
        sectionEl.id = `section-${section.id}`;
        sectionEl.className = "section-container";
        sectionEl.innerHTML = `<h2 class="section-title">${section.title}</h2>`;

        const itemsContainer = document.createElement("div");
        itemsContainer.className = viewMode === "grid" ? "menu-grid" : "menu-list";

        items.forEach((item) => {
            const inCart = cart.find((c) => c.id === item.id);
            const count = inCart ? inCart.quantity : 0;

            const buttonHTML =
                count > 0
                    ? `<div class="btn-qty-container">
                    <button onclick="window.removeFromCart(${item.id})">-</button>
                    <span>${count}</span>
                    <button onclick="window.addToCart(${item.id})">+</button>
                </div>`
                    : `<button class="btn-add-fixed" onclick="window.addToCart(${item.id})">ADD BIT</button>`;

            const unitPrice = discountedUnitPrice(item);
            const onPromo = unitPrice < item.price;
            const priceHTML = onPromo
                ? `<span style="text-decoration:line-through; color:var(--color-text-muted); font-size:0.8em;">\u20b9${item.price}</span> \u20b9${unitPrice.toFixed(2)}`
                : `\u20b9${item.price}`;

            const itemEl = document.createElement("div");
            itemEl.className = "menu-item";
            itemEl.innerHTML = `
                ${iconMarkup(item.icon)}
                <div class="info">
                    <div class="name">${item.name}${onPromo ? ' <span style="color:var(--color-accent); font-size:0.7em;">PROMO</span>' : ""}</div>
                    <div class="story">${item.story}</div>
                </div>
                <div class="item-controls">
                    <div class="price-fixed">${priceHTML}</div>
                    <div class="action-fixed">${buttonHTML}</div>
                </div>
            `;
            itemsContainer.appendChild(itemEl);
        });

        sectionEl.appendChild(itemsContainer);
        root.appendChild(sectionEl);
    });

    const footer = document.getElementById("footer-actions");
    const cartBar = document.getElementById("cart-status");

    if (footer) footer.style.display = "flex";
    if (cartBar) cartBar.style.display = cart.length > 0 ? "flex" : "none";
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
                    await renderCheckoutModal(cart, serviceChargeActive, tipApplied, appliedCoupon);
                }),
            { title: "LOGIN OR CONTINUE AS GUEST", allowGuest: true, allowRegister: true }
        );
        return;
    }

    await renderCheckoutModal(cart, serviceChargeActive, tipApplied, appliedCoupon);
};

/**
 * KITCHEN MANAGEMENT
 */
let kitchenStatusFilter = "active"; // "active" | "history" | "all"
let kitchenSortOrder = "newest"; // "newest" | "oldest"

window.filterKitchen = (station) => {
    currentKitchenStation = station;

    document.querySelectorAll(".kitchen-tabs .admin-tab-btn").forEach((btn) => {
        btn.classList.remove("active");
        if (btn.getAttribute("data-station") === station) {
            btn.classList.add("active");
        }
    });

    renderKitchen();
};

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
            <div style="font-size:7pt; color:var(--color-text-muted); margin-bottom:6px;">${new Date(order.createdAt).toLocaleString()}</div>
            <div class="kot-body">
                ${itemsToDisplay
                    .map(
                        (i) => `
                    <div class="${i.isDone ? "item-done" : "item-pending"}">
                        <strong>${i.quantity}x</strong> ${i.name}
                        ${isMaster && i.isDone ? '<span style="font-size:7pt; opacity:0.5; margin-left:5px;">[OK]</span>' : ""}
                    </div>
                `
                    )
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
window.toggleTip = (check) => {
    tipApplied = check;
    window.closeModal();
    document.getElementById("cart-status").click();
};
window.removeServiceCharge = () => {
    serviceChargeActive = false;
    window.closeModal();
    document.getElementById("cart-status").click();
};

window.applyCouponCode = async () => {
    const input = document.getElementById("coupon-code-input");
    const errorEl = document.getElementById("coupon-error");
    const code = input?.value.trim();
    if (!code) return;

    try {
        const res = await fetch("/api/coupons/validate", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invalid coupon");
        appliedCoupon = data;
        window.closeModal();
        document.getElementById("cart-status").click();
    } catch (e) {
        if (errorEl) errorEl.textContent = e.message;
    }
};

window.removeCoupon = () => {
    appliedCoupon = null;
    window.closeModal();
    document.getElementById("cart-status").click();
};

window.toggleShowCoupons = async () => {
    const listEl = document.getElementById("public-coupons-list");
    if (!listEl) return;
    if (listEl.style.display !== "none") {
        listEl.style.display = "none";
        return;
    }
    listEl.style.display = "block";
    listEl.innerHTML = "Loading...";
    const res = await fetch("/api/coupons/public", { credentials: "include" });
    const coupons = res.ok ? await res.json() : [];
    if (coupons.length === 0) {
        listEl.innerHTML = "No public codes available right now.";
        return;
    }
    listEl.innerHTML = coupons
        .map(
            (c) =>
                `<div style="cursor:pointer; padding:3px 0; text-decoration:underline;" onclick="document.getElementById('coupon-code-input').value='${c.code}'">${c.code} - ${c.type === "percent" ? `${c.value}% OFF` : `₹${c.value} OFF`}</div>`
        )
        .join("");
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
            (item) => `
        <div class="popular-pick-card" onclick="window.pickFromHome(${item.id})">
            ${iconMarkup(item.icon)}
            <div class="name">${item.name}</div>
            <div class="price">\u20b9${item.price}</div>
        </div>
    `
        )
        .join("");
}

window.pickFromHome = (itemId) => {
    window.addToCart(itemId);
    window.showPage("menu");
};

/**
 * BOOT
 */
(async () => {
    document.addEventListener("click", () => SoundSystem.unlock(), { once: true });
    await loadMenu();
    await refreshSession();
    const config = await AdminConfig.loadSettings();
    window.applyBranding(config);
    window.renderFooter(config);
    window.initSearchBar();
    window.showPage("home");
})();
