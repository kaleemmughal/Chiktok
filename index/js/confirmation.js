/* ============================================================
   Dera Karahi — confirmation page logic (confirmation.html)
   ============================================================ */

document.addEventListener("DOMContentLoaded", init);

function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  updateCartBadge();

  const order = getOrder();
  const root = document.getElementById("confirmRoot");

  if (!order) {
    root.innerHTML = `
      <div class="empty-state">
        <span class="emoji">📄</span>
        <h1>No order found</h1>
        <p>Looks like you haven't placed an order yet.</p>
        <a href="index.html" class="btn btn-primary">Browse Menu</a>
      </div>`;
    return;
  }

  renderConfirmation(order);
  bindActions();
}

function getOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function renderConfirmation(order) {
  const root = document.getElementById("confirmRoot");
  const typeLabel = order.type === "delivery" ? "Delivery" : "Pickup";
  const typeEmoji = order.type === "delivery" ? "🛵" : "🏪";
  const placed = new Date(order.placedAt);

  const itemsHTML = (order.items || [])
    .map(
      (l) => `
      <li class="summary-item">
        <span class="name">${l.name} <span class="qty">× ${l.quantity}</span></span>
        <span class="total">${formatPrice(l.lineTotal)}</span>
      </li>`
    )
    .join("");

  const c = order.customer || {};
  const contactHTML = `
    <p><strong>${escapeHTML(c.name)}</strong> · ${escapeHTML(c.phone)}</p>
    ${order.type === "delivery" && c.address ? `<p>📍 ${escapeHTML(c.address)}</p>` : ""}
    ${c.notes ? `<p>📝 Note: ${escapeHTML(c.notes)}</p>` : ""}
  `;

  root.innerHTML = `
    <div class="confirm-card">
      <div class="confirm-icon">✓</div>
      <h1>Order Confirmed!</h1>
      <p class="confirm-sub">Thank you, <strong>${escapeHTML(order.customer.name)}</strong>. Your order is being prepared.</p>

      <div class="confirm-meta">
        <div><span>Order No.</span><strong>${escapeHTML(order.orderNo)}</strong></div>
        <div><span>Order Type</span><strong>${typeEmoji} ${typeLabel}</strong></div>
        <div><span>Estimated Time</span><strong>${escapeHTML(order.eta)}</strong></div>
      </div>

      <div class="confirm-details">
        <h2>Order Details</h2>
        <ul class="summary-list">${itemsHTML}</ul>
        <div class="summary-totals">
          <div><span>Subtotal</span><span>${formatPrice(order.subtotal)}</span></div>
          <div><span>Delivery fee</span><span>${order.deliveryFee === 0 ? "FREE" : formatPrice(order.deliveryFee)}</span></div>
          <div class="summary-total"><span>Total</span><span>${formatPrice(order.total)}</span></div>
        </div>
      </div>

      <div class="confirm-contact">${contactHTML}</div>

      <div class="confirm-actions">
        <a href="index.html" class="btn btn-primary">Back to Menu</a>
        <button class="btn btn-ghost" id="newOrder">Place Another Order</button>
      </div>
    </div>`;
}

function bindActions() {
  const btn = document.getElementById("newOrder");
  if (btn) {
    btn.addEventListener("click", () => {
      try {
        localStorage.removeItem(ORDER_KEY);
      } catch (e) {}
      window.location.href = "index.html";
    });
  }
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
