/**
 * SEVEN BITS COFFEE - ADD/EDIT COUPON MODAL
 * Location: /js/ui/coupon-modal.js
 */

/**
 * @param {object} options
 * @param {object} [options.coupon] - existing coupon to edit, or omit to add new
 * @param {(payload: object) => Promise<void>} options.onSave - called with {code, type, value, maxUses, expiresAt, private}
 */
export function renderCouponModal({ coupon = null, onSave }) {
    document.getElementById("coupon-modal-overlay")?.remove();
    const isEdit = !!coupon;

    const overlay = document.createElement("div");
    overlay.id = "coupon-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";

    const fieldStyle = "width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 12px;";

    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 360px; font-family: 'Courier New', monospace; max-height: 85vh; overflow-y: auto;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">${isEdit ? "EDIT COUPON" : "ADD COUPON"}</h2>
            <p id="coupon-modal-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 8px;"></p>

            <label style="font-size: 7pt; color: var(--color-text-muted);">CODE</label>
            <input id="cm-code" type="text" value="${coupon ? coupon.code : ""}" style="${fieldStyle} text-transform:uppercase;" ${isEdit ? "disabled" : ""} />

            <label style="font-size: 7pt; color: var(--color-text-muted);">DISCOUNT TYPE</label>
            <select id="cm-type" style="${fieldStyle}">
                <option value="percent" ${coupon?.type === "percent" ? "selected" : ""}>% OFF</option>
                <option value="flat" ${coupon?.type === "flat" ? "selected" : ""}>₹ OFF (FLAT)</option>
            </select>

            <label style="font-size: 7pt; color: var(--color-text-muted);">VALUE</label>
            <input id="cm-value" type="number" min="0.01" step="0.01" value="${coupon ? coupon.value : ""}" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">MAX USES (blank = unlimited)</label>
            <input id="cm-max-uses" type="number" min="1" step="1" value="${coupon?.maxUses ?? ""}" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">EXPIRES (blank = never)</label>
            <input id="cm-expires" type="date" value="${coupon?.expiresAt ? coupon.expiresAt.slice(0, 10) : ""}" style="${fieldStyle}" />

            <div style="display:flex; align-items:center; gap:8px; margin: 4px 0 16px;">
                <input id="cm-private" type="checkbox" ${coupon?.private ? "checked" : ""} style="width:auto;" />
                <label for="cm-private" style="font-size: 8pt; margin:0;">PRIVATE (hidden from the public code list)</label>
            </div>

            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="cm-save" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">${isEdit ? "SAVE CHANGES" : "ADD COUPON"}</button>
                <button id="cm-cancel" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("cm-cancel").addEventListener("click", () => overlay.remove());

    document.getElementById("cm-save").addEventListener("click", async () => {
        const errorEl = document.getElementById("coupon-modal-error");
        errorEl.textContent = "";

        const code = document.getElementById("cm-code").value.trim();
        const type = document.getElementById("cm-type").value;
        const value = Number(document.getElementById("cm-value").value);
        const maxUsesRaw = document.getElementById("cm-max-uses").value.trim();
        const expiresRaw = document.getElementById("cm-expires").value;
        const isPrivate = document.getElementById("cm-private").checked;

        if (!code) return (errorEl.textContent = "Code is required.");
        if (!Number.isFinite(value) || value <= 0) return (errorEl.textContent = "Enter a valid value.");
        if (type === "percent" && value > 100) return (errorEl.textContent = "Percent discount can't exceed 100.");

        try {
            await onSave({
                code,
                type,
                value,
                maxUses: maxUsesRaw ? Number(maxUsesRaw) : null,
                expiresAt: expiresRaw || null,
                private: isPrivate
            });
            overlay.remove();
        } catch (e) {
            errorEl.textContent = e.message || "Could not save coupon";
        }
    });
}
