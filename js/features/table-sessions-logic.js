/**
 * SEVEN BITS COFFEE - TABLE SESSIONS (POSTPAID TABS)
 * Location: /js/features/table-sessions-logic.js
 *
 * Staff-only concept: open a table when a group starts a tab, tag orders to
 * it as they come in, close it to get one combined bill. The server is
 * authoritative for who can open/close/tag (see server.js KITCHEN_ROLES
 * checks) - this is just the fetch wrapper.
 */
export const TableSessionsSystem = {
    async list(status = null) {
        const url = status ? `/api/table-sessions?status=${encodeURIComponent(status)}` : "/api/table-sessions";
        const res = await fetch(url, { credentials: "include" });
        return res.ok ? res.json() : [];
    },

    async get(id) {
        const res = await fetch(`/api/table-sessions/${id}`, { credentials: "include" });
        return res.ok ? res.json() : null;
    },

    async open(tableNumber, note = "", customerName = "", customerPhone = "") {
        const res = await fetch("/api/table-sessions", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tableNumber, note, customerName, customerPhone })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not open table");
        return data;
    },

    async update(id, { tableNumber, customerName, customerPhone }) {
        const res = await fetch(`/api/table-sessions/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tableNumber, customerName, customerPhone })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not update table");
        return data;
    },

    async close(id, markPaid, paymentMethod = null) {
        const res = await fetch(`/api/table-sessions/${id}/close`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ markPaid, paymentMethod })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not close table");
        return data;
    }
};
