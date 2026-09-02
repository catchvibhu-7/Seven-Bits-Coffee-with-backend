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
// Separate key/concept from the customer one above: this is which ONE of
// their several accessible stores a multi-store STAFF account (owner,
// unrestricted/Global Admin, or a Local Admin whose storeAccess spans more
// than one store) is currently looking at on an operational page (Orders,
// Billing) - a manager/employee never has this choice, they're always
// pinned to their own single assigned store server-side regardless.
const STAFF_STORAGE_KEY = "sb-staff-selected-store-id";

export const StoreSystem = {
    stores: [],

    /** Whether this session even has more than one store to choose between
     *  for staff-facing operational pages - mirrors admin-portal.js's own
     *  isGlobalAdmin()/hasFranchiseView reasoning so "who gets a switcher"
     *  stays consistent with "who gets the Franchise Dashboard tab". */
    isMultiStoreStaff(session) {
        if (!session) return false;
        if (session.role === "owner") return true;
        if (session.role === "admin") return !session.storeAccess || session.storeAccess.length > 1;
        return false;
    },

    getStaffSelectedStoreId() {
        const raw = localStorage.getItem(STAFF_STORAGE_KEY);
        const id = raw ? Number(raw) : NaN;
        return Number.isFinite(id) ? id : null;
    },

    setStaffSelectedStoreId(id) {
        if (id == null) {
            localStorage.removeItem(STAFF_STORAGE_KEY);
        } else {
            localStorage.setItem(STAFF_STORAGE_KEY, String(id));
        }
    },

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
