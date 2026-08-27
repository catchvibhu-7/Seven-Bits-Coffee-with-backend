/**
 * SEVEN BITS COFFEE - ORDER CUSTOMIZATION
 * Location: /js/features/customization-logic.js
 *
 * Fetches the server-authoritative catalog of sizes/milks/extras (labels +
 * price deltas). The server recomputes real prices from these same keys
 * when an order is placed, so this is only used to render the picker and
 * show a live estimate - never trusted as the final price.
 */
export const CustomizationSystem = {
    options: null,

    async loadOptions() {
        if (this.options) return this.options;
        const res = await fetch("/api/customization-options");
        this.options = res.ok
            ? await res.json()
            : { sizeOptions: [], milkOptions: [], extraOptions: [], drinkSections: [], maxNotesLength: 140 };
        return this.options;
    },

    isDrinkItem(item) {
        return this.options ? this.options.drinkSections.includes(item.section) : false;
    },

    /** Builds a stable key identifying a specific customization so identical
     *  picks collapse into one cart line, and different picks stay separate. */
    lineKey(itemId, custom) {
        const extrasKey = (custom.extras || []).slice().sort().join(",");
        return `${itemId}::${custom.size || ""}::${custom.milk || ""}::${extrasKey}::${custom.notes || ""}`;
    },

    /** Client-side price estimate only - server recalculates authoritatively. */
    estimateUnitPrice(basePrice, custom) {
        const opts = this.options || { sizeOptions: [], milkOptions: [], extraOptions: [] };
        let total = basePrice;
        if (custom.size) {
            const s = opts.sizeOptions.find((o) => o.key === custom.size);
            if (s) total += s.priceDelta;
        }
        if (custom.milk) {
            const m = opts.milkOptions.find((o) => o.key === custom.milk);
            if (m) total += m.priceDelta;
        }
        (custom.extras || []).forEach((key) => {
            const e = opts.extraOptions.find((o) => o.key === key);
            if (e) total += e.priceDelta;
        });
        return total;
    },

    /** Short human-readable summary tags for a customized cart/order line. */
    describeLine(line) {
        const parts = [];
        if (line.sizeLabel && line.sizeLabel !== "Regular") parts.push(line.sizeLabel);
        if (line.milkLabel && line.milkLabel !== "Regular Milk") parts.push(line.milkLabel);
        (line.extras || []).forEach((e) => parts.push(`+${e.label}`));
        return parts;
    },

    /** Same set of customizations as describeLine(), but paired with each
     *  one's individual price contribution - for breakdown views (e.g. the
     *  checkout modal's expandable "CUSTOMIZED" line) where the customer
     *  can see exactly what each choice added, not just its name. */
    describeLineWithAmounts(line) {
        const parts = [];
        if (line.sizeLabel && line.sizeLabel !== "Regular") {
            parts.push({ label: line.sizeLabel, amount: line.sizePriceDelta || 0 });
        }
        if (line.milkLabel && line.milkLabel !== "Regular Milk") {
            parts.push({ label: line.milkLabel, amount: line.milkPriceDelta || 0 });
        }
        (line.extras || []).forEach((e) => parts.push({ label: e.label, amount: e.priceDelta || 0 }));
        return parts;
    }
};
