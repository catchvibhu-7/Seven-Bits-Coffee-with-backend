/**
 * SEVEN BITS COFFEE - BROWSER NOTIFICATION FOR ORDER READY
 * Location: /js/features/notification-logic.js
 *
 * Uses the plain browser Notification API - no service worker, no
 * server-side push subscription, no new dependency. Fires only while the
 * tab is still open somewhere (even backgrounded/minimized), not if it's
 * been fully closed. Deliberately kept this simple: this project has zero
 * npm dependencies, and true push (working with the tab closed) would need
 * VAPID keys + a service worker + Web Push payload encryption - a lot of
 * infrastructure for what's a nice-to-have, not a core feature.
 */
export const NotificationSystem = {
    isSupported() {
        return typeof Notification !== "undefined";
    },
    permission() {
        return this.isSupported() ? Notification.permission : "unsupported";
    },
    async requestPermission() {
        if (!this.isSupported()) return "unsupported";
        return Notification.requestPermission();
    },
    notifyOrderReady(order) {
        if (!this.isSupported() || Notification.permission !== "granted") return;
        const n = new Notification("Order Ready ☕", {
            body: `#${order.orderNumber || order.id} is ready for pickup.`,
            tag: `order-ready-${order.id}` // replaces any earlier notification for this order instead of stacking duplicates
        });
        n.onclick = () => {
            window.focus();
            n.close();
        };
    }
};
