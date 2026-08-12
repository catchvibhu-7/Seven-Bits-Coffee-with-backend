/**
 * SEVEN BITS COFFEE - ADD STAFF MODAL
 * Location: /js/ui/staff-modal.js
 */
import { AuthSystem } from "../features/auth-logic.js";
import { renderPasswordStrengthMeter } from "../features/password-strength.js";

function randomTempPassword() {
    // Mirrors the shape of the server's own generateTempPassword() closely
    // enough to be readable and pass the strength rule; the server is the
    // one that actually issues reset passwords - this is only for the
    // "create new staff" form's convenience button.
    const part = () => Math.random().toString(36).slice(2, 6);
    return `${part()}-${part()}A9`;
}

/**
 * @param {"owner"|"admin"} currentRole - determines which roles show up in
 *   the dropdown (an admin can only grant "employee").
 * @param {() => void} onCreated - called after the account is created.
 */
export function renderAddStaffModal(currentRole, onCreated) {
    document.getElementById("staff-modal-overlay")?.remove();

    const roleOptions = currentRole === "owner" ? ["employee", "admin", "owner"] : ["employee"];
    let usernameCheckTimer;

    const overlay = document.createElement("div");
    overlay.id = "staff-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 340px; font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">ADD STAFF ACCOUNT</h2>
            <p id="staff-modal-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 10px;"></p>

            <label style="font-size: 7pt; color: var(--color-text-muted);">NAME</label>
            <input id="sm-name" type="text" placeholder="Full name" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">ROLE</label>
            <select id="sm-role" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;">
                ${roleOptions.map((r) => `<option value="${r}">${r.toUpperCase()}</option>`).join("")}
            </select>

            <label style="font-size: 7pt; color: var(--color-text-muted);">USERNAME</label>
            <input id="sm-username" type="text" placeholder="Login username" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 2px;" />
            <div id="sm-username-status" style="font-size: 7pt; min-height: 11px; margin-bottom: 8px;"></div>

            <label style="font-size: 7pt; color: var(--color-text-muted);">TEMPORARY PASSWORD</label>
            <div style="display:flex; gap:6px; margin: 4px 0 2px;">
                <input id="sm-password" type="text" placeholder="Temporary password" style="flex:1; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit;" />
                <button id="sm-generate" type="button" style="background:var(--color-border); color:var(--color-accent); border:1px solid var(--color-accent); padding:0 12px; cursor:pointer; font-size:8pt;">GENERATE</button>
            </div>
            <div id="sm-password-meter"></div>
            <p style="font-size: 7pt; color: var(--color-text-muted); margin: 4px 0 0;">They'll be required to set their own password the first time they log in.</p>

            <div style="display: grid; gap: 10px; margin-top: 18px;">
                <button id="sm-submit" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">CREATE ACCOUNT</button>
                <button id="sm-cancel" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const usernameField = document.getElementById("sm-username");
    const usernameStatus = document.getElementById("sm-username-status");
    const passwordField = document.getElementById("sm-password");
    const meterEl = document.getElementById("sm-password-meter");

    usernameField.addEventListener("input", () => {
        clearTimeout(usernameCheckTimer);
        const value = usernameField.value.trim();
        if (value.length < 3) {
            usernameStatus.textContent = "";
            return;
        }
        usernameStatus.textContent = "checking...";
        usernameStatus.style.color = "var(--color-text-muted)";
        usernameCheckTimer = setTimeout(async () => {
            const available = await AuthSystem.checkUsernameAvailable(value);
            if (available === null) {
                usernameStatus.textContent = "";
            } else if (available) {
                usernameStatus.textContent = "\u2713 available";
                usernameStatus.style.color = "var(--color-success)";
            } else {
                usernameStatus.textContent = "\u2717 already taken";
                usernameStatus.style.color = "var(--color-danger)";
            }
        }, 350);
    });

    passwordField.addEventListener("input", () => renderPasswordStrengthMeter(meterEl, passwordField.value));

    document.getElementById("sm-generate").addEventListener("click", () => {
        passwordField.value = randomTempPassword();
        renderPasswordStrengthMeter(meterEl, passwordField.value);
    });

    document.getElementById("sm-cancel").addEventListener("click", () => overlay.remove());

    document.getElementById("sm-submit").addEventListener("click", async () => {
        const errorEl = document.getElementById("staff-modal-error");
        errorEl.textContent = "";

        const name = document.getElementById("sm-name").value.trim();
        const role = document.getElementById("sm-role").value;
        const username = usernameField.value.trim();
        const password = passwordField.value;

        if (!name) return (errorEl.textContent = "Enter a name.");
        if (username.length < 3) return (errorEl.textContent = "Username must be at least 3 characters.");

        const res = await fetch("/api/users", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, username, password, role })
        });
        const data = await res.json();
        if (!res.ok) {
            errorEl.textContent = data.error || "Could not create account";
            return;
        }

        overlay.remove();
        onCreated(data);
    });
}
