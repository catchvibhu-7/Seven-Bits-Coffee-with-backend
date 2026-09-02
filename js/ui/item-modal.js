/**
 * SEVEN BITS COFFEE - ADD/EDIT MENU ITEM MODAL
 * Location: /js/ui/item-modal.js
 */
import { renderImagePickerModal } from "./image-picker-modal.js";
import { currencySymbol } from "../features/config-logic.js";

const BUILT_IN_ICONS = [
    "americano", "bagel", "cake", "cappuccino", "cheesecake", "cold-brew",
    "cookie", "croissant", "cupcake", "donut", "espresso", "hamburger",
    "hot", "ice-cream", "ice-latte", "iced", "macaron", "matcha",
    "matcha-drink", "matcha-tonic", "quiche", "sandwich", "tea", "toast", "wrap"
];

/**
 * @param {object} options
 * @param {Array} options.sections - [{id, title}]
 * @param {object} [options.customIcons] - {key: imageUrl} from Branding settings
 * @param {object} [options.item] - existing item to edit, or omit to add new
 * @param {(payload: object) => Promise<void>} options.onSave - called with {name, price, section, icon, story, promoDiscount, imageUrl, stockCount}
 */
export function renderItemModal({ sections, customIcons = {}, item = null, onSave }) {
    document.getElementById("item-modal-overlay")?.remove();
    const isEdit = !!item;

    const overlay = document.createElement("div");
    overlay.id = "item-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";

    const iconOptions = [
        ...BUILT_IN_ICONS.map((k) => ({ key: k, label: k.replace(/-/g, " ") })),
        ...Object.keys(customIcons).map((k) => ({ key: k, label: `${k.replace(/-/g, " ")} (custom)` }))
    ];

    const fieldStyle = "width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 12px;";

    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 360px; font-family: 'Courier New', monospace; max-height: 85vh; overflow-y: auto;">
            <h2 class="modal-title-header">${isEdit ? "EDIT ITEM" : "ADD MENU ITEM"}</h2>
            <p id="item-modal-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 0 0 8px;"></p>

            <label class="field-hint">NAME</label>
            <input id="im-name" type="text" maxlength="60" value="${item ? item.name : ""}" style="${fieldStyle}" />

            <label class="field-hint">PRICE (${currencySymbol()})</label>
            <input id="im-price" type="number" min="1" step="1" value="${item ? item.price : ""}" style="${fieldStyle}" />

            <label class="field-hint">SECTION</label>
            <select id="im-section" style="${fieldStyle}">
                ${sections.map((s) => `<option value="${s.id}" ${item && item.section === s.id ? "selected" : ""}>${s.title}</option>`).join("")}
            </select>

            <label class="field-hint">ICON</label>
            <select id="im-icon" style="${fieldStyle}">
                ${iconOptions.map((o) => `<option value="${o.key}" ${item && item.icon === o.key ? "selected" : ""}>${o.label}</option>`).join("")}
            </select>
            <div id="im-icon-preview" style="display:flex; align-items:center; gap:8px; margin: -6px 0 12px; font-size:10px; color:var(--color-text-muted);"></div>

            <label class="field-hint">PHOTO (optional - shown instead of the icon when set)</label>
            <div style="display:flex; gap:8px; margin: 4px 0 8px;">
                <input id="im-image-url" type="text" maxlength="500" placeholder="https://... or pick from the bucket" value="${item?.imageUrl || ""}" style="${fieldStyle} margin:0; flex:1;" />
                <button type="button" id="im-image-pick" class="admin-btn-secondary" style="white-space:nowrap;">BROWSE</button>
            </div>
            <div id="im-image-preview" style="margin: -2px 0 12px;"></div>

            <label class="field-hint">DESCRIPTION</label>
            <textarea id="im-story" rows="2" maxlength="240" style="${fieldStyle} resize: vertical;">${item ? item.story || "" : ""}</textarea>

            <label class="field-hint">PROMOTION</label>
            <select id="im-promo-type" style="${fieldStyle}">
                <option value="" ${!item?.promoDiscount ? "selected" : ""}>NO PROMOTION</option>
                <option value="percent" ${item?.promoDiscount?.type === "percent" ? "selected" : ""}>% OFF</option>
                <option value="flat" ${item?.promoDiscount?.type === "flat" ? "selected" : ""}>${currencySymbol()} OFF (FLAT)</option>
            </select>
            <input id="im-promo-value" type="number" min="0.01" step="0.01" placeholder="Discount value" value="${item?.promoDiscount?.value ?? ""}" style="${fieldStyle} ${item?.promoDiscount ? "" : "display:none;"}" />

            <label class="field-hint">STOCK COUNT (blank = unlimited, not tracked)</label>
            <input id="im-stock-count" type="number" min="0" step="1" placeholder="Unlimited" value="${item?.stockCount ?? ""}" style="${fieldStyle}" />

            <label class="field-hint">PREP TIME, MINS (used for the customer wait-time estimate - blank = default)</label>
            <input id="im-prep-time" type="number" min="0" max="60" step="1" placeholder="3" value="${item?.prepTimeMins ?? ""}" style="${fieldStyle}" />

            <label class="field-hint">DIET</label>
            <div style="display:flex; gap:8px; margin: 4px 0 12px;">
                <button type="button" id="im-diet-veg" data-veg="true" class="admin-btn${item && item.isVeg === false ? "" : " admin-btn-primary"}" style="flex:1;">&#x1F7E2; VEG</button>
                <button type="button" id="im-diet-nonveg" data-veg="false" class="admin-btn${item && item.isVeg === false ? " admin-btn-primary" : ""}" style="flex:1;">&#x1F534; NON-VEG</button>
            </div>

            <label class="field-hint">ALLERGENS (optional - shown as a badge on the item card only when set)</label>
            <input id="im-allergens" type="text" maxlength="120" placeholder="e.g. Contains nuts, dairy" value="${item?.allergens || ""}" style="${fieldStyle}" />

            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="im-save" class="modal-btn-primary">${isEdit ? "SAVE CHANGES" : "ADD ITEM"}</button>
                <button id="im-cancel" class="modal-btn-secondary">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    function updateIconPreview() {
        const key = document.getElementById("im-icon").value;
        const preview = document.getElementById("im-icon-preview");
        if (customIcons[key]) {
            preview.innerHTML = `<img src="${customIcons[key]}" style="width:20px; height:20px; object-fit:contain;" /> custom icon`;
        } else {
            preview.innerHTML = `<span class="icon icon-${key}" style="display:inline-block; width:20px; height:20px;"></span> built-in icon`;
        }
    }
    document.getElementById("im-icon").addEventListener("change", updateIconPreview);
    updateIconPreview();

    function updateImagePreview() {
        const url = document.getElementById("im-image-url").value.trim();
        const preview = document.getElementById("im-image-preview");
        preview.innerHTML = url ? `<img style="width:56px; height:56px; object-fit:cover; border-radius:6px; border:1px solid var(--color-border);" />` : "";
        const img = preview.querySelector("img");
        if (img) {
            img.addEventListener("error", () => (img.style.display = "none"));
            img.src = url;
        }
    }
    document.getElementById("im-image-url").addEventListener("input", updateImagePreview);
    updateImagePreview();

    document.getElementById("im-image-pick").addEventListener("click", () => {
        renderImagePickerModal({
            onSelect: (url) => {
                document.getElementById("im-image-url").value = url;
                updateImagePreview();
            }
        });
    });

    let isVeg = !(item && item.isVeg === false); // default veg, per the diet toggle's own initial styling above
    const vegBtn = document.getElementById("im-diet-veg");
    const nonVegBtn = document.getElementById("im-diet-nonveg");
    function paintDietToggle() {
        vegBtn.classList.toggle("admin-btn-primary", isVeg);
        nonVegBtn.classList.toggle("admin-btn-primary", !isVeg);
    }
    vegBtn.addEventListener("click", () => {
        isVeg = true;
        paintDietToggle();
    });
    nonVegBtn.addEventListener("click", () => {
        isVeg = false;
        paintDietToggle();
    });

    document.getElementById("im-promo-type").addEventListener("change", (e) => {
        document.getElementById("im-promo-value").style.display = e.target.value ? "" : "none";
    });

    document.getElementById("im-cancel").addEventListener("click", () => overlay.remove());

    document.getElementById("im-save").addEventListener("click", async () => {
        const errorEl = document.getElementById("item-modal-error");
        errorEl.textContent = "";

        const name = document.getElementById("im-name").value.trim();
        const price = Number(document.getElementById("im-price").value);
        const section = document.getElementById("im-section").value;
        const icon = document.getElementById("im-icon").value;
        const story = document.getElementById("im-story").value.trim();
        const imageUrl = document.getElementById("im-image-url").value.trim();
        const promoType = document.getElementById("im-promo-type").value;
        const promoValue = Number(document.getElementById("im-promo-value").value);
        const stockCountRaw = document.getElementById("im-stock-count").value.trim();
        const allergens = document.getElementById("im-allergens").value.trim();
        const prepTimeRaw = document.getElementById("im-prep-time").value.trim();

        if (!name) return (errorEl.textContent = "Name is required.");
        if (!Number.isFinite(price) || price <= 0) return (errorEl.textContent = "Enter a valid price.");
        if (promoType && (!Number.isFinite(promoValue) || promoValue <= 0)) return (errorEl.textContent = "Enter a valid promo value.");
        if (promoType === "percent" && promoValue > 100) return (errorEl.textContent = "Percent discount can't exceed 100.");
        if (stockCountRaw && (!Number.isInteger(Number(stockCountRaw)) || Number(stockCountRaw) < 0)) {
            return (errorEl.textContent = "Stock count must be zero or a positive whole number.");
        }
        if (prepTimeRaw && (!Number.isFinite(Number(prepTimeRaw)) || Number(prepTimeRaw) < 0 || Number(prepTimeRaw) > 60)) {
            return (errorEl.textContent = "Prep time must be between 0 and 60 minutes.");
        }

        const promoDiscount = promoType ? { type: promoType, value: promoValue } : null;
        const stockCount = stockCountRaw ? Number(stockCountRaw) : null;
        const prepTimeMins = prepTimeRaw ? Number(prepTimeRaw) : null;

        try {
            await onSave({ name, price, section, icon, story, promoDiscount, imageUrl: imageUrl || null, stockCount, isVeg, allergens: allergens || null, prepTimeMins });
            overlay.remove();
        } catch (e) {
            errorEl.textContent = e.message || "Could not save item";
        }
    });
}
