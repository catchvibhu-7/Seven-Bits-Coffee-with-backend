/**
 * SEVEN BITS COFFEE - IMAGE UPLOADS (the "bucket")
 * Location: /js/features/uploads-logic.js
 *
 * Thin fetch wrapper around /api/uploads (server.js) - a plain on-disk store
 * for images used as menu item photos, the home page hero/storefront image,
 * or the nav logo. Staff-only (KITCHEN_ROLES); the server is authoritative
 * on that, this module doesn't duplicate the check.
 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

export const UploadsSystem = {
    async list() {
        const res = await fetch("/api/uploads", { credentials: "include" });
        return res.ok ? res.json() : [];
    },

    /** @param {File} file @returns {Promise<{id,url,filename,originalName,sizeBytes}>} */
    async upload(file) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
            throw new Error("Use a PNG, JPEG, GIF, WEBP, or SVG image.");
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            throw new Error("Image is too large (max 5MB).");
        }
        const dataBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Could not read that file"));
            reader.readAsDataURL(file);
        });
        const res = await fetch("/api/uploads", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mimeType: file.type, originalName: file.name, dataBase64 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not upload image");
        return data;
    },

    async remove(id) {
        const res = await fetch(`/api/uploads/${id}`, { method: "DELETE", credentials: "include" });
        if (!res.ok) throw new Error((await res.json()).error || "Could not delete image");
        return true;
    }
};
