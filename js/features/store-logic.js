/**
 * SEVEN BITS COFFEE - CUSTOMER STORE SELECTION
 * Location: /js/features/store-logic.js
 *
 * A customer isn't tied to one physical location the way staff are - they
 * can walk into any store. So their chosen store is a per-VISIT client-side
 * preference (this device's localStorage), never written to their account
 * or session - picking a different store tomorrow, or on another device,
 * just means picking again.
 */
const STORAGE_KEY = "sb-selected-store-id";

export const StoreSystem = {
    stores: [],

    async loadStores() {
        const res = await fetch("/api/stores/public");
        this.stores = res.ok ? await res.json() : [];
        return this.stores;
    },

    /** Whether there's even a choice to make - a single-store deployment
     *  should never bother anyone with store-picker UI at all. */
    hasMultipleStores() {
        return this.stores.length > 1;
    },

    getSelectedStoreId() {
        const raw = localStorage.getItem(STORAGE_KEY);
        const id = raw ? Number(raw) : NaN;
        return Number.isFinite(id) ? id : null;
    },

    setSelectedStoreId(id) {
        if (id == null) {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, String(id));
        }
    },

    getSelectedStore() {
        const id = this.getSelectedStoreId();
        return id == null ? null : this.stores.find((s) => s.id === id) || null;
    }
};
