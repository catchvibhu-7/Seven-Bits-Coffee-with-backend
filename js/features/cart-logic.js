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
 * value}) auto-discounts every line for that item, no coupon needed. Mirrors
 * promoUnitPrice() in server.js so the pre-checkout preview matches what the
 * server will actually charge.
 */
export function discountedUnitPrice(item) {
    const promo = item.promoDiscount;
    if (!promo) return item.price;
    const discounted = promo.type === "percent" ? item.price * (1 - promo.value / 100) : item.price - promo.value;
    return Math.max(0, discounted);
}

export const CartSystem = {
    /**
     * @param {object} [appliedCoupon] - {code, type, value} from a validated
     *   /api/coupons/validate response. Ignored (never applied) if any cart
     *   item carries a promoDiscount - the two discount mechanisms are
     *   mutually exclusive, mirroring computeOrder() in server.js.
     */
    calculateBreakdown(items, config = {}, appliedCoupon = null) {
        const cgstRate = config.cgstRate ?? 0.05;
        const sgstRate = config.sgstRate ?? 0.05;
        const serviceChargeRate = config.serviceChargeRate ?? 0.02;

        const subtotal = items.reduce((sum, item) => sum + discountedUnitPrice(item) * item.quantity, 0);
        const promoDiscountTotal = items.reduce((sum, item) => sum + (item.price - discountedUnitPrice(item)) * item.quantity, 0);
        const hasPromoItem = items.some((item) => !!item.promoDiscount);

        let couponDiscount = 0;
        if (appliedCoupon && !hasPromoItem) {
            const raw = appliedCoupon.type === "percent" ? subtotal * (appliedCoupon.value / 100) : appliedCoupon.value;
            couponDiscount = Math.max(0, Math.min(subtotal, raw));
        }
        const taxableAmount = subtotal - couponDiscount;

        const cgst = taxableAmount * cgstRate;
        const sgst = taxableAmount * sgstRate;
        const serviceCharge = taxableAmount * serviceChargeRate;

        return {
            subtotal,
            promoDiscountTotal,
            hasPromoItem,
            couponDiscount,
            cgst,
            sgst,
            serviceCharge,
            total: taxableAmount + cgst + sgst + serviceCharge
        };
    }
};
