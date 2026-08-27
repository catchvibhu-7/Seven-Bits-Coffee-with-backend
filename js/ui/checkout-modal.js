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
import { CartSystem, discountedUnitPrice } from "../features/cart-logic.js";
import { AdminConfig } from "../features/config-logic.js";
import { AuthSystem } from "../features/auth-logic.js";

export async function renderCheckoutModal(cartItems, serviceChargeActive, tipApplied = false, appliedCoupon = null) {
    const config = await AdminConfig.loadSettings();
    const session = await AuthSystem.getSession();
    const breakdown = CartSystem.calculateBreakdown(cartItems, config, appliedCoupon);

    let finalTotal = breakdown.total;
    if (!serviceChargeActive) finalTotal -= breakdown.serviceCharge;
    if (config.tipEnabled && tipApplied) finalTotal += config.tipAmount;

    const modalHtml = `
    <div id="modal-overlay" class="modal-overlay">
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 400px; font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0;">07 //<br> TRANSACTION SUMMARY</h2>

            <div class="cart-items-list" style="max-height: 200px; overflow-y: auto; margin: 15px 0;">
                ${cartItems
                    .map((item) => {
                        const unitPrice = discountedUnitPrice(item);
                        const onPromo = unitPrice < item.price;
                        const priceLabel = onPromo
                            ? `<span style="color: var(--color-text-muted); text-decoration: line-through;">\u20b9${item.price}</span> <span style="color: var(--color-accent);">\u20b9${unitPrice.toFixed(2)} PROMO</span>`
                            : `<span style="color: var(--color-text-muted);">@\u20b9${item.price}</span>`;
                        return `
                    <div class="cart-row" style="border-bottom: 1px dashed var(--color-border); padding: 5px 0; font-size: 9pt; display: flex; justify-content: space-between;">
                        <span style="color: var(--color-accent); font-weight: bold; width: 35px; display: inline-block;">${item.quantity}x</span>
                        <span style="flex: 1; text-align: left;">${item.name} ${priceLabel}</span>
                        <span style="font-weight: bold;">\u20b9${(unitPrice * item.quantity).toFixed(2)}</span>
                    </div>
                `;
                    })
                    .join("")}
            </div>

            <div class="coupon-window" style="margin-bottom: 15px;">
                ${
                    breakdown.hasPromoItem
                        ? `<p style="font-size: 7pt; color: var(--color-text-muted); margin: 0;">Coupons can't be combined with promotional items in this cart.</p>`
                        : appliedCoupon
                          ? `
                    <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid var(--color-accent); padding:8px; font-size:8pt;">
                        <span style="color:var(--color-accent);">COUPON "${appliedCoupon.code}" APPLIED</span>
                        <button onclick="window.removeCoupon()" style="background:none; border:none; color:var(--color-text-muted); cursor:pointer; text-decoration:underline; font-family:inherit; font-size:7pt;">REMOVE</button>
                    </div>`
                          : `
                    <div style="display:flex; gap:6px;">
                        <input id="coupon-code-input" type="text" placeholder="COUPON CODE" style="flex:1; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:8px; font-family:inherit; text-transform:uppercase; font-size:9pt;" />
                        <button onclick="window.applyCouponCode()" style="background: var(--color-border); color: var(--color-text); border: none; padding: 8px 12px; cursor: pointer; text-transform: uppercase; font-family:inherit; font-size:8pt;">APPLY</button>
                    </div>
                    <p id="coupon-error" style="color:var(--color-danger); font-size: 7pt; min-height: 10px; margin: 4px 0 0;"></p>
                    <button onclick="window.toggleShowCoupons()" style="background:none; border:none; color:var(--color-text-muted); font-size: 7pt; cursor:pointer; text-decoration: underline; font-family: inherit; padding:0; margin-top:4px;">SHOW AVAILABLE CODES</button>
                    <div id="public-coupons-list" style="display:none; margin-top:6px; font-size:7pt; color:var(--color-text-muted);"></div>`
                }
            </div>

            <div class="breakdown-window" style="background: var(--color-bg); padding: 10px; border: 1px solid var(--color-border); margin-bottom: 20px;">
                <div class="calc-row" style="display: flex; justify-content: space-between; margin-bottom: 5px;">SUBTOTAL: <span>\u20b9${breakdown.subtotal.toFixed(2)}</span></div>
                ${
                    breakdown.promoDiscountTotal > 0
                        ? `<div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: var(--color-accent);">PROMO SAVINGS: <span>-\u20b9${breakdown.promoDiscountTotal.toFixed(2)}</span></div>`
                        : ""
                }
                ${
                    breakdown.couponDiscount > 0
                        ? `<div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: var(--color-accent);">COUPON SAVINGS: <span>-\u20b9${breakdown.couponDiscount.toFixed(2)}</span></div>`
                        : ""
                }
                <div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: var(--color-text-muted);">CGST (${(config.cgstRate * 100).toFixed(1)}%): <span>\u20b9${breakdown.cgst.toFixed(2)}</span></div>
                <div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: var(--color-text-muted);">SGST (${(config.sgstRate * 100).toFixed(1)}%): <span>\u20b9${breakdown.sgst.toFixed(2)}</span></div>

                ${
                    serviceChargeActive
                        ? `
                <div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: var(--color-text-muted);">SERVICE CHARGE (${(config.serviceChargeRate * 100).toFixed(1)}%): <span>\u20b9${breakdown.serviceCharge.toFixed(2)}</span></div>`
                        : ""
                }

                ${
                    config.tipEnabled
                        ? `
                <div class="calc-row tip-row" style="color: var(--color-accent); border: 1px dashed var(--color-accent); padding: 5px; margin: 10px 0; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 9pt;">GINGER_TIP (\u20b9${config.tipAmount}):</span>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 5px;">
                        <input type="checkbox" ${tipApplied ? "checked" : ""} onchange="window.toggleTip(this.checked)">
                        ADD
                    </label>
                </div>`
                        : ""
                }

                <div class="calc-row total-row" style="display: flex; justify-content: space-between; border-top: 1px solid var(--color-accent); padding-top: 10px; margin-top: 5px; font-weight:bold; font-size: 1.2rem; color: var(--color-accent);">
                    TOTAL CACHE: <span>\u20b9${finalTotal.toFixed(2)}</span>
                </div>
            </div>

            <div id="checkout-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin-bottom: 10px;"></div>

            <div style="margin-bottom: 15px;">
                <label style="font-size: 8pt; color: var(--color-text-muted); display:block; margin-bottom:5px;">ORDER TRACKING PHONE:</label>
                <input id="checkout-phone" type="tel" value="${session.phone || ""}" ${session.role === "customer" ? "readonly" : ""}
                    placeholder="PHONE NUMBER" style="width: 100%; box-sizing: border-box; background:var(--color-bg); border:1px solid var(--color-border); color:${session.role === "customer" ? "var(--color-text-muted)" : "var(--color-text)"}; padding: 10px; font-family: inherit;" />
            </div>

            <div class="payment-options" style="display: grid; gap: 10px;">
                <button id="btn-pay-cash" class="btn-pay" onclick="window.startCheckout('COUNTER')" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">PAY CASH</button>
                <button id="btn-pay-online" class="btn-pay" style="background: var(--color-cyan); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;" onclick="window.startCheckout('ONLINE')">PAY ONLINE (UPI)</button>
            </div>

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
}

/**
 * Shown AFTER the server has created the order and returned the real total.
 * For UPI, the QR embeds the server-confirmed amount (order.total) - never a
 * client guess - so the amount requested always matches what was ordered.
 */
export function renderPaymentConfirmation(order, method) {
    const isOnline = method === "ONLINE";
    document.getElementById("payment-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "payment-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "4000";

    overlay.innerHTML = `
        <div class="modal-content" style="text-align: center; background: var(--color-surface); padding: 30px; border: 2px solid var(--color-accent);">
            <h2 style="color: var(--color-accent); font-size: 1.2rem; font-family: 'Courier New', monospace;">${isOnline ? "UPI GATEWAY" : "COUNTER READY"}</h2>
            <p style="font-family: 'Courier New', monospace; color: var(--color-text-muted); font-size: 9pt;">ORDER #${order.orderNumber || order.id} &middot; TOTAL: \u20b9${order.total.toFixed(2)}</p>

            ${
                isOnline
                    ? order.paymentQrUrl
                        ? `<div style="background:white; padding:10px; margin:20px auto; width:150px; border: 4px solid var(--color-accent);"><img src="${order.paymentQrUrl}" alt="UPI QR"></div>`
                        : `<p style="margin:30px 0; font-family: 'Courier New', monospace; color: var(--color-text);">Online payment isn't configured on this till yet - please pay at the counter.</p>`
                    : `<p style="margin:30px 0; font-family: 'Courier New', monospace; color: var(--color-text);">PAYMENT PENDING AT COUNTER.</p>`
            }

            <div style="display: grid; gap: 15px; margin-top: 20px;">
                <button class="btn-primary" style="background: var(--color-accent); color: var(--color-accent-contrast); border: 2px solid black; padding: 15px; font-weight: bold; cursor: pointer; font-family: 'Courier New', monospace; box-shadow: 4px 4px 0px var(--color-bg);" onclick="window.finalizeAndPrint()">PRINT &amp; DONE</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}
