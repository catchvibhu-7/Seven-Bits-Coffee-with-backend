/**
 * SEVEN BITS COFFEE - MAIN APPLICATION LOGIC
 * Location: /js/app.js
 */
import { KitchenSystem } from "./features/kitchen-logic.js";
import { SecuritySystem } from "./features/auth-logic.js";
import { renderCheckoutModal, renderPaymentConfirmation } from "./ui/checkout-modal.js";
import { renderLoginModal } from "./ui/login-modal.js";

// --- System State ---
let cart = [];
let serviceChargeActive = true;
let tipApplied = false;
let currentKitchenStation = "BARISTA";
let viewMode = "list";
let menuData = { sections: [], items: [] };
let pendingOrder = null; // order returned by the server, waiting to be printed
let ordersStream = null; // SSE connection, opened once after the first authenticated view

async function loadMenu() {
    const res = await fetch("/api/menu");
    menuData = await res.json();
}

/**
 * NAVIGATION & VIEW CONTROL
 */
window.setViewMode = (mode) => {
    viewMode = mode;
    renderMenu(document.getElementById("menu-search")?.value || "");
};

window.showPage = async (pageId) => {
    const isProtected = pageId === "admin" || pageId === "kitchen" || pageId === "orders";
    if (isProtected) {
        const authed = await SecuritySystem.checkAccess();
        if (!authed) {
            renderLoginModal(() => window.showPage(pageId));
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
};

/**
 * Opens the live-updates connection once per session so every station
 * (kitchen screen, admin view) picks up changes made anywhere else without
 * needing a manual refresh.
 */
function ensureOrdersStream() {
    if (ordersStream) return;
    ordersStream = KitchenSystem.connectLiveUpdates(async () => {
        await KitchenSystem.fetchOrders();
        const kitchenPage = document.getElementById("page-kitchen") || document.getElementById("page-orders");
        if (kitchenPage && kitchenPage.classList.contains("active")) renderKitchen();
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
                <p style="font-size: 8pt;">Hazaribagh, Jharkhand<br>#${order.id} | ${new Date(order.createdAt).toLocaleString()}</p>
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
                <p>#${order.id} | TYPE: ${order.method}</p>
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
    if (btn) {
        btn.disabled = true;
        btn.textContent = "PROCESSING...";
    }

    try {
        const order = await KitchenSystem.pushOrder(cart, method, { serviceChargeActive, tipApplied });
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
    updateCartUI();
    document.getElementById("payment-overlay")?.remove();
    window.closeModal();
    renderMenu();

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

            const itemEl = document.createElement("div");
            itemEl.className = "menu-item";
            itemEl.innerHTML = `
                <span class="icon icon-${item.icon}"></span>
                <div class="info">
                    <div class="name">${item.name}</div>
                    <div class="story">${item.story}</div>
                </div>
                <div class="item-controls">
                    <div class="price-fixed">\u20b9${item.price}</div>
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
    if (cart.length > 0) {
        await renderCheckoutModal(cart, serviceChargeActive, tipApplied);
    } else {
        alert("SYSTEM IDLE: Select bits.");
    }
};

/**
 * KITCHEN MANAGEMENT
 */
window.filterKitchen = (station) => {
    currentKitchenStation = station;

    document.querySelectorAll(".kitchen-tabs button").forEach((btn) => {
        btn.classList.remove("active-station");
        if (btn.getAttribute("data-station") === station) {
            btn.classList.add("active-station");
        }
    });

    renderKitchen();
};

function renderKitchen() {
    const root = document.getElementById("kitchen-orders-root");
    if (!root) return;
    root.innerHTML = "";

    KitchenSystem.orders
        .slice()
        .reverse()
        .forEach((order) => {
            const isMaster = currentKitchenStation === "MASTER";

            const itemsToDisplay = isMaster
                ? order.items
                : order.items.filter((i) => {
                      const station = i.station || KitchenSystem.getStation(i);
                      return station === currentKitchenStation && !i.isDone;
                  });

            if (!isMaster && itemsToDisplay.length === 0) return;

            const hasPendingItems = itemsToDisplay.some((i) => !i.isDone);

            const ticket = document.createElement("div");
            ticket.className = "kot-ticket";
            const paidStatus = order.isPaid
                ? "\u2713 PAID"
                : `<button onclick="window.markPaid('${order.id}')" style="cursor:pointer; border:1px solid #d97706; background:none; color:#d97706; font-size:7pt;">MARK PAID</button>`;

            ticket.innerHTML = `
            <div class="kot-header">
                <span>#${order.id}</span>
                <span style="float:right;">${paidStatus}</span>
            </div>
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
                        style="width:100%; margin-top:10px; font-size:9pt; background:#d97706; color:black; border:none; padding:8px; font-weight:bold; cursor:pointer;"
                        onclick="window.markCompleted('${order.id}')">
                    ${isMaster ? "MARK ALL DONE" : "MARK DONE"}
                </button>
            `
                    : ""
            }
        `;
            root.appendChild(ticket);
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
        let msg = `Order #${orderId}: `;
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
 * BOOT
 */
(async () => {
    await loadMenu();
    window.initSearchBar();
    window.showPage("home");
})();
