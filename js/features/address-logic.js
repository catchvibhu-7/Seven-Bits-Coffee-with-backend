/**
 * SEVEN BITS COFFEE - SAVED DELIVERY ADDRESSES
 * Location: /js/features/address-logic.js
 *
 * Customer-only (a guest has no persistent account to attach an address to).
 * The server is authoritative on ownership/limits - this is just the fetch
 * wrapper, same shape as table-sessions-logic.js.
 */
export const AddressSystem = {
    async list() {
        const res = await fetch("/api/addresses", { credentials: "include" });
        return res.ok ? res.json() : [];
    },

    async add({ label, addressText, landmark = "", city = "", state = "", pincode = "", lat, lng, isDefault = false }) {
        const res = await fetch("/api/addresses", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label, addressText, landmark, city, state, pincode, lat, lng, isDefault })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not save address");
        return data;
    },

    async update(id, patch) {
        const res = await fetch(`/api/addresses/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not update address");
        return data;
    },

    async remove(id) {
        const res = await fetch(`/api/addresses/${id}`, { method: "DELETE", credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not delete address");
        return data;
    }
};
