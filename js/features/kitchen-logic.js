/**
 * SEVEN BITS COFFEE - KITCHEN SYSTEM logic
 * Location: /js/features/kitchen-logic.js
 *
 * Orders are now stored server-side (data/orders.json) so the register and
 * the kitchen display see the same order list even on different devices/tabs.
 * connectLiveUpdates() opens a Server-Sent Events stream so every connected
 * station refreshes automatically when any station changes an order.
 */
export const KitchenSystem = {
    orders: [],

    async fetchOrders() {
        const res = await fetch("/api/orders", { credentials: "include" });
        if (res.ok) this.orders = await res.json();
        return this.orders;
    },

    /** Orders belonging to the signed-in customer or guest phone session. */
    async fetchMine() {
        const res = await fetch("/api/orders/mine", { credentials: "include" });
        if (!res.ok) return [];
        return res.json();
    },

    async pushOrder(cartItems, method, { serviceChargeActive = true, tipApplied = false, phone = null, markPaidNow = false, tableSessionId = null, couponCode = null, redeemPoints = 0 } = {}) {
        const res = await fetch("/api/orders", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                items: cartItems.map((i) =>
                    i.isCombo
                        ? { type: "combo", comboId: i.comboId, quantity: i.quantity }
                        : {
                              id: i.id,
                              quantity: i.quantity,
                              customization: { size: i.size, milk: i.milk, extras: (i.extras || []).map((e) => e.key), notes: i.notes }
                          }
                ),
                method,
                serviceChargeActive,
                tipApplied,
                phone,
                markPaidNow,
                tableSessionId,
                couponCode,
                redeemPoints
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not place order");
        this.orders.push(data);
        return data;
    },

    async markPaid(orderId) {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "markPaid" })
        });
        if (res.ok) await this.fetchOrders();
    },

    async markDone(orderId, station) {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "markDone", station })
        });
        if (res.ok) await this.fetchOrders();
    },

    /**
     * Opens an SSE connection so this station's order list refreshes as soon
     * as any other station (register, another kitchen screen) changes an
     * order - no manual refresh or same-tab requirement needed anymore.
     */
    connectLiveUpdates(onChange, onArcadeChange) {
        const source = new EventSource("/api/orders/stream");
        source.addEventListener("orders", () => onChange());
        // Same stream, different event type - the arcade (Tic-Tac-Toe matches)
        // piggybacks on this connection rather than opening a second one.
        if (onArcadeChange) source.addEventListener("arcade", () => onArcadeChange());
        source.onerror = () => {
            // EventSource auto-reconnects; nothing to do here.
        };
        return source;
    },

    getStation(item) {
        if (item.section === "sweets") return "DESSERTS";
        const baristaSections = ["fast-sellers", "limited", "classics"];
        if (baristaSections.includes(item.section)) return "BARISTA";
        return "KITCHEN";
    }
};
