/**
 * SEVEN BITS COFFEE - ADD/EDIT MENU ITEM MODAL
 * Location: /js/ui/item-modal.js
 */
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
 * @param {(payload: object) => Promise<void>} options.onSave - called with {name, price, section, icon, story}
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
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">${isEdit ? "EDIT ITEM" : "ADD MENU ITEM"}</h2>
            <p id="item-modal-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 8px;"></p>

            <label style="font-size: 7pt; color: var(--color-text-muted);">NAME</label>
            <input id="im-name" type="text" value="${item ? item.name : ""}" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">PRICE (\u20b9)</label>
            <input id="im-price" type="number" min="1" step="1" value="${item ? item.price : ""}" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">SECTION</label>
            <select id="im-section" style="${fieldStyle}">
                ${sections.map((s) => `<option value="${s.id}" ${item && item.section === s.id ? "selected" : ""}>${s.title}</option>`).join("")}
            </select>

            <label style="font-size: 7pt; color: var(--color-text-muted);">ICON</label>
            <select id="im-icon" style="${fieldStyle}">
                ${iconOptions.map((o) => `<option value="${o.key}" ${item && item.icon === o.key ? "selected" : ""}>${o.label}</option>`).join("")}
            </select>
            <div id="im-icon-preview" style="display:flex; align-items:center; gap:8px; margin: -6px 0 12px; font-size:7pt; color:var(--color-text-muted);"></div>

            <label style="font-size: 7pt; color: var(--color-text-muted);">DESCRIPTION</label>
            <textarea id="im-story" rows="2" style="${fieldStyle} resize: vertical;">${item ? item.story || "" : ""}</textarea>

            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="im-save" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">${isEdit ? "SAVE CHANGES" : "ADD ITEM"}</button>
                <button id="im-cancel" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CANCEL</button>
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

    document.getElementById("im-cancel").addEventListener("click", () => overlay.remove());

    document.getElementById("im-save").addEventListener("click", async () => {
        const errorEl = document.getElementById("item-modal-error");
        errorEl.textContent = "";

        const name = document.getElementById("im-name").value.trim();
        const price = Number(document.getElementById("im-price").value);
        const section = document.getElementById("im-section").value;
        const icon = document.getElementById("im-icon").value;
        const story = document.getElementById("im-story").value.trim();

        if (!name) return (errorEl.textContent = "Name is required.");
        if (!Number.isFinite(price) || price <= 0) return (errorEl.textContent = "Enter a valid price.");

        try {
            await onSave({ name, price, section, icon, story });
            overlay.remove();
        } catch (e) {
            errorEl.textContent = e.message || "Could not save item";
        }
    });
}
