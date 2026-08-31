/**
 * SEVEN BITS COFFEE - SETUP WIZARD
 * Location: /js/ui/setup-wizard-modal.js
 *
 * A guided first-run flow for a new shop: shop identity, tax/payment
 * settings, then a nudge into Menu Items (which already has its own full
 * add-item flow - no need to duplicate that here). Reachable anytime from
 * the Dashboard's "GETTING STARTED" button, not just on a fresh install -
 * detecting "is this actually a fresh install" reliably isn't possible
 * since the app ships with a full demo menu/branding already seeded, so
 * this is an always-available tool rather than a one-time forced gate.
 * Each step saves immediately on "Next" (via the same AdminConfig used
 * elsewhere) so closing the wizard partway through never loses progress.
 */
import { AdminConfig } from "../features/config-logic.js";
import { renderImagePickerModal } from "./image-picker-modal.js";

function escapeHtmlAttr(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const STEPS = ["Shop Identity", "Tax & Payments", "Menu", "Done"];

/**
 * @param {object} options
 * @param {(tabId: string) => void} options.onNavigate - switches the admin
 *   panel to another tab (used by the "Go to Menu Items" step)
 */
export function renderSetupWizardModal({ onNavigate }) {
    document.getElementById("setup-wizard-overlay")?.remove();
    let step = 0;

    const overlay = document.createElement("div");
    overlay.id = "setup-wizard-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "6500";
    document.body.appendChild(overlay);

    function stepperHtml() {
        return `
            <div style="display:flex; gap:6px; margin-bottom:20px;">
                ${STEPS.map(
                    (label, i) => `
                    <div style="flex:1; text-align:center;">
                        <div style="height:3px; background:${i <= step ? "var(--color-accent)" : "var(--color-border)"}; margin-bottom:6px;"></div>
                        <span style="font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:${i === step ? "var(--color-accent)" : "var(--color-text-muted)"};">${label}</span>
                    </div>
                `
                )
                    .join("")}
            </div>
        `;
    }

    function fieldStyle() {
        return "width:100%; box-sizing:border-box; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text); padding:10px; font-family:inherit; margin: 4px 0 12px;";
    }

    function render() {
        const c = AdminConfig.settings;
        let body = "";

        if (step === 0) {
            body = `
                <h3 style="margin-top:0;">Tell customers who you are</h3>
                <label for="sw-shop-name" style="font-size:10px; color:var(--color-text-muted);">SHOP NAME</label>
                <input id="sw-shop-name" type="text" value="${escapeHtmlAttr(c.shopName || "")}" style="${fieldStyle()}" />

                <label for="sw-logo" style="font-size:10px; color:var(--color-text-muted);">LOGO (shown in the top nav)</label>
                <div style="display:flex; gap:8px; margin:4px 0 12px;">
                    <input id="sw-logo" type="text" value="${escapeHtmlAttr(c.logoUrl || "")}" placeholder="https://... or pick from the bucket" style="${fieldStyle()} margin:0; flex:1;" />
                    <button type="button" id="sw-logo-pick" class="admin-btn-secondary">BROWSE</button>
                </div>

                <label for="sw-hero" style="font-size:10px; color:var(--color-text-muted);">HERO / STOREFRONT IMAGE (home page)</label>
                <div style="display:flex; gap:8px; margin:4px 0 12px;">
                    <input id="sw-hero" type="text" value="${escapeHtmlAttr(c.heroImageUrl || "")}" placeholder="https://... or pick from the bucket" style="${fieldStyle()} margin:0; flex:1;" />
                    <button type="button" id="sw-hero-pick" class="admin-btn-secondary">BROWSE</button>
                </div>
            `;
        } else if (step === 1) {
            body = `
                <h3 style="margin-top:0;">Tax, GST &amp; payments</h3>
                <p style="font-size:11px; color:var(--color-text-muted); margin-top:-6px;">Skip anything that doesn't apply - defaults are fine to start with and can be changed later from Admin &gt; Payments.</p>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label for="sw-cgst" style="font-size:10px; color:var(--color-text-muted);">CGST %</label>
                        <input id="sw-cgst" type="number" inputmode="decimal" min="0" step="0.01" value="${(c.cgstRate * 100).toFixed(2)}" style="${fieldStyle()}" />
                    </div>
                    <div>
                        <label for="sw-sgst" style="font-size:10px; color:var(--color-text-muted);">SGST %</label>
                        <input id="sw-sgst" type="number" inputmode="decimal" min="0" step="0.01" value="${(c.sgstRate * 100).toFixed(2)}" style="${fieldStyle()}" />
                    </div>
                </div>
                <label for="sw-gst-number" style="font-size:10px; color:var(--color-text-muted);">GST NUMBER (GSTIN, optional - printed on bills)</label>
                <input id="sw-gst-number" type="text" value="${escapeHtmlAttr(c.gstNumber || "")}" placeholder="22AAAAA0000A1Z5" autocomplete="off" spellcheck="false" style="${fieldStyle()}" />
                <label for="sw-upi" style="font-size:10px; color:var(--color-text-muted);">UPI ID (VPA, optional - for "Pay Online")</label>
                <input id="sw-upi" type="text" value="${escapeHtmlAttr(c.upiVpa || "")}" placeholder="yourshop@upi" autocomplete="off" spellcheck="false" style="${fieldStyle()}" />
            `;
        } else if (step === 2) {
            body = `
                <h3 style="margin-top:0;">Add your menu</h3>
                <p style="font-size:12px; color:var(--color-text-muted);">This app ships with a demo menu so there's something to click around - replace it with your own from the Menu Items tab. Add categories first (e.g. Coffee, Snacks), then items under each.</p>
                <button type="button" class="admin-btn-primary" id="sw-goto-menu" style="width:100%; margin-top:10px;">GO TO MENU ITEMS &rarr;</button>
            `;
        } else {
            body = `
                <h3 style="margin-top:0;">You're set up</h3>
                <p style="font-size:12px; color:var(--color-text-muted);">Shop identity and tax settings are saved. Come back to this wizard anytime from the Dashboard if you want to revisit them, or fine-tune everything else from the tabs on the left - Branding for colors/copy, Operations for tables/arcade, Payments for rates.</p>
            `;
        }

        overlay.innerHTML = `
            <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(480px, 92vw); max-height: 85vh; overflow-y: auto; box-sizing: border-box; font-family: 'Courier New', monospace;">
                <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">SETUP WIZARD</h2>
                ${stepperHtml()}
                <p id="sw-error" style="color:var(--color-danger); font-size: 11px; min-height: 12px; margin: 0 0 8px;"></p>
                ${body}
                <div style="display:flex; gap:10px; margin-top:20px;">
                    ${step > 0 ? `<button type="button" class="admin-btn-secondary" id="sw-back" style="flex:1;">BACK</button>` : ""}
                    ${
                        step < STEPS.length - 1
                            ? `<button type="button" class="admin-btn-primary" id="sw-next" style="flex:2;">${step === 2 ? "SKIP FOR NOW" : "SAVE &amp; CONTINUE"}</button>`
                            : `<button type="button" class="admin-btn-primary" id="sw-close" style="flex:2;">CLOSE</button>`
                    }
                </div>
            </div>
        `;

        wire();
    }

    async function saveStep() {
        const errorEl = document.getElementById("sw-error");
        errorEl.textContent = "";
        if (step === 0) {
            await AdminConfig.saveSettings({
                shopName: document.getElementById("sw-shop-name").value,
                logoUrl: document.getElementById("sw-logo").value.trim(),
                heroImageUrl: document.getElementById("sw-hero").value.trim()
            });
        } else if (step === 1) {
            const cgst = parseFloat(document.getElementById("sw-cgst").value) / 100;
            const sgst = parseFloat(document.getElementById("sw-sgst").value) / 100;
            if (!Number.isFinite(cgst) || !Number.isFinite(sgst) || cgst < 0 || sgst < 0) {
                errorEl.textContent = "CGST/SGST must be positive numbers.";
                return false;
            }
            await AdminConfig.saveSettings({
                cgstRate: cgst,
                sgstRate: sgst,
                gstNumber: document.getElementById("sw-gst-number").value,
                upiVpa: document.getElementById("sw-upi").value.trim()
            });
        }
        if (window.applyBranding) window.applyBranding(AdminConfig.settings);
        return true;
    }

    function wire() {
        document.getElementById("sw-back")?.addEventListener("click", () => {
            step--;
            render();
        });
        document.getElementById("sw-next")?.addEventListener("click", async () => {
            const ok = await saveStep();
            if (ok === false) return;
            step++;
            render();
        });
        document.getElementById("sw-close")?.addEventListener("click", () => overlay.remove());
        document.getElementById("sw-goto-menu")?.addEventListener("click", () => {
            overlay.remove();
            onNavigate("menu");
        });
        document.getElementById("sw-logo-pick")?.addEventListener("click", () => {
            renderImagePickerModal({ onSelect: (url) => (document.getElementById("sw-logo").value = url) });
        });
        document.getElementById("sw-hero-pick")?.addEventListener("click", () => {
            renderImagePickerModal({ onSelect: (url) => (document.getElementById("sw-hero").value = url) });
        });
    }

    render();
}
