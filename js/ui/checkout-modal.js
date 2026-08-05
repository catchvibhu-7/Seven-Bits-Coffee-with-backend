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
import { AdminConfig } from "../features/config-logic.js";

export async function renderCheckoutModal(cartItems, serviceChargeActive, tipApplied = false) {
    const config = await AdminConfig.loadSettings();
    const breakdown = CartSystem.calculateBreakdown(cartItems, config);

    let finalTotal = breakdown.total;
    if (!serviceChargeActive) finalTotal -= breakdown.serviceCharge;
    if (config.tipEnabled && tipApplied) finalTotal += config.tipAmount;

    const modalHtml = `
    <div id="modal-overlay" class="modal-overlay">
        <div class="modal-content" style="border: 2px solid #d97706; background: #111; color: #f9fafb; padding: 30px; width: 400px; font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid #d97706; padding-bottom: 10px; margin-top:0;">07 //<br> TRANSACTION SUMMARY</h2>

            <div class="cart-items-list" style="max-height: 200px; overflow-y: auto; margin: 15px 0;">
                ${cartItems
                    .map(
                        (item) => `
                    <div class="cart-row" style="border-bottom: 1px dashed #222; padding: 5px 0; font-size: 9pt; display: flex; justify-content: space-between;">
                        <span style="color: #d97706; font-weight: bold; width: 35px; display: inline-block;">${item.quantity}x</span>
                        <span style="flex: 1; text-align: left;">${item.name} <span style="color: #666;">@\u20b9${item.price}</span></span>
                        <span style="font-weight: bold;">\u20b9${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                `
                    )
                    .join("")}
            </div>

            <div class="breakdown-window" style="background: #000; padding: 10px; border: 1px solid #222; margin-bottom: 20px;">
                <div class="calc-row" style="display: flex; justify-content: space-between; margin-bottom: 5px;">SUBTOTAL: <span>\u20b9${breakdown.subtotal.toFixed(2)}</span></div>
                <div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: #888;">CGST (${(config.cgstRate * 100).toFixed(1)}%): <span>\u20b9${breakdown.cgst.toFixed(2)}</span></div>
                <div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: #888;">SGST (${(config.sgstRate * 100).toFixed(1)}%): <span>\u20b9${breakdown.sgst.toFixed(2)}</span></div>

                ${
                    serviceChargeActive
                        ? `
                <div class="calc-row" style="display: flex; justify-content: space-between; font-size: 8pt; color: #888;">SERVICE CHARGE (${(config.serviceChargeRate * 100).toFixed(1)}%): <span>\u20b9${breakdown.serviceCharge.toFixed(2)}</span></div>`
                        : ""
                }

                ${
                    config.tipEnabled
                        ? `
                <div class="calc-row tip-row" style="color: #d97706; border: 1px dashed #d97706; padding: 5px; margin: 10px 0; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 9pt;">GINGER_TIP (\u20b9${config.tipAmount}):</span>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 5px;">
                        <input type="checkbox" ${tipApplied ? "checked" : ""} onchange="window.toggleTip(this.checked)">
                        ADD
                    </label>
                </div>`
                        : ""
                }

                <div class="calc-row total-row" style="display: flex; justify-content: space-between; border-top: 1px solid #d97706; padding-top: 10px; margin-top: 5px; font-weight:bold; font-size: 1.2rem; color: #d97706;">
                    TOTAL CACHE: <span>\u20b9${finalTotal.toFixed(2)}</span>
                </div>
            </div>

            <div id="checkout-error" style="color:#f87171; font-size: 8pt; min-height: 12px; margin-bottom: 10px;"></div>

            <div class="payment-options" style="display: grid; gap: 10px;">
                <button id="btn-pay-cash" class="btn-pay" onclick="window.startCheckout('COUNTER')" style="background: #d97706; color: black; border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">PAY CASH</button>
                <button id="btn-pay-online" class="btn-pay" style="background: #22d3ee; color: black; border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;" onclick="window.startCheckout('ONLINE')">PAY ONLINE (UPI)</button>
            </div>

            <button class="btn-close" onclick="window.closeModal()" style="margin-top: 15px; width: 100%; background: #333; color: white; border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">BACK</button>

            ${
                serviceChargeActive
                    ? `
            <div style="text-align: center; margin-top: 15px;">
                <button onclick="window.removeServiceCharge()" style="background:none; border:none; color:#333; font-size: 7pt; cursor:pointer; text-decoration: underline; font-family: inherit;">
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
        <div class="modal-content" style="text-align: center; background: black; padding: 30px; border: 2px solid #d97706;">
            <h2 style="color: #d97706; font-size: 1.2rem; font-family: 'Courier New', monospace;">${isOnline ? "UPI GATEWAY" : "COUNTER READY"}</h2>
            <p style="font-family: 'Courier New', monospace; color: #888; font-size: 9pt;">ORDER #${order.id} &middot; TOTAL: \u20b9${order.total.toFixed(2)}</p>

            ${
                isOnline
                    ? order.paymentQrUrl
                        ? `<div style="background:white; padding:10px; margin:20px auto; width:150px; border: 4px solid #d97706;"><img src="${order.paymentQrUrl}" alt="UPI QR"></div>`
                        : `<p style="margin:30px 0; font-family: 'Courier New', monospace; color: white;">Online payment isn't configured on this till yet - please pay at the counter.</p>`
                    : `<p style="margin:30px 0; font-family: 'Courier New', monospace; color: white;">PAYMENT PENDING AT COUNTER.</p>`
            }

            <div style="display: grid; gap: 15px; margin-top: 20px;">
                <button class="btn-primary" style="background: #d97706; color: black; border: 2px solid black; padding: 15px; font-weight: bold; cursor: pointer; font-family: 'Courier New', monospace; box-shadow: 4px 4px 0px #000;" onclick="window.finalizeAndPrint()">PRINT &amp; DONE</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}
