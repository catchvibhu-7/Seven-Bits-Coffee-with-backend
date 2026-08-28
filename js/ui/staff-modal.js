/**
 * SEVEN BITS COFFEE - ADD / EDIT STAFF MODALS
 * Location: /js/ui/staff-modal.js
 */
import { AuthSystem } from "../features/auth-logic.js";
import { PayrollSystem } from "../features/payroll-logic.js";
import { renderPasswordStrengthMeter } from "../features/password-strength.js";
import { currencySymbol } from "../features/config-logic.js";

function randomTempPassword() {
    const part = () => Math.random().toString(36).slice(2, 6);
    return `${part()}-${part()}A9`;
}

function rolesCreatableBy(currentRole) {
    if (currentRole === "owner") return ["employee", "manager", "admin", "owner"];
    if (currentRole === "admin") return ["employee", "manager"];
    return ["employee"]; // manager
}

const fieldStyle = "width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;";

/**
 * @param {"owner"|"admin"|"manager"} currentRole
 * @param {() => void} onCreated
 */
export async function renderAddStaffModal(currentRole, onCreated) {
    document.getElementById("staff-modal-overlay")?.remove();

    const roleOptions = rolesCreatableBy(currentRole);
    const stores = currentRole === "manager" ? [] : await PayrollSystem.fetchStores();
    let usernameCheckTimer;

    const overlay = document.createElement("div");
    overlay.id = "staff-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 360px; font-family: 'Courier New', monospace; max-height: 85vh; overflow-y: auto;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">ADD STAFF ACCOUNT</h2>
            <p id="staff-modal-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 10px;"></p>

            <label style="font-size: 7pt; color: var(--color-text-muted);">NAME</label>
            <input id="sm-name" type="text" maxlength="60" placeholder="Full name" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">ROLE</label>
            <select id="sm-role" style="${fieldStyle}">
                ${roleOptions.map((r) => `<option value="${r}">${r.toUpperCase()}</option>`).join("")}
            </select>

            ${
                stores.length > 1
                    ? `
            <label style="font-size: 7pt; color: var(--color-text-muted);">STORE</label>
            <select id="sm-store" style="${fieldStyle}">
                ${stores.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}
            </select>`
                    : ""
            }

            <label style="font-size: 7pt; color: var(--color-text-muted);">RESPONSIBILITY / TAG (optional - e.g. Barista, Cashier)</label>
            <input id="sm-tag" type="text" maxlength="40" placeholder="e.g. Barista" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">PAY RATE (optional)</label>
            <div style="display:flex; gap:8px; margin: 4px 0 10px;">
                <select id="sm-pay-type" style="flex:1; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit;">
                    <option value="">No pay tracking</option>
                    <option value="hourly">Hourly</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                </select>
                <input id="sm-pay-rate" type="number" min="0" step="0.01" placeholder="${currencySymbol()} amount" style="flex:1; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit;" disabled />
            </div>

            <label style="font-size: 7pt; color: var(--color-text-muted);">USERNAME</label>
            <input id="sm-username" type="text" maxlength="30" placeholder="Login username" style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 2px;" />
            <div id="sm-username-status" style="font-size: 7pt; min-height: 11px; margin-bottom: 8px;"></div>

            <label style="font-size: 7pt; color: var(--color-text-muted);">TEMPORARY PASSWORD</label>
            <div style="display:flex; gap:6px; margin: 4px 0 2px;">
                <input id="sm-password" type="text" maxlength="60" placeholder="Temporary password" style="flex:1; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit;" />
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
    const payTypeField = document.getElementById("sm-pay-type");
    const payRateField = document.getElementById("sm-pay-rate");

    payTypeField.addEventListener("change", () => {
        payRateField.disabled = !payTypeField.value;
        if (!payTypeField.value) payRateField.value = "";
    });

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
        const tag = document.getElementById("sm-tag").value.trim();
        const payRateType = payTypeField.value || null;
        const payRate = payRateType ? Number(payRateField.value) : null;
        const storeId = document.getElementById("sm-store")?.value;

        if (!name) return (errorEl.textContent = "Enter a name.");
        if (username.length < 3) return (errorEl.textContent = "Username must be at least 3 characters.");
        if (payRateType && !(payRate >= 0)) return (errorEl.textContent = "Enter a valid pay rate.");

        const res = await fetch("/api/users", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, username, password, role, tag, payRateType, payRate, storeId: storeId ? Number(storeId) : undefined })
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

/**
 * Edit an existing staff member's tag and pay rate (role and password have
 * their own dedicated, more tightly-guarded flows, so they're not editable
 * here).
 */
export function renderEditStaffModal(user, onSaved) {
    document.getElementById("staff-modal-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "staff-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 340px; font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">EDIT ${user.name}</h2>
            <p id="esm-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 10px;"></p>

            <label style="font-size: 7pt; color: var(--color-text-muted);">RESPONSIBILITY / TAG</label>
            <input id="esm-tag" type="text" maxlength="40" value="${user.tag || ""}" placeholder="e.g. Barista" style="${fieldStyle}" />

            <label style="font-size: 7pt; color: var(--color-text-muted);">PAY RATE</label>
            <div style="display:flex; gap:8px; margin: 4px 0 10px;">
                <select id="esm-pay-type" style="flex:1; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit;">
                    <option value="" ${!user.payRateType ? "selected" : ""}>No pay tracking</option>
                    <option value="hourly" ${user.payRateType === "hourly" ? "selected" : ""}>Hourly</option>
                    <option value="weekly" ${user.payRateType === "weekly" ? "selected" : ""}>Weekly</option>
                    <option value="monthly" ${user.payRateType === "monthly" ? "selected" : ""}>Monthly</option>
                </select>
                <input id="esm-pay-rate" type="number" min="0" step="0.01" value="${user.payRate ?? ""}" placeholder="${currencySymbol()} amount" ${!user.payRateType ? "disabled" : ""}
                    style="flex:1; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit;" />
            </div>

            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="esm-save" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">SAVE CHANGES</button>
                <button id="esm-cancel" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const payTypeField = document.getElementById("esm-pay-type");
    const payRateField = document.getElementById("esm-pay-rate");
    payTypeField.addEventListener("change", () => {
        payRateField.disabled = !payTypeField.value;
        if (!payTypeField.value) payRateField.value = "";
    });

    document.getElementById("esm-cancel").addEventListener("click", () => overlay.remove());
    document.getElementById("esm-save").addEventListener("click", async () => {
        const errorEl = document.getElementById("esm-error");
        errorEl.textContent = "";
        const tag = document.getElementById("esm-tag").value.trim();
        const payRateType = payTypeField.value || null;
        const payRate = payRateType ? Number(payRateField.value) : null;
        if (payRateType && !(payRate >= 0)) return (errorEl.textContent = "Enter a valid pay rate.");

        const res = await fetch(`/api/users/${user.id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tag, payRateType, payRate })
        });
        const data = await res.json();
        if (!res.ok) {
            errorEl.textContent = data.error || "Could not save changes";
            return;
        }
        overlay.remove();
        onSaved(data);
    });
}
