/**
 * SEVEN BITS COFFEE - READ-ONLY SECTION + EDIT MODAL FRAMEWORK
 * Location: /js/ui/admin-section.js
 *
 * The franchise governance redesign turns every admin tab from "one big
 * editable form" into read-only Field: Value rows grouped into sections,
 * each with its own single EDIT button that opens a focused modal - so
 * who-can-edit-what is a per-section question, not a per-tab one. This
 * module is the one shared implementation of that pattern, used by every
 * admin-portal.js render function instead of each hand-rolling its own.
 *
 * A viewer with no edit access to a section never sees an EDIT button at
 * all (canEdit:false omits it outright) - the server independently
 * enforces the same access (see requireGlobalAdmin()/canManageStore() in
 * server.js), so this is a real UI affordance, not the only thing standing
 * between a viewer and an edit they shouldn't have.
 */

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Small (i) glyph carrying extra field context, read on hover/focus - see
 *  .field-tooltip in theme.css. Falls back to the native title= attribute
 *  too (existing precedent elsewhere in the admin panel), so the
 *  information is never lost even where the CSS popover can't render. */
export function tooltipHtml(text) {
    const escaped = escapeHtml(text);
    return `<span class="field-tooltip" tabindex="0" role="img" aria-label="${escaped}" title="${escaped}" data-tip="${escaped}">i</span>`;
}

/**
 * Renders one read-only section into `container` - an empty element the
 * caller reserves in its own page markup (e.g. `<div id="theme-section">`),
 * one per section on the page. Re-render-safe: calling it again (e.g.
 * after a save) just replaces this section's own markup.
 *
 * @param {HTMLElement} container
 * @param {{
 *   title: string,
 *   fields: { label: string, value: string, tooltip?: string }[],
 *   canEdit: boolean,
 *   onEdit?: () => void,
 *   emptyNote?: string
 * }} config
 */
export function renderReadOnlySection(container, { title, fields, canEdit, onEdit, emptyNote }) {
    if (!container) return;
    container.innerHTML = `
        <div class="readonly-section">
            <div class="readonly-section-header">
                <h3 style="margin:0;">${escapeHtml(title)}</h3>
                ${canEdit ? `<button type="button" class="admin-btn-secondary readonly-edit-btn">EDIT</button>` : ""}
            </div>
            ${
                fields.length
                    ? fields
                          .map(
                              (f) => `
                <div class="readonly-field-row">
                    <div class="readonly-field-label">${escapeHtml(f.label)}${f.tooltip ? tooltipHtml(f.tooltip) : ""}</div>
                    <div class="readonly-field-value">${f.value === "" || f.value == null ? '<span style="color:var(--color-text-muted);">-</span>' : escapeHtml(f.value)}</div>
                </div>`
                          )
                          .join("")
                    : `<p class="admin-help-text">${escapeHtml(emptyNote || "Nothing here yet.")}</p>`
            }
        </div>
    `;
    if (canEdit) {
        container.querySelector(".readonly-edit-btn")?.addEventListener("click", () => onEdit?.());
    }
}

function fieldControlHtml(f) {
    const tip = f.tooltip ? tooltipHtml(f.tooltip) : "";
    if (f.type === "checkbox") {
        return `
            <div class="control-group">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" id="${f.id}" ${f.value ? "checked" : ""} /> ${escapeHtml(f.label)}${tip}
                </label>
            </div>`;
    }
    if (f.type === "select") {
        return `
            <div class="control-group">
                <label for="${f.id}">${escapeHtml(f.label)}${tip}</label>
                <select id="${f.id}">
                    ${(f.options || []).map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(f.value) ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
                </select>
            </div>`;
    }
    if (f.type === "textarea") {
        return `
            <div class="control-group">
                <label for="${f.id}">${escapeHtml(f.label)}${tip}</label>
                <textarea id="${f.id}" maxlength="${f.maxlength || 500}" rows="${f.rows || 3}" placeholder="${escapeHtml(f.placeholder || "")}" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:7px 8px; font-family:inherit; font-size:12px;">${escapeHtml(f.value)}</textarea>
            </div>`;
    }
    if (f.type === "color") {
        return `
            <div class="control-group" style="display:flex; align-items:center; gap:8px;">
                <label for="${f.id}" style="margin:0;">${escapeHtml(f.label)}${tip}</label>
                <input type="color" id="${f.id}" value="${escapeHtml(f.value || "#000000")}" />
            </div>`;
    }
    // text / number / date / password
    return `
        <div class="control-group">
            <label for="${f.id}">${escapeHtml(f.label)}${tip}</label>
            <input
                type="${f.type || "text"}"
                id="${f.id}"
                value="${escapeHtml(f.value ?? "")}"
                placeholder="${escapeHtml(f.placeholder || "")}"
                ${f.maxlength ? `maxlength="${f.maxlength}"` : ""}
                ${f.min !== undefined ? `min="${f.min}"` : ""}
                ${f.max !== undefined ? `max="${f.max}"` : ""}
                ${f.step !== undefined ? `step="${f.step}"` : ""}
                ${f.type === "password" ? `autocomplete="new-password" spellcheck="false"` : ""}
            />
        </div>`;
}

/**
 * Generic "edit this section's fields" modal - the same overlay/
 * .modal-content/header/error-placeholder/save-cancel skeleton every other
 * modal in this app already uses (see staff-modal.js/info-modal.js), built
 * from a field-list description instead of hand-written markup each time.
 *
 * @param {{
 *   title: string,
 *   fields: Array<{
 *     id: string, label: string, value: any, tooltip?: string,
 *     type?: 'text'|'number'|'date'|'password'|'checkbox'|'color'|'select'|'textarea',
 *     options?: {value: string, label: string}[], placeholder?: string,
 *     maxlength?: number, min?: number, max?: number, step?: number
 *   }>,
 *   onSave: (values: Record<string, any>) => Promise<void>,
 *   width?: string
 * }} config
 */
export function renderSectionEditModal({ title, fields, onSave, width = "420px" }) {
    document.getElementById("section-edit-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "section-edit-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5500";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: ${width}; max-width: 92vw; font-family: 'Courier New', monospace; max-height: 85vh; overflow-y: auto;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">${escapeHtml(title)}</h2>
            <p id="section-edit-error" role="alert" aria-live="polite" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 0 0 10px;"></p>
            ${fields.map(fieldControlHtml).join("")}
            <div style="display: grid; gap: 10px; margin-top: 18px;">
                <button id="section-edit-save" class="admin-btn-primary">SAVE</button>
                <button id="section-edit-cancel" class="admin-btn-secondary">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("section-edit-cancel").addEventListener("click", () => overlay.remove());
    document.getElementById("section-edit-save").addEventListener("click", async () => {
        const errorEl = document.getElementById("section-edit-error");
        errorEl.textContent = "";
        const values = {};
        for (const f of fields) {
            const el = document.getElementById(f.id);
            values[f.id] = f.type === "checkbox" ? el.checked : el.value;
        }
        try {
            await onSave(values);
            overlay.remove();
        } catch (e) {
            errorEl.textContent = e.message;
        }
    });
}
