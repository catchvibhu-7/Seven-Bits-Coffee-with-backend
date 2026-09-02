/**
 * SEVEN BITS COFFEE - LOGIN / ACCOUNT MODAL
 * Location: /js/ui/login-modal.js
 */
import { AuthSystem } from "../features/auth-logic.js";
import { renderPasswordStrengthMeter } from "../features/password-strength.js";
import { t } from "../features/i18n-logic.js";

function fieldStyle(extra = "") {
    return `width: 100%; box-sizing: border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding: 10px; font-family: inherit; margin-bottom: 4px; ${extra}`;
}

/**
 * @param {(session: object) => void} onSuccess - called with the session
 *   info ({role, name, phone}) once login/guest/register succeeds.
 * @param {object} [options]
 * @param {string} [options.title] - heading text.
 * @param {boolean} [options.allowGuest] - show the "Continue as Guest" tab.
 * @param {boolean} [options.allowRegister] - show the "Create Account" tab.
 */
export function renderLoginModal(onSuccess, options = {}) {
    const { title = t("login.modalTitleDefault"), allowGuest = false, allowRegister = false } = options;
    document.getElementById("login-overlay")?.remove();

    let mode = "login"; // "login" | "guest" | "register" | "forgot"
    let usernameCheckTimer;

    const overlay = document.createElement("div");
    overlay.id = "login-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";
    document.body.appendChild(overlay);

    function render() {
        const tabs = [];
        tabs.push(`<button data-mode="login" class="login-tab ${mode === "login" ? "active" : ""}">${t("login.title")}</button>`);
        if (allowGuest) tabs.push(`<button data-mode="guest" class="login-tab ${mode === "guest" ? "active" : ""}">${t("login.guestTab")}</button>`);
        if (allowRegister) tabs.push(`<button data-mode="register" class="login-tab ${mode === "register" ? "active" : ""}">${t("login.signUpTab")}</button>`);

        let fields = "";
        if (mode === "login") {
            fields = `
                <input id="lf-username" type="text" placeholder="${t("login.usernamePlaceholder")}" aria-label="${t("login.usernamePlaceholder")}" autocomplete="username" style="${fieldStyle()}" />
                <input id="lf-password" type="password" placeholder="${t("login.passwordPlaceholder")}" aria-label="${t("login.passwordPlaceholder")}" autocomplete="current-password" style="${fieldStyle("margin-bottom:8px;")}" />
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                    <button id="lf-forgot-link" type="button" style="background:none; border:none; color:var(--color-text-muted); font-size:10px; text-decoration:underline; cursor:pointer; padding:0; font-family:inherit; white-space:nowrap;">${t("login.forgotPasswordLink")}</button>
                    <span id="login-error" style="color:var(--color-danger); font-size:10px; text-align:right;"></span>
                </div>
            `;
        } else if (mode === "guest") {
            fields = `
                <p style="font-size: 11px; color: var(--color-text-muted); margin-top:0;">${t("login.guestNote")}</p>
                <input id="lf-phone" type="tel" placeholder="${t("login.phonePlaceholder")}" aria-label="${t("login.phonePlaceholder")}" autocomplete="tel" style="${fieldStyle()}" />
                <p id="login-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 6px 0 0;"></p>
            `;
        } else if (mode === "register") {
            fields = `
                <input id="lf-name" type="text" placeholder="${t("login.namePlaceholder")}" aria-label="${t("login.namePlaceholder")}" style="${fieldStyle()}" />
                <input id="lf-phone" type="tel" placeholder="${t("login.phonePlaceholder")}" aria-label="${t("login.phonePlaceholder")}" autocomplete="tel" style="${fieldStyle()}" />
                <input id="lf-username" type="text" placeholder="${t("login.chooseUsernamePlaceholder")}" aria-label="${t("login.chooseUsernamePlaceholder")}" autocomplete="username" style="${fieldStyle()}" />
                <div id="lf-username-status" style="font-size: 10px; min-height: 11px; margin-bottom: 6px;"></div>
                <input id="lf-password" type="password" placeholder="${t("login.choosePasswordPlaceholder")}" aria-label="${t("login.choosePasswordPlaceholder")}" autocomplete="new-password" style="${fieldStyle()}" />
                <div id="lf-password-meter"></div>
                <p id="login-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 6px 0 0;"></p>
            `;
        } else if (mode === "forgot") {
            fields = `
                <p style="font-size: 11px; color: var(--color-text-muted); margin-top:0;">${t("login.forgotNote")}</p>
                <input id="lf-username" type="text" placeholder="${t("login.forgotUsernamePlaceholder")}" aria-label="${t("login.forgotUsernamePlaceholder")}" autocomplete="username" style="${fieldStyle()}" />
                <input id="lf-phone" type="tel" placeholder="${t("login.forgotPhonePlaceholder")}" aria-label="${t("login.forgotPhonePlaceholder")}" autocomplete="tel" style="${fieldStyle()}" />
                <input id="lf-password" type="password" placeholder="${t("login.newPasswordPlaceholder")}" aria-label="${t("login.newPasswordPlaceholder")}" autocomplete="new-password" style="${fieldStyle()}" />
                <div id="lf-password-meter"></div>
                <p style="font-size: 10px; color: var(--color-text-muted); margin: 10px 0 0;">${t("login.staffResetNote")}</p>
                <p id="login-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 6px 0 0;"></p>
                <p id="login-success" style="color:var(--color-success); font-size: 11px; min-height: 12px; margin: 0;"></p>
            `;
        }

        overlay.innerHTML = `
            <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 320px; font-family: 'Courier New', monospace;">
                <h2 class="modal-title-header">
                    ${mode === "forgot" ? t("login.resetPasswordTitle") : title}
                </h2>

                ${
                    tabs.length > 1 && mode !== "forgot"
                        ? `<div id="login-tabs" style="display:flex; gap:6px; margin-bottom:15px;">${tabs.join("")}</div>`
                        : ""
                }

                <div id="login-fields">${fields}</div>

                <div style="display: grid; gap: 10px;">
                    <button id="login-submit" class="modal-btn-primary">
                        ${mode === "login" ? t("login.submitLogin") : mode === "guest" ? t("login.submitGuest") : mode === "forgot" ? t("login.submitForgot") : t("login.submitRegister")}
                    </button>
                    <button id="login-cancel" class="modal-btn-secondary">
                        ${mode === "forgot" ? t("common.backToLogin") : t("common.cancel")}
                    </button>
                </div>
            </div>
        `;

        overlay.querySelectorAll(".login-tab").forEach((btn) => {
            btn.style.cssText = `flex:1; padding:8px; font-family:inherit; font-size:11px; cursor:pointer; border:1px solid var(--color-accent); background:${btn.classList.contains("active") ? "var(--color-accent)" : "transparent"}; color:${btn.classList.contains("active") ? "var(--color-accent-contrast)" : "var(--color-accent)"};`;
            btn.addEventListener("click", () => {
                mode = btn.dataset.mode;
                render();
            });
        });

        document.getElementById("login-cancel").addEventListener("click", () => {
            if (mode === "forgot") {
                mode = "login";
                render();
            } else {
                overlay.remove();
            }
        });
        document.getElementById("login-submit").addEventListener("click", submit);
        document.getElementById("lf-forgot-link")?.addEventListener("click", () => {
            mode = "forgot";
            render();
        });

        overlay.querySelectorAll("input").forEach((input) => {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") submit();
            });
        });

        // Live password strength meter (register + forgot modes)
        const pwField = document.getElementById("lf-password");
        const meterEl = document.getElementById("lf-password-meter");
        if (pwField && meterEl) {
            pwField.addEventListener("input", () => renderPasswordStrengthMeter(meterEl, pwField.value));
        }

        // Live username availability check (register mode only)
        const userField = document.getElementById("lf-username");
        const statusEl = document.getElementById("lf-username-status");
        if (mode === "register" && userField && statusEl) {
            userField.addEventListener("input", () => {
                clearTimeout(usernameCheckTimer);
                const value = userField.value.trim();
                if (value.length < 3) {
                    statusEl.textContent = "";
                    return;
                }
                statusEl.textContent = t("login.usernameChecking");
                statusEl.style.color = "var(--color-text-muted)";
                usernameCheckTimer = setTimeout(async () => {
                    const available = await AuthSystem.checkUsernameAvailable(value);
                    if (available === null) {
                        statusEl.textContent = "";
                    } else if (available) {
                        statusEl.textContent = t("login.usernameAvailable");
                        statusEl.style.color = "var(--color-success)";
                    } else {
                        statusEl.textContent = t("login.usernameTaken");
                        statusEl.style.color = "var(--color-danger)";
                    }
                }, 350);
            });
        }

        overlay.querySelector("input")?.focus();
    }

    async function submit() {
        const errorEl = document.getElementById("login-error");
        const successEl = document.getElementById("login-success");
        if (errorEl) errorEl.textContent = "";
        if (successEl) successEl.textContent = "";
        try {
            if (mode === "login") {
                const username = document.getElementById("lf-username").value;
                const password = document.getElementById("lf-password").value;
                const session = await AuthSystem.login(username, password);
                overlay.remove();
                onSuccess(session);
            } else if (mode === "guest") {
                const phone = document.getElementById("lf-phone").value;
                const session = await AuthSystem.continueAsGuest(phone);
                overlay.remove();
                onSuccess(session);
            } else if (mode === "register") {
                const name = document.getElementById("lf-name").value;
                const phone = document.getElementById("lf-phone").value;
                const username = document.getElementById("lf-username").value;
                const password = document.getElementById("lf-password").value;
                const session = await AuthSystem.registerCustomer({ username, password, name, phone });
                overlay.remove();
                onSuccess(session);
            } else if (mode === "forgot") {
                const username = document.getElementById("lf-username").value;
                const phone = document.getElementById("lf-phone").value;
                const newPassword = document.getElementById("lf-password").value;
                await AuthSystem.forgotPassword({ username, phone, newPassword });
                successEl.textContent = t("login.passwordUpdated");
                setTimeout(() => {
                    mode = "login";
                    render();
                }, 1200);
            }
        } catch (e) {
            if (errorEl) errorEl.textContent = e.message || t("login.fallbackError");
        }
    }

    render();
}

/**
 * Shown right after a login where the server flagged mustChangePassword
 * (fresh staff accounts, or after an admin issues a temp password). No
 * "cancel" - the temp password only works once, so this has to be completed
 * before the person can do anything else. Logging out is the only way past it.
 */
export function renderForceChangePasswordModal(onSuccess, onLogout) {
    document.getElementById("login-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "login-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "5000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 320px; font-family: 'Courier New', monospace;">
            <h2 class="modal-title-header">${t("login.forceChange.title")}</h2>
            <p style="font-size: 11px; color: var(--color-text-muted); margin-top:0;">${t("login.forceChange.note")}</p>
            <p id="fcp-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 0 0 10px;"></p>
            <input id="fcp-current" type="password" placeholder="${t("login.forceChange.tempPasswordPlaceholder")}" aria-label="${t("login.forceChange.tempPasswordPlaceholder")}" autocomplete="current-password" style="${fieldStyle()}" />
            <input id="fcp-new" type="password" placeholder="${t("login.forceChange.newPasswordPlaceholder")}" aria-label="${t("login.forceChange.newPasswordPlaceholder")}" autocomplete="new-password" style="${fieldStyle()}" />
            <div id="fcp-meter"></div>
            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="fcp-submit" class="modal-btn-primary">${t("login.forceChange.submit")}</button>
                <button id="fcp-logout" class="modal-btn-secondary">${t("login.forceChange.logout")}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const newField = document.getElementById("fcp-new");
    const meterEl = document.getElementById("fcp-meter");
    newField.addEventListener("input", () => renderPasswordStrengthMeter(meterEl, newField.value));

    document.getElementById("fcp-logout").addEventListener("click", () => {
        overlay.remove();
        onLogout();
    });

    document.getElementById("fcp-submit").addEventListener("click", async () => {
        const errorEl = document.getElementById("fcp-error");
        errorEl.textContent = "";
        try {
            const current = document.getElementById("fcp-current").value;
            const next = newField.value;
            await AuthSystem.changePassword(current, next);
            overlay.remove();
            onSuccess();
        } catch (e) {
            errorEl.textContent = e.message || t("login.forceChange.fallbackError");
        }
    });

    document.getElementById("fcp-current").focus();
}
