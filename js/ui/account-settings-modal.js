/**
 * SEVEN BITS COFFEE - ACCOUNT SETTINGS MODAL
 * Location: /js/ui/account-settings-modal.js
 */
import { AuthSystem } from "../features/auth-logic.js";
import { renderPasswordStrengthMeter } from "../features/password-strength.js";

export function renderAccountSettingsModal(session) {
    document.getElementById("account-modal-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "account-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 320px; font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">ACCOUNT SETTINGS</h2>

            <div style="font-size: 9pt; color: var(--color-text-muted); margin-bottom: 15px;">
                <div>NAME: <span style="color: var(--color-text);">${session.name || "\u2014"}</span></div>
                <div>ROLE: <span style="color: var(--color-accent);">${(session.role || "").toUpperCase()}</span></div>
            </div>

            <h3 style="font-size: 9pt; letter-spacing: 1px; margin-bottom: 10px;">CHANGE PASSWORD</h3>
            <p id="account-modal-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 10px;"></p>
            <p id="account-modal-success" style="color:var(--color-success); font-size: 8pt; min-height: 12px; margin: 0 0 10px;"></p>

            <input id="am-current" type="password" placeholder="CURRENT PASSWORD" autocomplete="current-password"
                style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin-bottom: 8px;" />
            <input id="am-new" type="password" placeholder="NEW PASSWORD" autocomplete="new-password"
                style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit;" />
            <div id="am-meter"></div>

            <div style="display: grid; gap: 10px; margin-top: 15px;">
                <button id="am-change-password" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">UPDATE PASSWORD</button>
                <button id="am-close" style="background: none; color: var(--color-text-muted); border: none; padding: 8px; cursor: pointer; text-transform: uppercase; font-size: 8pt;">CLOSE</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const newField = document.getElementById("am-new");
    const meterEl = document.getElementById("am-meter");
    newField.addEventListener("input", () => renderPasswordStrengthMeter(meterEl, newField.value));

    document.getElementById("am-close").addEventListener("click", () => overlay.remove());

    document.getElementById("am-change-password").addEventListener("click", async () => {
        const errorEl = document.getElementById("account-modal-error");
        const successEl = document.getElementById("account-modal-success");
        errorEl.textContent = "";
        successEl.textContent = "";
        try {
            const current = document.getElementById("am-current").value;
            const next = newField.value;
            await AuthSystem.changePassword(current, next);
            successEl.textContent = "Password updated.";
            document.getElementById("am-current").value = "";
            newField.value = "";
            meterEl.innerHTML = "";
        } catch (e) {
            errorEl.textContent = e.message || "Could not change password";
        }
    });
}
