/**
 * SEVEN BITS COFFEE - LOGIN / ACCOUNT MODAL
 * Location: /js/ui/login-modal.js
 */
import { AuthSystem } from "../features/auth-logic.js";
import { renderPasswordStrengthMeter } from "../features/password-strength.js";

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
    const { title = "LOGIN REQUIRED", allowGuest = false, allowRegister = false } = options;
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
        tabs.push(`<button data-mode="login" class="login-tab ${mode === "login" ? "active" : ""}">LOGIN</button>`);
        if (allowGuest) tabs.push(`<button data-mode="guest" class="login-tab ${mode === "guest" ? "active" : ""}">GUEST</button>`);
        if (allowRegister) tabs.push(`<button data-mode="register" class="login-tab ${mode === "register" ? "active" : ""}">SIGN UP</button>`);

        let fields = "";
        if (mode === "login") {
            fields = `
                <input id="lf-username" type="text" placeholder="USERNAME OR PHONE" aria-label="Username or phone" autocomplete="username" style="${fieldStyle()}" />
                <input id="lf-password" type="password" placeholder="PASSWORD" aria-label="Password" autocomplete="current-password" style="${fieldStyle("margin-bottom:8px;")}" />
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                    <button id="lf-forgot-link" type="button" style="background:none; border:none; color:var(--color-text-muted); font-size:10px; text-decoration:underline; cursor:pointer; padding:0; font-family:inherit; white-space:nowrap;">Forgot password?</button>
                    <span id="login-error" style="color:var(--color-danger); font-size:10px; text-align:right;"></span>
                </div>
            `;
        } else if (mode === "guest") {
            fields = `
                <p style="font-size: 11px; color: var(--color-text-muted); margin-top:0;">No account needed - we'll use this number to show your order status. You'll only ever see orders placed under this number.</p>
                <input id="lf-phone" type="tel" placeholder="PHONE NUMBER" aria-label="Phone number" autocomplete="tel" style="${fieldStyle()}" />
                <p id="login-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 6px 0 0;"></p>
            `;
        } else if (mode === "register") {
            fields = `
                <input id="lf-name" type="text" placeholder="YOUR NAME" aria-label="Your name" style="${fieldStyle()}" />
                <input id="lf-phone" type="tel" placeholder="PHONE NUMBER" aria-label="Phone number" autocomplete="tel" style="${fieldStyle()}" />
                <input id="lf-username" type="text" placeholder="CHOOSE A USERNAME" aria-label="Choose a username" autocomplete="username" style="${fieldStyle()}" />
                <div id="lf-username-status" style="font-size: 10px; min-height: 11px; margin-bottom: 6px;"></div>
                <input id="lf-password" type="password" placeholder="CHOOSE A PASSWORD" aria-label="Choose a password" autocomplete="new-password" style="${fieldStyle()}" />
                <div id="lf-password-meter"></div>
                <p id="login-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 6px 0 0;"></p>
            `;
        } else if (mode === "forgot") {
            fields = `
                <p style="font-size: 11px; color: var(--color-text-muted); margin-top:0;">Enter the username and phone number on your account to set a new password.</p>
                <input id="lf-username" type="text" placeholder="USERNAME" aria-label="Username" autocomplete="username" style="${fieldStyle()}" />
                <input id="lf-phone" type="tel" placeholder="PHONE NUMBER ON YOUR ACCOUNT" aria-label="Phone number on your account" autocomplete="tel" style="${fieldStyle()}" />
                <input id="lf-password" type="password" placeholder="NEW PASSWORD" aria-label="New password" autocomplete="new-password" style="${fieldStyle()}" />
                <div id="lf-password-meter"></div>
                <p style="font-size: 10px; color: var(--color-text-muted); margin: 10px 0 0;">Staff account? Ask an owner or admin to reset it for you instead.</p>
                <p id="login-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 6px 0 0;"></p>
                <p id="login-success" style="color:var(--color-success); font-size: 11px; min-height: 12px; margin: 0;"></p>
            `;
        }

        overlay.innerHTML = `
            <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: 320px; font-family: 'Courier New', monospace;">
                <h2 class="modal-title-header">
                    ${mode === "forgot" ? "RESET PASSWORD" : title}
                </h2>

                ${
                    tabs.length > 1 && mode !== "forgot"
                        ? `<div id="login-tabs" style="display:flex; gap:6px; margin-bottom:15px;">${tabs.join("")}</div>`
                        : ""
                }

                <div id="login-fields">${fields}</div>

                <div style="display: grid; gap: 10px;">
                    <button id="login-submit" class="modal-btn-primary">
                        ${mode === "login" ? "LOGIN" : mode === "guest" ? "CONTINUE AS GUEST" : mode === "forgot" ? "SET NEW PASSWORD" : "CREATE ACCOUNT"}
                    </button>
                    <button id="login-cancel" class="modal-btn-secondary">
                        ${mode === "forgot" ? "BACK TO LOGIN" : "CANCEL"}
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
                statusEl.textContent = "checking...";
                statusEl.style.color = "var(--color-text-muted)";
                usernameCheckTimer = setTimeout(async () => {
                    const available = await AuthSystem.checkUsernameAvailable(value);
                    if (available === null) {
                        statusEl.textContent = "";
                    } else if (available) {
                        statusEl.textContent = "\u2713 available";
                        statusEl.style.color = "var(--color-success)";
                    } else {
                        statusEl.textContent = "\u2717 already taken";
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
                successEl.textContent = "Password updated - you can log in now.";
                setTimeout(() => {
                    mode = "login";
                    render();
                }, 1200);
            }
        } catch (e) {
            if (errorEl) errorEl.textContent = e.message || "Something went wrong";
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
            <h2 class="modal-title-header">SET A NEW PASSWORD</h2>
            <p style="font-size: 11px; color: var(--color-text-muted); margin-top:0;">You're using a temporary password. Set your own before continuing.</p>
            <p id="fcp-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 0 0 10px;"></p>
            <input id="fcp-current" type="password" placeholder="TEMPORARY PASSWORD" aria-label="Temporary password" autocomplete="current-password" style="${fieldStyle()}" />
            <input id="fcp-new" type="password" placeholder="NEW PASSWORD" aria-label="New password" autocomplete="new-password" style="${fieldStyle()}" />
            <div id="fcp-meter"></div>
            <div style="display: grid; gap: 10px; margin-top: 10px;">
                <button id="fcp-submit" class="modal-btn-primary">SET PASSWORD</button>
                <button id="fcp-logout" class="modal-btn-secondary">LOG OUT INSTEAD</button>
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
            errorEl.textContent = e.message || "Could not change password";
        }
    });

    document.getElementById("fcp-current").focus();
}
