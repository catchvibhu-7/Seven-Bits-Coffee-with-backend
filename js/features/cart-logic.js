/**
 * SEVEN BITS COFFEE - TAX ENGINE (client-side preview)
 * Location: /js/features/cart-logic.js
 *
 * This produces the estimate shown in the checkout modal before the order is
 * placed. It is NOT the source of truth - server.js recalculates the real
 * total from its own menu prices and config when the order is actually
 * created, so a tampered client can't change what gets charged/printed.
 */
export const CartSystem = {
    calculateBreakdown(items, config = {}) {
        const cgstRate = config.cgstRate ?? 0.05;
        const sgstRate = config.sgstRate ?? 0.05;
        const serviceChargeRate = config.serviceChargeRate ?? 0.02;

        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const cgst = subtotal * cgstRate;
        const sgst = subtotal * sgstRate;
        const serviceCharge = subtotal * serviceChargeRate;

        return {
            subtotal,
            cgst,
            sgst,
            serviceCharge,
            total: subtotal + cgst + sgst + serviceCharge
        };
    }
};
