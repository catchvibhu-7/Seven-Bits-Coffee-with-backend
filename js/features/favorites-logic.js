/**
 * SEVEN BITS COFFEE - FAVORITES & REORDER
 * Location: /js/features/favorites-logic.js
 *
 * Favorites are scoped server-side to the signed-in customer's account, or
 * to a guest's current phone number (see server.js favoritesOwnerKey) - the
 * same privacy boundary as order history, never shared across people.
 */
export const FavoritesSystem = {
    ids: [],

    async load() {
        const res = await fetch("/api/favorites", { credentials: "include" });
        this.ids = res.ok ? await res.json() : [];
        return this.ids;
    },

    isFavorite(itemId) {
        return this.ids.includes(itemId);
    },

    async toggle(itemId) {
        const isFav = this.isFavorite(itemId);
        const res = await fetch(`/api/favorites/${itemId}`, {
            method: isFav ? "DELETE" : "POST",
            credentials: "include"
        });
        if (!res.ok) throw new Error("Could not update favorites");
        this.ids = isFav ? this.ids.filter((id) => id !== itemId) : [...this.ids, itemId];
        return !isFav;
    }
};
