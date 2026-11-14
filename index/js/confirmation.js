/* ============================================================
   Dera Karahi — confirmation page logic (confirmation.html)
   Reads the order number and tracking token from the URL:
     confirmation.html?order=1003&token=<tracking_token>
   ============================================================ */

document.addEventListener("DOMContentLoaded", init);

function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  updateCartBadge();

  const params = new URLSearchParams(window.location.search);
  const orderNumber = (params.get("order") || "").trim();
  const token = (params.get("token") || "").trim();
  const root = document.getElementById("confirmRoot");

  if (!orderNumber) {
    root.innerHTML = `
      <div class="empty-state">
        <span class="emoji">📄</span>
        <h1>No order found</h1>
        <p>We couldn't find an order to show. If you just placed one, please check your confirmation link.</p>
        <a href="index.html" class="btn btn-primary">Browse Menu</a>
      </div>`;
    return;
  }

  renderConfirmation({ orderNumber, token });
}

function renderConfirmation({ orderNumber, token }) {
  const root = document.getElementById("confirmRoot");
  const safeOrderNumber = escapeHTML(orderNumber);
  const trackHref = token
    ? `track.html?token=${encodeURIComponent(token)}`
    : "";
  const trackAction = trackHref
    ? `<a class="btn btn-primary" id="trackOrder" href="${trackHref}">Track Order</a>`
    : "";

  root.innerHTML = `
    <div class="confirm-card">
      <div class="confirm-icon">✓</div>
      <h1>Order #${safeOrderNumber} Received!</h1>
      <p class="confirm-sub">Thank you! Your order has been received and is being prepared.</p>

      <div class="confirm-meta">
        <div><span>Order No.</span><strong>#${safeOrderNumber}</strong></div>
        <div><span>Status</span><strong>Received</strong></div>
        <div><span>Payment</span><strong>On delivery</strong></div>
      </div>

      <div class="confirm-contact">
        <p>📞 We'll call you shortly to confirm your order.</p>
        <p>Questions? Call us at <strong>${escapeHTML(CONFIG.phone)}</strong>.</p>
      </div>

      <div class="confirm-actions">
        ${trackAction}
        <a href="index.html" class="btn btn-ghost">Back to Menu</a>
      </div>
    </div>`;
}
