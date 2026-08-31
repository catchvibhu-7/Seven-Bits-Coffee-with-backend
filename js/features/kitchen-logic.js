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

    // Set by billing-page.js's "+ New order for this bill" shortcut, read
    // and cleared by checkout-modal.js the next time it opens - the mirror
    // image of selectBillForOrder() (billing-page.js), which pre-selects a
    // bill in Billing AFTER checkout creates an order. { id, orderNumber } or null.
    pendingAttachTarget: null,

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

    async pushOrder(
        cartItems,
        method,
        {
            serviceChargeActive = true,
            tipApplied = false,
            phone = null,
            markPaidNow = false,
            tableSessionId = null,
            attachToOrderId = null,
            couponCode = null,
            redeemPoints = 0,
            guestOrder = false,
            orderType = "takeaway",
            storeId = null
        } = {}
    ) {
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
                attachToOrderId,
                couponCode,
                redeemPoints,
                guestOrder,
                orderType,
                // Only meaningful for a customer/guest session (no storeId of
                // their own - see js/features/store-logic.js); ignored
                // server-side for a staff session, which always keeps its
                // own assigned store.
                storeId
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not place order");
        this.orders.push(data);
        return data;
    },

    /** Staff tagging/correcting who a bill is for (phone/username, auto-
     *  detected server-side) and, for a dine-in order, which table - from
     *  the Billing page. */
    async tagOrderInfo(orderId, { contact, tableNumber }) {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "tagInfo", contact, tableNumber })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not update order");
        await this.fetchOrders();
        return data;
    },

    /** Staff toggling service charge/tip and applying a coupon/loyalty
     *  redemption from the Billing page - recomputed and persisted
     *  server-side (never trust a client-computed total), same tax/discount
     *  math as placing a fresh order. */
    async adjustBill(orderId, { serviceChargeActive, tipApplied, couponCode, redeemPoints }) {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "adjustBill", serviceChargeActive, tipApplied, couponCode, redeemPoints })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not update bill");
        await this.fetchOrders();
        return data;
    },

    /** Adds/removes/re-quantities lines on an order that hasn't been paid
     *  yet - `items` is the same raw cart shape POST /api/orders takes
     *  (id/quantity/customization, not pre-priced), so the server can
     *  re-price everything itself rather than trusting client math. */
    async editItems(orderId, items) {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "editItems", items })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not update items");
        await this.fetchOrders();
        return data;
    },

    /** Staff-only typeahead for the "attach to existing bill" picker - short,
     *  capped, server-filtered (not the full order list) since this fires on
     *  every keystroke. */
    async searchBills(query) {
        const res = await fetch(`/api/orders/search?q=${encodeURIComponent(query)}`, { credentials: "include" });
        return res.ok ? res.json() : [];
    },

    /** Settles a root order and everything staff have attached to it in one
     *  shared payment event - the standalone-order counterpart to
     *  TableSessionsSystem.settleRound(). */
    async settleGroup(rootOrderId, paymentMethod = null) {
        const res = await fetch(`/api/orders/${encodeURIComponent(rootOrderId)}/settle-group`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentMethod })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not settle this bill");
        await this.fetchOrders();
        return data;
    },

    async markPaid(orderId, paymentMethod = null) {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "markPaid", paymentMethod })
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
    },

    async markServed(orderId) {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "markServed" })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Order isn't ready yet");
        await this.fetchOrders();
        return data;
    },

    /** Mirrors server.js's orderStatusOf() - only /api/orders/mine includes
     *  a computed status server-side, so anything working from the staff
     *  order list (GET /api/orders) derives it the same way here instead. */
    statusOf(order) {
        if (order.servedAt) return "SERVED";
        if (!order.items.length) return "RECEIVED";
        return order.items.every((i) => i.isDone) ? "READY" : "PREPARING";
    },

    STATUS_COLORS: {
        RECEIVED: "var(--color-accent)",
        PREPARING: "var(--color-cyan)",
        READY: "var(--color-success)",
        SERVED: "var(--color-text-muted)"
    }
};
