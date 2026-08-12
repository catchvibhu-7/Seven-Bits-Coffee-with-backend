/**
 * SEVEN BITS COFFEE - AUTH SYSTEM
 * Location: /js/features/auth-logic.js
 *
 * Every method here just calls server.js (see /api/auth/*) and reports back
 * what the server decided - the browser never stores a password or a role
 * it could forge; it only carries the httpOnly session cookie the server
 * issues after checking credentials.
 */
export const AuthSystem = {
    async getSession() {
        try {
            const res = await fetch("/api/auth/session", { credentials: "include" });
            if (!res.ok) return { authenticated: false };
            return await res.json();
        } catch (e) {
            return { authenticated: false };
        }
    },

    async login(username, password) {
        const res = await fetch("/api/auth/login", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Login failed");
        return data;
    },

    async registerCustomer({ username, password, name, phone }) {
        const res = await fetch("/api/auth/register", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, name, phone })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not create account");
        return data;
    },

    async continueAsGuest(phone) {
        const res = await fetch("/api/auth/guest", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not continue as guest");
        return data;
    },

    async logout() {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    },

    /**
     * Fast client-side "as you type" username availability check (backed by
     * the server's Bloom filter for a cheap negative, falling back to a real
     * lookup only when the filter says "maybe").
     */
    async checkUsernameAvailable(username) {
        if (!username || username.length < 3) return null;
        try {
            const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.available;
        } catch (e) {
            return null;
        }
    },

    async changePassword(currentPassword, newPassword) {
        const res = await fetch("/api/auth/change-password", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not change password");
        return data;
    },

    async forgotPassword({ username, phone, newPassword }) {
        const res = await fetch("/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, phone, newPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not reset password");
        return data;
    }
};
