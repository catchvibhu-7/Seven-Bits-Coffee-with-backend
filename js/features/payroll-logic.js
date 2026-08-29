/**
 * SEVEN BITS COFFEE - PAYROLL & TIME CLOCK
 * Location: /js/features/payroll-logic.js
 */
export const PayrollSystem = {
    async clockStatus() {
        const res = await fetch("/api/timeclock/status", { credentials: "include" });
        if (!res.ok) return { clockedIn: false, since: null };
        return res.json();
    },

    async clockIn() {
        const res = await fetch("/api/timeclock/clock-in", { method: "POST", credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not clock in");
        return data;
    },

    async clockOut() {
        const res = await fetch("/api/timeclock/clock-out", { method: "POST", credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not clock out");
        return data;
    },

    /** Current pay-period earnings for every staff member visible to this session (manager/admin/owner). */
    async fetchPayroll() {
        const res = await fetch("/api/payroll", { credentials: "include" });
        if (!res.ok) return [];
        return res.json();
    },

    async markPaid(userId) {
        const res = await fetch(`/api/payroll/${userId}/mark-paid`, { method: "POST", credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not mark as paid");
        return data;
    },

    async fetchPayrollHistory() {
        const res = await fetch("/api/payroll/history", { credentials: "include" });
        if (!res.ok) return [];
        return res.json();
    },

    /** Live clocked-in/out status for every staff member visible to this
     *  session - distinct from fetchPayroll(), which is period earnings. */
    async fetchTimeclockRoster() {
        const res = await fetch("/api/timeclock/roster", { credentials: "include" });
        if (!res.ok) return [];
        return res.json();
    },

    /** Manager-marked attendance - for staff who never log in themselves. */
    async fetchAttendance(userId = null) {
        const url = userId ? `/api/attendance?userId=${userId}` : "/api/attendance";
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return [];
        return res.json();
    },

    async markAttendance({ userId, date, hours }) {
        const res = await fetch("/api/attendance", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, date, hours })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not mark attendance");
        return data;
    },

    async deleteAttendance(id) {
        const res = await fetch(`/api/attendance/${id}`, { method: "DELETE", credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not remove entry");
        return data;
    },

    async approveOvertime(userId, date) {
        const res = await fetch("/api/overtime-approvals", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, date })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not approve overtime");
        return data;
    },

    async fetchKpi(range = "7d") {
        const res = await fetch(`/api/kpi?range=${encodeURIComponent(range)}`, { credentials: "include" });
        if (!res.ok) return null;
        return res.json();
    },

    async fetchStores() {
        const res = await fetch("/api/stores", { credentials: "include" });
        if (!res.ok) return [];
        return res.json();
    },

    async addStore({ name, address }) {
        const res = await fetch("/api/stores", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, address })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not add store");
        return data;
    },

    async updateStore(id, patch) {
        const res = await fetch(`/api/stores/${encodeURIComponent(id)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not update store");
        return data;
    },

    /** Closing a store - pass a real storeId to move its staff there
     *  instead of deactivating them (see DELETE /api/stores/:id). */
    async removeStore(id, { reassignToStoreId = null } = {}) {
        const res = await fetch(`/api/stores/${encodeURIComponent(id)}`, {
            method: "DELETE",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reassignToStoreId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not remove store");
        return data;
    },

    async changeUserRole(id, role) {
        const res = await fetch(`/api/users/${encodeURIComponent(id)}/role`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not change role");
        return data;
    }
};
