/**
 * SEVEN BITS COFFEE - TAX ENGINE (client-side preview)
 * Location: /js/features/cart-logic.js
 *
 * This produces the estimate shown in the checkout modal before the order is
 * placed. It is NOT the source of truth - server.js recalculates the real
 * total from its own menu prices and config when the order is actually
 * created, so a tampered client can't change what gets charged/printed.
 */
/**
 * A menu item "on promotion" (item.promoDiscount = {type: 'percent'|'flat',
 * value}) auto-discounts its base price, no coupon needed. Mirrors
 * promoUnitPrice() in server.js so cart/menu previews match what the server
 * will actually charge. Customization price deltas are applied on top of
 * this discounted base separately (see addCartLine() in app.js), not
 * discounted themselves.
 */
export function discountedBasePrice(product) {
    const promo = product.promoDiscount;
    if (!promo) return product.price;
    const discounted = promo.type === "percent" ? product.price * (1 - promo.value / 100) : product.price - promo.value;
    return Math.max(0, discounted);
}

export const CartSystem = {
    calculateBreakdown(items, config = {}) {
        const cgstRate = config.cgstRate ?? 0.05;
        const sgstRate = config.sgstRate ?? 0.05;
        const serviceChargeRate = config.serviceChargeRate ?? 0.02;

        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const promoDiscountTotal = items.reduce((sum, item) => sum + ((item.originalPrice ?? item.price) - item.price) * item.quantity, 0);
        const hasPromoItem = items.some((item) => !!item.promoDiscount);
        const cgst = subtotal * cgstRate;
        const sgst = subtotal * sgstRate;
        const serviceCharge = subtotal * serviceChargeRate;

        return {
            subtotal,
            promoDiscountTotal,
            hasPromoItem,
            cgst,
            sgst,
            serviceCharge,
            total: subtotal + cgst + sgst + serviceCharge
        };
    }
};
