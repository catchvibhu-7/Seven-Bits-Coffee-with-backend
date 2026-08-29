/**
 * SEVEN BITS COFFEE - SYSTEM CONFIG
 * Location: /js/features/config-logic.js
 *
 * Settings now persist server-side (data/config.json) so every station sees
 * the same tax rates, tip settings, etc. Editing (saveSettings) requires an
 * authenticated admin session - the server enforces this even if the client
 * is bypassed.
 */
export const AdminConfig = {
    // Empty until loadSettings() resolves (called before anything else reads
    // this, on every page load - see refreshSession() in app.js) - kept
    // empty rather than a hardcoded default snapshot of server.js's real
    // schema, which drifted out of sync with it before and was never
    // actually read from in practice anyway.
    settings: {},

    /** storeId: only meaningful for a customer/guest/anonymous visitor who's
     *  picked a store (see js/features/store-logic.js) - a staff session
     *  tied to its own store always wins server-side regardless. */
    async loadSettings(storeId = null) {
        const url = storeId != null ? `/api/config?storeId=${encodeURIComponent(storeId)}` : "/api/config";
        const res = await fetch(url);
        if (res.ok) this.settings = await res.json();
        return this.settings;
    },

    async saveSettings(newSettings) {
        const res = await fetch("/api/config", {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newSettings)
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Could not save settings");
        }
        this.settings = await res.json();
        return this.settings;
    }
};

/** Every price display in the app calls this instead of hardcoding "₹" -
 *  admin-configurable (Admin > Payments & Tax), defaults to what the app
 *  always showed so nothing changes until an admin edits it. */
export function currencySymbol() {
    return AdminConfig.settings.currencySymbol || "₹";
}
