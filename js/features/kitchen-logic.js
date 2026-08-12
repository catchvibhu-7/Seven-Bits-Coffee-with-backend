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

    async pushOrder(cartItems, method, { serviceChargeActive = true, tipApplied = false, phone = null } = {}) {
        const res = await fetch("/api/orders", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                items: cartItems.map((i) => ({ id: i.id, quantity: i.quantity })),
                method,
                serviceChargeActive,
                tipApplied,
                phone
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
    connectLiveUpdates(onChange) {
        const source = new EventSource("/api/orders/stream");
        source.addEventListener("orders", () => onChange());
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
