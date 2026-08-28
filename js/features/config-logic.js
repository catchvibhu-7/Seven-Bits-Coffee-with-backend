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
