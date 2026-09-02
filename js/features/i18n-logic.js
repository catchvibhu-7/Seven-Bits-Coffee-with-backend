/**
 * SEVEN BITS COFFEE - CUSTOMER UI TRANSLATION (English/Hindi)
 * Location: /js/features/i18n-logic.js
 *
 * Mirrors store-logic.js's StoreSystem exactly: a localStorage-backed,
 * no-login, per-device preference - picking a language is a client-only
 * choice, never written to an account or session, same reasoning as the
 * store picker (see store-logic.js's own header comment).
 *
 * Scope: customer-facing UI chrome only (Home, Menu, Checkout, My Orders,
 * Account Settings, Login, My Addresses, Order Tracking). Kitchen/Billing/
 * Admin stay English. Menu item names/descriptions and admin-entered
 * branding text are DATA the admin typed, not UI chrome - never routed
 * through t(), always shown exactly as entered.
 */
const STORAGE_KEY = "sb-language";

let dict = {}; // flattened current-language strings, e.g. {"checkout.title": "..."}
let fallbackDict = {}; // flattened English, always loaded as the missing-key fallback

function flatten(obj, prefix = "", out = {}) {
    for (const k in obj) {
        const key = prefix ? `${prefix}.${k}` : k;
        typeof obj[k] === "object" ? flatten(obj[k], key, out) : (out[key] = obj[k]);
    }
    return out;
}

export const I18n = {
    getLanguage() {
        return localStorage.getItem(STORAGE_KEY) === "hi" ? "hi" : "en";
    },

    setLanguage(lang) {
        localStorage.setItem(STORAGE_KEY, lang === "hi" ? "hi" : "en");
    },

    /** Fetches and caches both dictionaries' flattened form - English is
     *  always loaded (it's the fallback for any key missing from Hindi),
     *  Hindi only when it's actually the active language. */
    async load() {
        const lang = this.getLanguage();
        const [en, active] = await Promise.all([
            fetch("/js/i18n/en.json").then((r) => r.json()),
            lang === "en" ? null : fetch("/js/i18n/hi.json").then((r) => r.json())
        ]);
        fallbackDict = flatten(en);
        dict = active ? flatten(active) : fallbackDict;
    }
};

/**
 * t("checkout.decreaseQtyAria", {name: "Latte"}) - looks up a dotted key in
 * the active language, falling back to English, then to the key itself
 * (visible-but-harmless in QA - an easy typo to spot, never a crash).
 * {{token}} placeholders let the translated string decide word order
 * (Hindi differs from English), rather than the caller concatenating.
 */
export function t(key, vars) {
    const raw = dict[key] ?? fallbackDict[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ""));
}
