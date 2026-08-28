/**
 * SEVEN BITS COFFEE - CHECKOUT UI
 * Location: /js/ui/checkout-modal.js
 *
 * The numbers shown here are an ESTIMATE (computed client-side from the
 * current config, for a responsive preview). When the person actually pays,
 * window.startCheckout() sends the cart to the server, which recalculates
 * the real total from its own prices/rates and returns it - that server
 * response is what gets printed and what the online-payment QR is built
 * from, never this preview.
 */
import { CartSystem } from "../features/cart-logic.js";
import { AdminConfig, currencySymbol } from "../features/config-logic.js";
import { AuthSystem } from "../features/auth-logic.js";
import { CustomizationSystem } from "../features/customization-logic.js";
import { TableSessionsSystem } from "../features/table-sessions-logic.js";

// Mirrors app.js's KITCHEN_ROLES - inlined rather than imported since app.js
// isn't set up as a module other files pull constants from (same pattern
// as account-settings-modal.js's own copy). Only staff taking an order on
// someone else's behalf get the "guest, no phone" bypass - a customer/guest
// checking themselves out always already has an identity from the session.
const STAFF_ROLES = ["employee", "manager", "admin", "owner"];

function customizationDetailLines(item) {
    if (item.isCombo) return [];
    return CustomizationSystem.describeLineWithAmounts(item);
}

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** One cart line in the checkout modal's item list:
 *    item name @unit price
 *    TOTAL   [CUSTOMIZED]                    - qty +
 *    (breakdown, hidden until CUSTOMIZED is clicked)
 * The qty stepper sits on the same row as the total/CUSTOMIZED tag,
 * vertically centered and right-aligned - not stacked on its own row below
 * like before. CUSTOMIZED toggles a per-line breakdown showing exactly what
 * each customization added, instead of just a comma-separated tag list. */
function cartRowHtml(item, index) {
    const lineTotal = (item.price * item.quantity).toFixed(2);
    const detailLines = customizationDetailLines(item);
    const hasNotes = !item.isCombo && !!item.notes;
    const hasBreakdown = detailLines.length > 0 || hasNotes;
    const breakdownId = `cart-breakdown-${index}`;
    const onPromo = !item.isCombo && item.promoDiscount && item.originalPrice > item.price;

    const promoTagHtml = onPromo ? `<span style="font-size:7pt; color:var(--color-accent);">PROMO</span>` : "";
    const tagHtml = item.isCombo
        ? `<span style="font-size:7pt; color:var(--color-accent);">COMBO DEAL</span>`
        : hasBreakdown
          ? `${promoTagHtml}<span onclick="const el=document.getElementById('${breakdownId}'); el.style.display = el.style.display === 'none' ? 'block' : 'none';" style="font-size:7pt; color:var(--color-accent); cursor:pointer; text-decoration:underline;">CUSTOMIZED</span>`
          : promoTagHtml;

    const breakdownHtml = hasBreakdown
        ? `
        <div id="${breakdownId}" style="display:none; margin-top:5px; padding-left:4px; font-size:7pt; color:var(--color-text-muted);">
            ${detailLines
                .map(
                    (d) =>
                        `<div style="display:flex; justify-content:space-between; max-width:240px;"><span>${escapeHtml(d.label)}</span><span>${d.amount > 0 ? "+" : ""}${currencySymbol()}${d.amount.toFixed(2)}</span></div>`
                )
                .join("")}
            ${hasNotes ? `<div style="margin-top:2px; font-style:italic;">"${escapeHtml(item.notes)}"</div>` : ""}
        </div>`
        : "";

    const unitPriceHtml = onPromo
        ? `<span style="color: var(--color-text-muted); text-decoration:line-through;">${currencySymbol()}${item.originalPrice.toFixed(2)}</span> <span style="color: var(--color-accent);">${currencySymbol()}${item.price.toFixed(2)}</span>`
        : `<span style="color: var(--color-text-muted);">@${currencySymbol()}${item.price.toFixed(2)}</span>`;

    return `
        <div class="cart-row" style="border-bottom: 1px dashed var(--color-border); padding: 7px 0; font-size: 9pt;">
            <div>${escapeHtml(item.name)} ${unitPriceHtml}</div>
            <div style="display:flex; justify-content: space-between; align-items:center; margin-top:5px;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <strong>${currencySymbol()}${lineTotal}</strong>
                    ${tagHtml}
                </div>
                <div class="btn-qty-container">
                    <button onclick="window.adjustCartLine('${item.cartKey}', -1)">-</button>
                    <span>${item.quantity}</span>
                    <button onclick="window.adjustCartLine('${item.cartKey}', 1)">+</button>
                </div>
            </div>
            ${breakdownHtml}
        </div>
    `;
}

export async function renderCheckoutModal(cartItems, serviceChargeActive, tipApplied = false) {
    const config = await AdminConfig.loadSettings();
    const session = await AuthSystem.getSession();
    const breakdown = CartSystem.calculateBreakdown(cartItems, config);
    const isStaff = ["employee", "manager", "admin", "owner"].includes(session.role);
    const openTables = isStaff ? await TableSessionsSystem.list("open") : [];
    const loyalty = config.loyalty || { enabled: false, pointsPerRupeeSpent: 0, rupeeValuePerPoint: 0 };
    const canUseLoyalty = session.role === "customer" && loyalty.enabled && (session.loyaltyPoints || 0) > 0;

    let finalTotal = breakdown.total;
    if (!serviceChargeActive) finalTotal -= breakdown.serviceCharge;
    if (config.tipEnabled && tipApplied) finalTotal += config.tipAmount;

    // Discount state lives on the window for this checkout session (the modal
    // re-renders in full on every cart change, so a closure variable would
    // reset itself) - startCheckout() reads it when placing the order.
    window.__checkoutDiscount = { couponCode: null, couponAmount: 0, redeemPoints: 0, redeemAmount: 0 };

    const modalHtml = `
    <div id="modal-overlay" class="modal-overlay">
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(400px, 92vw); max-height: 90vh; overflow-y: auto; box-sizing: border-box; font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0;">07 //<br> TRANSACTION SUMMARY</h2>

            <div class="cart-items-list" style="max-height: 240px; overflow-y: auto; margin: 15px 0;">
                ${cartItems.map((item, index) => cartRowHtml(item, index)).join("")}
            </div>

            <div class="breakdown-window" style="background: var(--color-bg); padding: 10px; border: 1px solid var(--color-border); margin-bottom: 20px;">
                <div class="calc-row" style="display: flex; justify-content: space-between; margin-bottom: 5px;">SUBTOTAL: <span>${currencySymbol()}${breakdown.subtotal.toFixed(2)}</span></div>
                ${
                    breakdown.promoDiscountTotal > 0
                        ? `<div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: var(--color-accent);">PROMO SAVINGS: <span>-${currencySymbol()}${breakdown.promoDiscountTotal.toFixed(2)}</span></div>`
                        : ""
                }
                <div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: var(--color-text-muted);">CGST (${(config.cgstRate * 100).toFixed(1)}%): <span>${currencySymbol()}${breakdown.cgst.toFixed(2)}</span></div>
                <div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: var(--color-text-muted);">SGST (${(config.sgstRate * 100).toFixed(1)}%): <span>${currencySymbol()}${breakdown.sgst.toFixed(2)}</span></div>

                ${
                    serviceChargeActive
                        ? `
                <div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: var(--color-text-muted);">SERVICE CHARGE (${(config.serviceChargeRate * 100).toFixed(1)}%): <span>${currencySymbol()}${breakdown.serviceCharge.toFixed(2)}</span></div>`
                        : ""
                }

                ${
                    config.tipEnabled
                        ? `
                <div class="calc-row tip-row" style="color: var(--color-accent); border: 1px dashed var(--color-accent); padding: 5px; margin: 10px 0; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 9pt;">GINGER_TIP (${currencySymbol()}${config.tipAmount}):</span>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 5px;">
                        <input type="checkbox" ${tipApplied ? "checked" : ""} onchange="window.toggleTip(this.checked)">
                        ADD
                    </label>
                </div>`
                        : ""
                }

                <div class="calc-row total-row" id="checkout-total-row" style="display: flex; justify-content: space-between; border-top: 1px solid var(--color-accent); padding-top: 10px; margin-top: 5px; font-weight:bold; font-size: 1.2rem; color: var(--color-accent);">
                    TOTAL CACHE: <span id="checkout-total-value">${currencySymbol()}${finalTotal.toFixed(2)}</span>
                </div>
                <div id="checkout-discount-line" style="display:none; font-size: 8pt; color: var(--color-success); justify-content: space-between; margin-top: 6px;"></div>
                <div id="checkout-final-total-line" style="display:none; justify-content: space-between; align-items:center; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--color-success);">
                    <span style="font-size: 0.9rem; color: var(--color-success); font-weight:bold;">YOU PAY:</span>
                    <span id="checkout-final-total-value" style="font-size: 1.3rem; color: var(--color-success); font-weight:bold;"></span>
                </div>
            </div>

            <div id="checkout-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin-bottom: 10px;"></div>

            ${
                STAFF_ROLES.includes(session.role)
                    ? `
            <div style="margin-bottom: 15px;">
                <label style="font-size: 8pt; color: var(--color-text-muted); display:block; margin-bottom:5px;">ORDER TRACKING PHONE:</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="display:flex; align-items:center; gap:6px; font-size: 8pt; color: var(--color-text-muted); cursor:pointer; white-space:nowrap;">
                        <input type="checkbox" id="checkout-guest-order" />
                        GUEST
                    </label>
                    <input id="checkout-phone" type="tel" maxlength="15" placeholder="PHONE NUMBER" style="flex:1; box-sizing: border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding: 10px; font-family: inherit;" />
                </div>
            </div>`
                    : ""
            }

            ${
                breakdown.hasPromoItem
                    ? `<p style="font-size: 7pt; color: var(--color-text-muted); margin: 0 0 15px;">Coupon codes can't be combined with promotional items in this cart.</p>`
                    : `
            <div style="margin-bottom: 15px; display:flex; gap:8px; align-items:flex-end;">
                <div style="flex:1;">
                    <label style="font-size: 8pt; color: var(--color-text-muted); display:block; margin-bottom:5px;">PROMO CODE</label>
                    <input id="checkout-coupon-code" type="text" placeholder="OPTIONAL" style="width: 100%; box-sizing: border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding: 10px; font-family: inherit; text-transform:uppercase;" />
                </div>
                <button id="checkout-apply-coupon" class="admin-btn" style="padding:11px 14px;">APPLY</button>
            </div>
            <p id="checkout-coupon-msg" style="font-size: 7pt; margin: -10px 0 12px; min-height: 10px;"></p>
            <button id="checkout-show-coupons" type="button" style="background:none; border:none; color:var(--color-text-muted); font-size: 7pt; cursor:pointer; text-decoration: underline; font-family: inherit; padding:0; margin: -8px 0 12px; display:block;">SHOW AVAILABLE CODES</button>
            <div id="checkout-public-coupons" style="display:none; margin: -8px 0 12px; font-size:7pt; color:var(--color-text-muted);"></div>`
            }

            ${
                canUseLoyalty
                    ? `
            <div style="margin-bottom: 15px;">
                <label style="font-size: 8pt; color: var(--color-text-muted); display:block; margin-bottom:5px;">REDEEM LOYALTY POINTS (you have ${session.loyaltyPoints} pts &middot; ${currencySymbol()}${(session.loyaltyPoints * loyalty.rupeeValuePerPoint).toFixed(2)} value)</label>
                <div style="display:flex; gap:8px;">
                    <input id="checkout-redeem-points" type="number" min="0" max="${session.loyaltyPoints}" placeholder="0" style="flex:1; box-sizing: border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding: 10px; font-family: inherit;" />
                    <button id="checkout-apply-points" class="admin-btn" style="padding:11px 14px;">REDEEM</button>
                </div>
            </div>`
                    : ""
            }

            ${
                isStaff
                    ? `
            ${
                openTables.length > 0
                    ? `
            <label style="display:block; font-size: 8pt; color: var(--color-text-muted); margin-bottom: 12px;">
                ATTACH TO OPEN TABLE (POSTPAID TAB)
                <select id="checkout-table-session" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; margin-top:4px;">
                    <option value="">No table - pay now</option>
                    ${openTables.map((t) => `<option value="${t.id}">TABLE ${escapeHtml(t.tableNumber)} (${t.orderCount} order${t.orderCount === 1 ? "" : "s"} so far)</option>`).join("")}
                </select>
            </label>`
                    : ""
            }`
                    : ""
            }

            ${
                isStaff
                    ? `
            <div class="payment-options" style="display: grid; grid-template-columns: 1fr; gap: 10px;">
                <button id="btn-checkout-staff" class="btn-pay" onclick="window.startCheckout('COUNTER')" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px 6px; font-size: 0.85rem; font-weight: bold; cursor: pointer; text-transform: uppercase;">[ CHECKOUT ]</button>
            </div>`
                    : `
            <div class="payment-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <button id="btn-pay-cash" class="btn-pay" onclick="window.startCheckout('COUNTER')" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px 6px; font-size: 0.85rem; font-weight: bold; cursor: pointer; text-transform: uppercase;">PAY CASH</button>
                <button id="btn-pay-online" class="btn-pay" style="background: var(--color-cyan); color: var(--color-accent-contrast); border: none; padding: 12px 6px; font-size: 0.85rem; font-weight: bold; cursor: pointer; text-transform: uppercase;" onclick="window.startCheckout('ONLINE')">PAY ONLINE (UPI)</button>
            </div>`
            }

            <button class="btn-close" onclick="window.closeModal()" style="margin-top: 15px; width: 100%; background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">BACK</button>

            ${
                serviceChargeActive
                    ? `
            <div style="text-align: center; margin-top: 15px;">
                <button onclick="window.removeServiceCharge()" style="background:none; border:none; color:var(--color-border); font-size: 7pt; cursor:pointer; text-decoration: underline; font-family: inherit;">
                    Opt-out of Service Charge
                </button>
            </div>`
                    : ""
            }
        </div>
    </div>
    `;

    document.getElementById("modal-overlay")?.remove();
    document.body.insertAdjacentHTML("beforeend", modalHtml);

    function recomputeCheckoutTotal() {
        const state = window.__checkoutDiscount;
        const totalDiscount = round2(state.couponAmount + state.redeemAmount);
        const taxableSubtotal = Math.max(0, breakdown.subtotal - totalDiscount);
        const cgst = taxableSubtotal * config.cgstRate;
        const sgst = taxableSubtotal * config.sgstRate;
        const svc = serviceChargeActive ? taxableSubtotal * config.serviceChargeRate : 0;
        const tip = config.tipEnabled && tipApplied ? config.tipAmount || 0 : 0;
        const discountedTotal = taxableSubtotal + cgst + sgst + svc + tip;

        // TOTAL CACHE always shows the undiscounted price - it never changes -
        // so the discount and the "YOU PAY" line below feel like a reward
        // instead of just silently overwriting the number the customer saw.
        const discountLine = document.getElementById("checkout-discount-line");
        const finalLine = document.getElementById("checkout-final-total-line");
        if (totalDiscount > 0) {
            discountLine.style.display = "flex";
            const parts = [];
            if (state.couponCode) parts.push(state.couponCode);
            if (state.redeemPoints > 0) parts.push(`${state.redeemPoints} pts`);
            discountLine.innerHTML = `<span>DISCOUNT (${parts.map(escapeHtml).join(" + ")})</span><span>-${currencySymbol()}${totalDiscount.toFixed(2)}</span>`;
            finalLine.style.display = "flex";
            document.getElementById("checkout-final-total-value").textContent = `${currencySymbol()}${discountedTotal.toFixed(2)}`;
        } else {
            discountLine.style.display = "none";
            finalLine.style.display = "none";
        }
    }

    document.getElementById("checkout-guest-order")?.addEventListener("change", (e) => {
        const phoneInput = document.getElementById("checkout-phone");
        phoneInput.style.display = e.target.checked ? "none" : "";
        if (e.target.checked) phoneInput.value = "";
    });

    document.getElementById("checkout-apply-coupon")?.addEventListener("click", async () => {
        const code = document.getElementById("checkout-coupon-code").value.trim();
        const msgEl = document.getElementById("checkout-coupon-msg");
        if (!code) return;
        try {
            const res = await fetch("/api/coupons/validate", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, subtotal: breakdown.subtotal })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Invalid code");
            window.__checkoutDiscount.couponCode = data.code;
            window.__checkoutDiscount.couponAmount = data.discountAmount;
            msgEl.style.color = "var(--color-success)";
            msgEl.textContent = `Applied: -${currencySymbol()}${data.discountAmount.toFixed(2)}`;
        } catch (e) {
            window.__checkoutDiscount.couponCode = null;
            window.__checkoutDiscount.couponAmount = 0;
            msgEl.style.color = "var(--color-danger)";
            msgEl.textContent = e.message;
        }
        recomputeCheckoutTotal();
    });

    document.getElementById("checkout-show-coupons")?.addEventListener("click", async () => {
        const listEl = document.getElementById("checkout-public-coupons");
        if (!listEl) return;
        if (listEl.style.display !== "none") {
            listEl.style.display = "none";
            return;
        }
        listEl.style.display = "block";
        listEl.innerHTML = "Loading...";
        const res = await fetch("/api/coupons/public", { credentials: "include" });
        const coupons = res.ok ? await res.json() : [];
        listEl.innerHTML = coupons.length
            ? coupons
                  .map(
                      (c) =>
                          `<div style="cursor:pointer; padding:3px 0; text-decoration:underline;" onclick="document.getElementById('checkout-coupon-code').value='${c.code}'">${c.code} - ${c.type === "percent" ? `${c.value}% off` : `${currencySymbol()}${c.value} off`}</div>`
                  )
                  .join("")
            : "No public codes available right now.";
    });

    document.getElementById("checkout-apply-points")?.addEventListener("click", () => {
        const requested = Math.max(0, Math.min(session.loyaltyPoints, parseInt(document.getElementById("checkout-redeem-points").value, 10) || 0));
        const remaining = Math.max(0, breakdown.subtotal - window.__checkoutDiscount.couponAmount);
        let points = requested;
        let amount = round2(points * loyalty.rupeeValuePerPoint);
        if (amount > remaining && loyalty.rupeeValuePerPoint > 0) {
            points = Math.floor(remaining / loyalty.rupeeValuePerPoint);
            amount = round2(points * loyalty.rupeeValuePerPoint);
        }
        window.__checkoutDiscount.redeemPoints = points;
        window.__checkoutDiscount.redeemAmount = amount;
        recomputeCheckoutTotal();
    });
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

/** Lazily loads Razorpay's Checkout.js widget (only ever needed once Razorpay
 *  is actually enabled and a customer reaches an unpaid ONLINE order) rather
 *  than pulling it in on every page load. */
function loadRazorpayScript() {
    if (window.Razorpay) return Promise.resolve(true);
    return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });
}

async function verifyRazorpayPayment(orderId, response) {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/verify-payment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Payment could not be verified");
    return data;
}

/** Opens Razorpay's widget for an order the server already created with a
 *  real razorpayOrderId - the order is only marked paid once /verify-payment
 *  confirms the signature server-side, never from this client callback alone. */
async function openRazorpayCheckout(order) {
    const payBtn = document.getElementById("btn-razorpay-pay");
    const statusEl = document.getElementById("razorpay-status");
    const resetBtn = () => {
        if (!payBtn) return;
        payBtn.disabled = false;
        payBtn.textContent = `PAY ${currencySymbol()}${order.total.toFixed(2)}`;
    };
    if (payBtn) {
        payBtn.disabled = true;
        payBtn.textContent = "LOADING...";
    }
    const loaded = await loadRazorpayScript();
    if (!loaded) {
        if (statusEl) {
            statusEl.style.color = "var(--color-danger)";
            statusEl.textContent = "Couldn't load the payment widget - check your connection and try again.";
        }
        resetBtn();
        return;
    }

    const rzp = new window.Razorpay({
        key: order.razorpayKeyId,
        amount: Math.round(order.total * 100),
        currency: order.razorpayCurrency || "INR",
        name: document.title || "Seven Bits Coffee",
        description: `Order #${order.orderNumber || order.id}`,
        order_id: order.razorpayOrderId,
        theme: { color: "#d97706" },
        handler: async (response) => {
            if (statusEl) {
                statusEl.style.color = "var(--color-text-muted)";
                statusEl.textContent = "Verifying payment...";
            }
            try {
                const updated = await verifyRazorpayPayment(order.id, response);
                Object.assign(order, updated);
                renderPaymentConfirmation(order, "ONLINE", { isCustomerFacing: true });
            } catch (e) {
                if (statusEl) {
                    statusEl.style.color = "var(--color-danger)";
                    statusEl.textContent = e.message;
                }
                resetBtn();
            }
        },
        modal: { ondismiss: resetBtn }
    });
    rzp.on("payment.failed", (resp) => {
        if (statusEl) {
            statusEl.style.color = "var(--color-danger)";
            statusEl.textContent = resp.error?.description || "Payment failed - please try again.";
        }
        resetBtn();
    });
    rzp.open();
}

/**
 * Shown AFTER the server has created the order and returned the real total.
 * For UPI, the QR embeds the server-confirmed amount (order.total) - never a
 * client guess - so the amount requested always matches what was ordered.
 */
export function renderPaymentConfirmation(order, method, { isCustomerFacing = false } = {}) {
    const isOnline = method === "ONLINE";
    document.getElementById("payment-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "payment-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "4000";

    if (isCustomerFacing) {
        // A customer/guest doesn't need a "print" prompt - they just want to
        // know the order went through, what it cost, and roughly how long
        // to wait. Staff placing orders at the counter still get the
        // print-oriented flow below (they need the KOT/bill).
        const totalQty = order.items.reduce((sum, i) => sum + i.quantity, 0);
        const waitLow = Math.min(20, 5 + totalQty * 2);
        const waitHigh = waitLow + 5;
        const needsRazorpayPayment = isOnline && !order.isPaid && order.razorpayOrderId;

        overlay.innerHTML = `
            <div class="modal-content" style="text-align: center; background: var(--color-surface); padding: 30px; border: 2px solid var(--color-accent);">
                <h2 style="color: var(--color-accent); font-size: 1.2rem; font-family: 'Courier New', monospace;">${needsRazorpayPayment ? "COMPLETE PAYMENT" : "ORDER CONFIRMED"}</h2>
                <p style="font-family: 'Courier New', monospace; color: var(--color-text); font-size: 11pt; margin: 16px 0 4px;">ORDER #${order.orderNumber || order.id}</p>
                <p style="font-family: 'Courier New', monospace; color: var(--color-text-muted); font-size: 9pt; margin: 0 0 20px;">
                    ${order.isPaid ? "AMOUNT PAID" : "AMOUNT DUE"}: ${currencySymbol()}${order.total.toFixed(2)}
                </p>
                ${
                    needsRazorpayPayment
                        ? `<p id="razorpay-status" style="font-family: 'Courier New', monospace; color: var(--color-text-muted); font-size: 8pt; min-height: 12px; margin: 0 0 10px;">Pay securely via Razorpay to confirm your order.</p>`
                        : `<p style="font-family: 'Courier New', monospace; color: var(--color-accent); font-size: 9pt; margin: 0 0 20px;">
                    APPROX. WAIT TIME: ${waitLow}-${waitHigh} MINS
                </p>
                <p style="font-family: 'Courier New', monospace; color: var(--color-text); font-size: 9pt; margin: 20px 0;">
                    Thank you for visiting! Have a great day.
                </p>`
                }
                <div style="display: grid; gap: 15px; margin-top: 10px;">
                    ${
                        needsRazorpayPayment
                            ? `<button id="btn-razorpay-pay" class="btn-primary" style="background: var(--color-cyan); color: var(--color-accent-contrast); border: 2px solid black; padding: 15px; font-weight: bold; cursor: pointer; font-family: 'Courier New', monospace; box-shadow: 4px 4px 0px var(--color-bg);">PAY ${currencySymbol()}${order.total.toFixed(2)}</button>
                       <button class="btn-close" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase; font-family: 'Courier New', monospace;" onclick="window.finalizeOrder(false)">PAY AT COUNTER INSTEAD</button>`
                            : `<button class="btn-primary" style="background: var(--color-accent); color: var(--color-accent-contrast); border: 2px solid black; padding: 15px; font-weight: bold; cursor: pointer; font-family: 'Courier New', monospace; box-shadow: 4px 4px 0px var(--color-bg);" onclick="window.finalizeOrder(false)">CLOSE</button>`
                    }
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        if (needsRazorpayPayment) {
            document.getElementById("btn-razorpay-pay")?.addEventListener("click", () => openRazorpayCheckout(order));
        }
        return;
    }

    overlay.innerHTML = `
        <div class="modal-content" style="text-align: center; background: var(--color-surface); padding: 30px; border: 2px solid var(--color-accent);">
            <h2 style="color: var(--color-accent); font-size: 1.2rem; font-family: 'Courier New', monospace;">${isOnline ? "UPI GATEWAY" : "COUNTER READY"}</h2>
            <p style="font-family: 'Courier New', monospace; color: var(--color-text-muted); font-size: 9pt;">ORDER #${order.orderNumber || order.id} &middot; TOTAL: ${currencySymbol()}${order.total.toFixed(2)}</p>

            ${
                isOnline
                    ? order.paymentQrUrl
                        ? `<div style="background:white; padding:10px; margin:20px auto; width:150px; border: 4px solid var(--color-accent);"><img src="${order.paymentQrUrl}" alt="UPI QR"></div>`
                        : `<p style="margin:30px 0; font-family: 'Courier New', monospace; color: var(--color-text);">Online payment isn't configured on this till yet - please pay at the counter.</p>`
                    : `<p style="margin:30px 0; font-family: 'Courier New', monospace; color: var(--color-text);">PAYMENT PENDING AT COUNTER.</p>`
            }

            <div style="display: grid; gap: 15px; margin-top: 20px;">
                <button class="btn-primary" style="background: var(--color-accent); color: var(--color-accent-contrast); border: 2px solid black; padding: 15px; font-weight: bold; cursor: pointer; font-family: 'Courier New', monospace; box-shadow: 4px 4px 0px var(--color-bg);" onclick="window.finalizeOrder(true)">PRINT &amp; DONE</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}
