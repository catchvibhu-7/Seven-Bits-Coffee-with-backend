/**
 * SEVEN BITS COFFEE - STAFF LOGIN MODAL
 * Location: /js/ui/login-modal.js
 */
import { SecuritySystem } from "../features/auth-logic.js";

export function renderLoginModal(onSuccess) {
    document.getElementById("login-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "login-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";

    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid #d97706; background: #111; color: #f9fafb; padding: 30px; width: 320px; font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid #d97706; padding-bottom: 10px; margin-top:0; font-size: 1rem;">STAFF ACCESS REQUIRED</h2>
            <p id="login-error" style="color:#f87171; font-size: 8pt; min-height: 12px; margin: 0 0 10px;"></p>
            <input id="login-password" type="password" placeholder="PASSWORD" autocomplete="current-password"
                style="width: 100%; box-sizing: border-box; background:#000; border:1px solid #333; color:#f9fafb; padding: 10px; font-family: inherit; margin-bottom: 15px;" />
            <div style="display: grid; gap: 10px;">
                <button id="login-submit" style="background: #d97706; color: black; border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">LOGIN</button>
                <button id="login-cancel" style="background: #333; color: white; border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = document.getElementById("login-password");
    const errorEl = document.getElementById("login-error");
    input.focus();

    async function attemptLogin() {
        errorEl.textContent = "";
        try {
            await SecuritySystem.login(input.value);
            overlay.remove();
            onSuccess();
        } catch (e) {
            errorEl.textContent = e.message || "Login failed";
            input.value = "";
            input.focus();
        }
    }

    document.getElementById("login-submit").addEventListener("click", attemptLogin);
    document.getElementById("login-cancel").addEventListener("click", () => overlay.remove());
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") attemptLogin();
    });
}
