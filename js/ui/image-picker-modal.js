/**
 * SEVEN BITS COFFEE - IMAGE PICKER MODAL
 * Location: /js/ui/image-picker-modal.js
 *
 * One shared "upload a new image or choose an existing one from the bucket"
 * dialog, reused everywhere an admin assigns an image: a menu item's photo
 * (item-modal.js), the home page hero/storefront image and the nav logo
 * (admin-portal.js Branding tab). Also doubles as the bucket's own cleanup
 * UI - every thumbnail has a delete button here, not just in one dedicated
 * "manage images" screen, since assigning and tidying up naturally happen
 * in the same place.
 */
import { UploadsSystem } from "../features/uploads-logic.js";

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * @param {object} options
 * @param {(url: string) => void} options.onSelect - called with the chosen/uploaded image's URL
 */
export function renderImagePickerModal({ onSelect }) {
    document.getElementById("image-picker-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "image-picker-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "6000";
    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 26px; width: min(640px, 92vw); max-height: 85vh; overflow-y: auto; box-sizing: border-box; font-family: 'Courier New', monospace;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">CHOOSE IMAGE</h2>
            <p id="ip-error" style="color:var(--color-danger); font-size: 8pt; min-height: 12px; margin: 0 0 8px;"></p>

            <label for="ip-file-input" class="admin-btn" style="display:inline-block; cursor:pointer; margin-bottom:16px;">[ UPLOAD NEW IMAGE ]</label>
            <input id="ip-file-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" style="display:none;" />
            <span id="ip-upload-status" style="font-size:8pt; color:var(--color-text-muted); margin-left:8px;"></span>

            <div style="font-size:9px; letter-spacing:.12em; color:var(--color-text-muted); text-transform:uppercase; margin: 12px 0 8px; border-left:3px solid var(--color-accent); padding-left:8px;">Bucket</div>
            <div id="ip-grid" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:10px; min-height:60px;">
                <p style="color:var(--color-text-muted); font-size:9pt; grid-column:1/-1;">Loading&hellip;</p>
            </div>

            <button id="ip-cancel" style="margin-top:20px; width: 100%; background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase;">CLOSE</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const errorEl = document.getElementById("ip-error");
    const gridEl = document.getElementById("ip-grid");
    const statusEl = document.getElementById("ip-upload-status");

    async function refreshGrid() {
        const uploads = await UploadsSystem.list();
        if (uploads.length === 0) {
            gridEl.innerHTML = `<p style="color:var(--color-text-muted); font-size:9pt; grid-column:1/-1;">Nothing uploaded yet - upload an image above.</p>`;
            return;
        }
        gridEl.innerHTML = uploads
            .map(
                (u) => `
            <div style="position:relative; border:1px solid var(--color-border); background:var(--color-bg);">
                <button type="button" class="ip-pick" data-url="${escapeHtml(u.url)}" title="${escapeHtml(u.originalName)}" style="display:block; width:100%; padding:0; border:none; background:none; cursor:pointer;">
                    <img src="${escapeHtml(u.url)}" style="width:100%; height:80px; object-fit:cover; display:block;" />
                </button>
                <button type="button" class="ip-delete" data-id="${escapeHtml(u.id)}" title="Delete" style="position:absolute; top:2px; right:2px; width:20px; height:20px; line-height:18px; padding:0; background:var(--color-danger); color:#000; border:none; cursor:pointer; font-weight:bold;">&times;</button>
            </div>
        `
            )
            .join("");

        gridEl.querySelectorAll(".ip-pick").forEach((btn) => {
            btn.addEventListener("click", () => {
                onSelect(btn.dataset.url);
                overlay.remove();
            });
        });
        gridEl.querySelectorAll(".ip-delete").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!confirm("Delete this image? Anything still pointing at it (a menu item photo, the hero image) will show a broken image instead.")) return;
                try {
                    await UploadsSystem.remove(btn.dataset.id);
                    await refreshGrid();
                } catch (err) {
                    errorEl.textContent = err.message;
                }
            });
        });
    }

    document.getElementById("ip-file-input").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        errorEl.textContent = "";
        statusEl.textContent = "Uploading…";
        try {
            await UploadsSystem.upload(file);
            statusEl.textContent = "";
            await refreshGrid();
        } catch (err) {
            statusEl.textContent = "";
            errorEl.textContent = err.message;
        } finally {
            e.target.value = "";
        }
    });

    document.getElementById("ip-cancel").addEventListener("click", () => overlay.remove());

    refreshGrid();
}
