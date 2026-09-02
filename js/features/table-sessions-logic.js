/**
 * SEVEN BITS COFFEE - TABLE SESSIONS (POSTPAID TABS)
 * Location: /js/features/table-sessions-logic.js
 *
 * Staff-only concept: open a table when a group starts a tab, tag orders to
 * it as they come in, close it to get one combined bill. The server is
 * authoritative for who can open/close/tag (see server.js KITCHEN_ROLES
 * checks) - this is just the fetch wrapper.
 */
import { StoreSystem } from "./store-logic.js";

export const TableSessionsSystem = {
    async list(status = null) {
        // storeId narrows to one of a multi-store account's several
        // accessible stores (the Orders/Billing store switcher) - a
        // single-store manager/employee never has this set, so this is a
        // no-op for them.
        const storeId = StoreSystem.getStaffSelectedStoreId();
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (storeId != null) params.set("storeId", storeId);
        const qs = params.toString();
        const res = await fetch(`/api/table-sessions${qs ? `?${qs}` : ""}`, { credentials: "include" });
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
    },

    /** Settles whatever's currently due on this table WITHOUT closing it -
     *  the table stays open for more rounds afterward. */
    async settleRound(id, paymentMethod = null) {
        const res = await fetch(`/api/table-sessions/${id}/settle-round`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentMethod })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not settle this round");
        return data;
    }
};
