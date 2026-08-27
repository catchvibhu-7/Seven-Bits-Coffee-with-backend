/**
 * SEVEN BITS COFFEE - MY ORDERS / REORDER
 * Location: /js/ui/my-orders-modal.js
 *
 * Lists a customer/guest's recent orders (from /api/orders/mine, already
 * scoped server-side to their own account/phone) with a one-tap "REORDER"
 * that hands the original items - including size/milk/extras/notes - back
 * to the caller to drop into the cart. Prices are never reused from the old
 * order: the cart re-adds by item id, so checkout always recomputes fresh
 * from the current menu/config.
 */
export function renderMyOrdersModal(orders, { onReorder }) {
    document.getElementById("my-orders-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "my-orders-overlay";
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "4500";

    const rows = orders.length
        ? orders
              .map(
                  (order) => `
            <div class="cart-row" style="border-bottom: 1px dashed var(--color-border); padding: 10px 0; font-size: 9pt;">
                <div style="display:flex; justify-content: space-between;">
                    <span>#${order.id} <span style="color:var(--color-text-muted); font-size:7pt;">${new Date(order.createdAt).toLocaleDateString()}</span></span>
                    <span style="font-weight:bold;">\u20b9${order.total.toFixed(2)}</span>
                </div>
                <div style="font-size:8pt; color:var(--color-text-muted); margin:4px 0;">${order.items.map((i) => `${i.quantity}x ${escapeHtml(i.name)}`).join(", ")}</div>
                <button class="mo-reorder-btn" data-order-id="${order.id}" style="background: var(--color-accent); color: var(--color-accent-contrast); border: none; padding: 6px 12px; font-size: 7pt; cursor: pointer; text-transform: uppercase; font-family: inherit;">REORDER</button>
            </div>
        `
              )
              .join("")
        : `<p style="font-size: 9pt; color: var(--color-text-muted); text-align:center; padding: 20px 0;">No past orders yet.</p>`;

    overlay.innerHTML = `
        <div class="modal-content" style="border: 2px solid var(--color-accent); background: var(--color-surface); color: var(--color-text); padding: 30px; width: min(400px, 92vw); font-family: 'Courier New', monospace; max-height: 85vh; overflow-y: auto;">
            <h2 style="letter-spacing: 2px; border-bottom: 1px solid var(--color-accent); padding-bottom: 10px; margin-top:0; font-size: 1rem;">MY ORDERS</h2>
            <div>${rows}</div>
            <button id="mo-close" style="margin-top: 15px; width: 100%; background: var(--color-border); color: var(--color-text); border: none; padding: 10px; cursor: pointer; text-transform: uppercase; font-family: inherit;">CLOSE</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById("mo-close").addEventListener("click", () => overlay.remove());
    overlay.querySelectorAll(".mo-reorder-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const order = orders.find((o) => o.id === btn.dataset.orderId);
            if (order) onReorder(order);
            overlay.remove();
        });
    });
}

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
