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
    settings: {
        shopName: "SEVEN BITS COFFEE",
        cgstRate: 0.05,
        sgstRate: 0.05,
        serviceChargeRate: 0.02,
        tipEnabled: true,
        tipAmount: 7,
        currency: "\u20b9"
    },

    async loadSettings() {
        const res = await fetch("/api/config");
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
