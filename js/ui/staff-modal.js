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

/** Mirrors allowedRolesToCreate() in server.js exactly - owner's only
 *  write action is creating a Global Admin (unrestricted admin); a Global
 *  Admin can create Local Admins too, plus managers/employees; a Local
 *  Admin (scoped storeAccess) or manager only managers/employees. */
function rolesCreatableBy(session) {
    if (session.role === "owner") return ["admin"];
    if (session.role === "admin") return session.storeAccess && session.storeAccess.length ? ["employee", "manager"] : ["employee", "manager", "admin"];
    return ["employee"]; // manager
}

const fieldStyle = "width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 10px;";

/**
 * @param {{role: "owner"|"admin"|"manager", storeAccess?: number[]|null}} session
 * @param {() => void} onCreated
 */
export async function renderAddStaffModal(session, onCreated) {
    document.getElementById("staff-modal-overlay")?.remove();

    const roleOptions = rolesCreatableBy(session);
    const stores = session.role === "manager" ? [] : await PayrollSystem.fetchStores();
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
            <div id="sm-store-field">
                <label style="font-size: 7pt; color: var(--color-text-muted);">STORE</label>
                <select id="sm-store" style="${fieldStyle}">
                    ${stores.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}
                </select>
            </div>`
                    : ""
            }

            ${
                roleOptions.includes("admin") && stores.length > 1
                    ? `
            <div id="sm-store-access-field" style="display:none;">
                <label style="font-size: 7pt; color: var(--color-text-muted);">STORE ACCESS (leave all unchecked = every store)</label>
                <div style="display:flex; flex-direction:column; gap:5px; margin: 4px 0 10px; padding:8px; border:1px solid var(--color-border);">
                    ${stores
                        .map(
                            (s) => `
                    <label style="display:flex; align-items:center; gap:6px; font-size:8pt; cursor:pointer;">
                        <input type="checkbox" class="sm-store-access-cb" value="${s.id}" /> ${s.name}
                    </label>`
                        )
                        .join("")}
                </div>
            </div>`
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

    // STORE (single, for employee/manager) and STORE ACCESS (multi, for
    // admin) are mutually exclusive - which one's relevant depends on the
    // role currently picked.
    const roleField = document.getElementById("sm-role");
    const storeField = document.getElementById("sm-store-field");
    const storeAccessField = document.getElementById("sm-store-access-field");
    const syncStoreFieldsToRole = () => {
        const role = roleField.value;
        if (storeField) storeField.style.display = ["employee", "manager"].includes(role) ? "" : "none";
        if (storeAccessField) storeAccessField.style.display = role === "admin" ? "" : "none";
    };
    roleField.addEventListener("change", syncStoreFieldsToRole);
    syncStoreFieldsToRole();

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
        const storeAccess =
            role === "admin" ? [...document.querySelectorAll(".sm-store-access-cb:checked")].map((cb) => Number(cb.value)) : undefined;

        if (!name) return (errorEl.textContent = "Enter a name.");
        if (username.length < 3) return (errorEl.textContent = "Username must be at least 3 characters.");
        if (payRateType && !(payRate >= 0)) return (errorEl.textContent = "Enter a valid pay rate.");

        const res = await fetch("/api/users", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name,
                username,
                password,
                role,
                tag,
                payRateType,
                payRate,
                storeId: storeId ? Number(storeId) : undefined,
                storeAccess
            })
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
 * Edit an existing staff member - tag, pay rate, role, which store they're
 * assigned to, an admin's store access, and active/deactivated (password
 * has its own, more tightly-guarded flow, so it's not editable here).
 * Role/store are only offered to an admin/owner editing someone role-below
 * them - a manager never gets them (matches canManageTarget()/allowedRolesToCreate()
 * server-side, which reject the request anyway if bypassed).
 */
export async function renderEditStaffModal(user, session, onSaved) {
    document.getElementById("staff-modal-overlay")?.remove();

    const canChangeRole = session.role !== "manager" && user.role !== "owner";
    const roleOptions = canChangeRole ? rolesCreatableBy(session).filter((r) => r !== "owner") : [];
    const stores = canChangeRole ? await PayrollSystem.fetchStores() : [];

    const overlay = document.createElement("div");
    overlay.id = "staff-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 340px; font-family: 'Courier New', monospace; max-height: 85vh; overflow-y: auto;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">EDIT ${user.name}</h2>
            <p id="esm-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 10px;"></p>

            ${
                canChangeRole && roleOptions.length > 1
                    ? `
            <label style="font-size: 7pt; color: var(--color-text-muted);">ROLE</label>
            <select id="esm-role" style="${fieldStyle}">
                ${roleOptions.map((r) => `<option value="${r}" ${r === user.role ? "selected" : ""}>${r.toUpperCase()}</option>`).join("")}
            </select>`
                    : ""
            }

            ${
                canChangeRole && stores.length > 1
                    ? `
            <div id="esm-store-field" style="display:none;">
                <label style="font-size: 7pt; color: var(--color-text-muted);">STORE</label>
                <select id="esm-store" style="${fieldStyle}">
                    ${stores.map((s) => `<option value="${s.id}" ${s.id === user.storeId ? "selected" : ""}>${s.name}</option>`).join("")}
                </select>
            </div>
            <div id="esm-store-access-field" style="display:none;">
                <label style="font-size: 7pt; color: var(--color-text-muted);">STORE ACCESS (leave all unchecked = every store)</label>
                <div style="display:flex; flex-direction:column; gap:5px; margin: 4px 0 10px; padding:8px; border:1px solid var(--color-border);">
                    ${stores
                        .map(
                            (s) => `
                    <label style="display:flex; align-items:center; gap:6px; font-size:8pt; cursor:pointer;">
                        <input type="checkbox" class="esm-store-access-cb" value="${s.id}" ${(user.storeAccess || []).includes(s.id) ? "checked" : ""} /> ${s.name}
                    </label>`
                        )
                        .join("")}
                </div>
            </div>`
                    : ""
            }

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

            <label style="display:flex; align-items:center; gap:6px; font-size:8pt; cursor:pointer; margin-bottom:10px;">
                <input type="checkbox" id="esm-disabled" ${user.disabled ? "checked" : ""} /> Account deactivated (can't log in)
            </label>

            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="esm-save" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">SAVE CHANGES</button>
                <button id="esm-cancel" style="background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CANCEL</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const roleField = document.getElementById("esm-role");
    const storeField = document.getElementById("esm-store-field");
    const storeAccessField = document.getElementById("esm-store-access-field");
    if (roleField) {
        const syncStoreFieldsToRole = () => {
            const role = roleField.value;
            if (storeField) storeField.style.display = ["employee", "manager"].includes(role) ? "" : "none";
            if (storeAccessField) storeAccessField.style.display = role === "admin" ? "" : "none";
        };
        roleField.addEventListener("change", syncStoreFieldsToRole);
        syncStoreFieldsToRole();
    } else if (storeField) {
        // No role dropdown (viewer can't change role), but the target's
        // CURRENT role still decides which of these two shows.
        storeField.style.display = ["employee", "manager"].includes(user.role) ? "" : "none";
        if (storeAccessField) storeAccessField.style.display = user.role === "admin" ? "" : "none";
    }

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
        const disabled = document.getElementById("esm-disabled").checked;
        // The role dropdown (if shown) decides which of storeId/storeAccess
        // applies below - if it's not shown, the target's role isn't
        // changing, so use whatever it already is.
        const newRole = roleField ? roleField.value : user.role;
        const storeId = document.getElementById("esm-store")?.value;
        const storeAccess =
            newRole === "admin" ? [...document.querySelectorAll(".esm-store-access-cb:checked")].map((cb) => Number(cb.value)) : undefined;

        try {
            // Role changes through its own dedicated, more tightly-guarded
            // route (see PATCH /api/users/:id/role) - applied first so the
            // rest of this save (storeId vs. storeAccess) reflects the NEW
            // role, not the one being replaced.
            if (roleField && newRole !== user.role) {
                await PayrollSystem.changeUserRole(user.id, newRole);
            }
            const res = await fetch(`/api/users/${user.id}`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tag,
                    payRateType,
                    payRate,
                    disabled,
                    storeId: storeId ? Number(storeId) : undefined,
                    storeAccess
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not save changes");
            overlay.remove();
            onSaved(data);
        } catch (e) {
            errorEl.textContent = e.message;
        }
    });
}
