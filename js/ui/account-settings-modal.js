/**
 * SEVEN BITS COFFEE - ACCOUNT SETTINGS MODAL
 * Location: /js/ui/account-settings-modal.js
 */
import { AuthSystem } from "../features/auth-logic.js";
import { renderPasswordStrengthMeter } from "../features/password-strength.js";
import { StaffShell } from "./staff-shell.js";
import { t } from "../features/i18n-logic.js";

export function renderAccountSettingsModal(session) {
    document.getElementById("account-modal-overlay")?.remove();

    // The rail/top-bar layout switcher isn't staff-only (see staff-shell.js) -
    // any session that can open this modal already has StaffShell active
    // (updateStaffShellForSession() in app.js shows it for staff, customer,
    // and guest sessions alike), so session.role alone is only ever false
    // for the impossible case of a session-less visitor somehow reaching
    // this modal. It's ALSO meaningless below the 720px mobile breakpoint -
    // the hamburger drawer replaces both rail and top-bar entirely there
    // (see theme.css), so choosing between them has no visible effect and
    // the setting is just confusing clutter on a phone.
    const hasLayoutChoice = !!session.role && window.innerWidth > 720;
    const currentLayout = hasLayoutChoice ? StaffShell.layout : null;

    const overlay = document.createElement("div");
    overlay.id = "account-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 320px; font-family: 'Courier New', monospace;">
            <h2 class="modal-title-header">${t("account.title")}</h2>

            <div style="font-size: 12px; color: var(--color-text-muted); margin-bottom: 15px;">
                <div>${t("account.nameLabel")} <span style="color: var(--color-text);">${session.name || "\u2014"}</span></div>
                <div>${t("account.roleLabel")} <span style="color: var(--color-accent);">${(session.role || "").toUpperCase()}</span></div>
            </div>

            ${
                hasLayoutChoice
                    ? `
            <h3 style="font-size: 12px; letter-spacing: 1px; margin-bottom: 10px;">${t("account.siteLayout")}</h3>
            <div style="display:flex; gap:8px; margin-bottom: 18px;">
                <button type="button" id="am-layout-rail" style="flex:1; padding:10px; background:${currentLayout === "rail" ? "rgba(217,119,6,.12)" : "transparent"}; border:1px solid ${currentLayout === "rail" ? "var(--color-accent)" : "var(--color-border)"}; color:${currentLayout === "rail" ? "var(--color-accent)" : "var(--color-text)"}; font-family:inherit; font-size:11px; font-weight:bold; letter-spacing:.05em; text-transform:uppercase; cursor:pointer;">${t("account.layoutLeftPane")}</button>
                <button type="button" id="am-layout-topbar" style="flex:1; padding:10px; background:${currentLayout === "topbar" ? "rgba(217,119,6,.12)" : "transparent"}; border:1px solid ${currentLayout === "topbar" ? "var(--color-accent)" : "var(--color-border)"}; color:${currentLayout === "topbar" ? "var(--color-accent)" : "var(--color-text)"}; font-family:inherit; font-size:11px; font-weight:bold; letter-spacing:.05em; text-transform:uppercase; cursor:pointer;">${t("account.layoutTopBar")}</button>
            </div>
            `
                    : ""
            }

            <!-- Collapsed by default - the fields/meter/error-success
                 paragraphs used to always be visible, reserving dead space
                 in the modal even when nobody was changing anything. -->
            <button type="button" id="am-toggle-password" aria-expanded="false" aria-controls="am-password-fields" style="width:100%; text-align:left; background:none; border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; font-size:12px; letter-spacing:1px; cursor:pointer; text-transform:uppercase;">${t("account.changePasswordToggleClosed")}</button>
            <div id="am-password-fields" style="display:none; margin-top:12px;">
                <p id="account-modal-error" style="color:var(--color-danger); font-size: 11px; margin: 0 0 8px;"></p>
                <p id="account-modal-success" style="color:var(--color-success); font-size: 11px; margin: 0 0 8px;"></p>

                <input id="am-current" type="password" placeholder="${t("account.currentPasswordPlaceholder")}" aria-label="${t("account.currentPasswordAria")}" autocomplete="current-password"
                    style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin-bottom: 8px;" />
                <input id="am-new" type="password" placeholder="${t("account.newPasswordPlaceholder")}" aria-label="${t("account.newPasswordAria")}" autocomplete="new-password"
                    style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit;" />
                <div id="am-meter"></div>

                <button id="am-change-password" style="width:100%; background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase; margin-top:10px;">${t("account.updatePassword")}</button>
            </div>

            ${
                session.role === "customer"
                    ? `
            <button type="button" id="am-my-addresses" style="width:100%; text-align:left; background:none; border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; font-size:12px; letter-spacing:1px; cursor:pointer; text-transform:uppercase; margin-top:12px;">${t("account.myAddressesToggle")}</button>
            <button type="button" id="am-toggle-delete" aria-expanded="false" aria-controls="am-delete-fields" style="width:100%; text-align:left; background:none; border:1px solid var(--color-danger); color:var(--color-danger); padding:10px; font-family:inherit; font-size:12px; letter-spacing:1px; cursor:pointer; text-transform:uppercase; margin-top:12px;">${t("account.deleteAccountToggleClosed")}</button>
            <div id="am-delete-fields" style="display:none; margin-top:12px;">
                <p style="font-size:11px; color:var(--color-text-muted); margin:0 0 10px;">${t("account.deleteWarning")}</p>
                <p id="account-delete-error" style="color:var(--color-danger); font-size: 11px; margin: 0 0 8px;"></p>
                <input id="am-delete-password" type="password" placeholder="${t("account.confirmPasswordPlaceholder")}" aria-label="${t("account.confirmPasswordAria")}" autocomplete="current-password"
                    style="width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin-bottom: 8px;" />
                <button id="am-delete-confirm" style="width:100%; background: var(--color-danger); color: #fff; border: none; padding: 12px; font-weight: bold; cursor: pointer; text-transform: uppercase;">${t("account.deleteAccountButton")}</button>
            </div>
            `
                    : ""
            }

            <!-- Same solid full-width treatment as the BACK button on the
                 checkout modal's Transaction Summary screen (checkout-
                 modal.js) - reused for visual consistency instead of a
                 flimsy muted text link. -->
            <button id="am-close" class="btn-close" style="margin-top: 15px; width: 100%; background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">${t("common.close")}</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const newField = document.getElementById("am-new");
    const meterEl = document.getElementById("am-meter");
    newField.addEventListener("input", () => renderPasswordStrengthMeter(meterEl, newField.value));

    document.getElementById("am-close").addEventListener("click", () => overlay.remove());

    const toggleBtn = document.getElementById("am-toggle-password");
    const fieldsEl = document.getElementById("am-password-fields");
    toggleBtn.addEventListener("click", () => {
        const opening = fieldsEl.style.display === "none";
        fieldsEl.style.display = opening ? "block" : "none";
        toggleBtn.textContent = opening ? t("account.changePasswordToggleOpen") : t("account.changePasswordToggleClosed");
        toggleBtn.setAttribute("aria-expanded", String(opening));
    });

    if (hasLayoutChoice) {
        document.getElementById("am-layout-rail").addEventListener("click", () => {
            if (StaffShell.layout !== "rail") StaffShell.switchLayout();
            overlay.remove();
        });
        document.getElementById("am-layout-topbar").addEventListener("click", () => {
            if (StaffShell.layout !== "topbar") StaffShell.switchLayout();
            overlay.remove();
        });
    }

    if (session.role === "customer") {
        document.getElementById("am-my-addresses").addEventListener("click", async () => {
            const mod = await import("./address-modal.js");
            mod.renderAddressModal();
        });

        const deleteToggleBtn = document.getElementById("am-toggle-delete");
        const deleteFieldsEl = document.getElementById("am-delete-fields");
        deleteToggleBtn.addEventListener("click", () => {
            const opening = deleteFieldsEl.style.display === "none";
            deleteFieldsEl.style.display = opening ? "block" : "none";
            deleteToggleBtn.textContent = opening ? t("account.deleteAccountToggleOpen") : t("account.deleteAccountToggleClosed");
            deleteToggleBtn.setAttribute("aria-expanded", String(opening));
        });

        const deleteBtn = document.getElementById("am-delete-confirm");
        let armed = false;
        deleteBtn.addEventListener("click", async () => {
            const errorEl = document.getElementById("account-delete-error");
            errorEl.textContent = "";
            if (!armed) {
                armed = true;
                deleteBtn.textContent = t("account.deleteConfirmArm");
                return;
            }
            const password = document.getElementById("am-delete-password").value;
            if (!password) {
                errorEl.textContent = t("account.enterPasswordToConfirm");
                return;
            }
            try {
                await AuthSystem.deleteAccount(password);
                overlay.remove();
                if (window.location) window.location.reload();
            } catch (e) {
                errorEl.textContent = e.message || t("account.deleteFailedFallback");
                armed = false;
                deleteBtn.textContent = t("account.deleteAccountButton");
            }
        });
    }

    document.getElementById("am-change-password").addEventListener("click", async () => {
        const errorEl = document.getElementById("account-modal-error");
        const successEl = document.getElementById("account-modal-success");
        errorEl.textContent = "";
        successEl.textContent = "";
        try {
            const current = document.getElementById("am-current").value;
            const next = newField.value;
            await AuthSystem.changePassword(current, next);
            successEl.textContent = t("account.passwordUpdatedSuccess");
            document.getElementById("am-current").value = "";
            newField.value = "";
            meterEl.innerHTML = "";
        } catch (e) {
            errorEl.textContent = e.message || t("account.changePasswordFailedFallback");
        }
    });
}
