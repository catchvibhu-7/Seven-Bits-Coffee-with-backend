/**
 * SEVEN BITS COFFEE - SECURITY SYSTEM
 * Location: /js/features/auth-logic.js
 *
 * Auth is now verified server-side (see server.js /api/admin/*). The browser
 * never holds the password or a fake "logged in" flag it can forge - it just
 * carries an httpOnly session cookie the server issues after checking a
 * hashed password.
 */
export const SecuritySystem = {
    async checkAccess() {
        try {
            const res = await fetch("/api/admin/session", { credentials: "include" });
            if (!res.ok) return false;
            const data = await res.json();
            return !!data.authenticated;
        } catch (e) {
            return false;
        }
    },

    async login(password) {
        const res = await fetch("/api/admin/login", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || "Login failed");
        }
        return true;
    },

    async logout() {
        await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    }
};
