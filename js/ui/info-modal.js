/**
 * SEVEN BITS COFFEE - INFO / CONFIRM MODAL
 * Location: /js/ui/info-modal.js
 */
export function renderInfoModal({ title, message, monospaceValue = null, confirmText = "OK", cancelText = null, onConfirm = null, onCancel = null }) {
    document.getElementById("info-modal-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "info-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "6000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 320px; font-family: 'Courier New', monospace;">
            <h2 class="modal-title-header">${title}</h2>
            <p style="font-size: 12px; color: var(--color-text-muted); white-space: pre-line;">${message}</p>
            ${
                monospaceValue
                    ? `<div style="background:var(--color-bg); border:1px solid var(--color-accent); color:var(--color-accent); padding:10px; font-size: 15px; text-align:center; letter-spacing: 1px; margin: 10px 0; user-select: all;">${monospaceValue}</div>`
                    : ""
            }
            <div style="display:grid; gap:10px; margin-top: 10px;">
                <button id="info-modal-ok" class="modal-btn-primary">${confirmText}</button>
                ${cancelText ? `<button id="info-modal-cancel" style="background:var(--color-border); color:var(--color-text); border:none; padding:10px; cursor:pointer; text-transform:uppercase;">${cancelText}</button>` : ""}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("info-modal-ok").addEventListener("click", () => {
        overlay.remove();
        if (onConfirm) onConfirm();
    });
    document.getElementById("info-modal-cancel")?.addEventListener("click", () => {
        overlay.remove();
        if (onCancel) onCancel();
    });
}
