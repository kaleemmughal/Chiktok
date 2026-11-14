/* ============================================================
   Dera Karahi — checkout page logic (checkout.html)
   ============================================================ */

document.addEventListener("DOMContentLoaded", init);

let menu = { categories: [], menu_items: [] };
let orderType = "delivery";
let lines = [];
let subtotal = 0;
let deliveryFee = 0;
let total = 0;
let isSubmitting = false;

const form = document.getElementById("checkoutForm");

async function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  updateCartBadge();

  if (getCartCount() === 0) {
    document.getElementById("checkoutRoot").innerHTML = `
      <div class="empty-state">
        <span class="emoji">🛒</span>
        <h1>Your cart is empty</h1>
        <p>Add some delicious karahi before checking out.</p>
        <a href="index.html" class="btn btn-primary">Browse Menu</a>
      </div>`;
    return;
  }

  try {
    menu = await loadMenu();
    computeTotals();
    renderSummary();
    bindOrderType();
    bindForm();
  } catch (err) {
    console.error(err);
    document.getElementById("checkoutRoot").innerHTML = `
      <div class="load-error">Could not load the menu. <a href="index.html">Go back to menu</a>.</div>`;
  }
}

/* ---------- Totals (prices always from Supabase) ---------- */
function computeTotals() {
  lines = getCart()
    .map((entry) => {
      const item = getItemById(menu, entry.id);
      if (!item) return null;
      const qty = Number(entry.quantity) || 0;
      return {
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: qty,
        lineTotal: item.price * qty,
      };
    })
    .filter(Boolean);

  subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

  if (orderType === "delivery") {
    deliveryFee =
      subtotal >= CONFIG.freeDeliveryThreshold || subtotal === 0
        ? 0
        : CONFIG.deliveryFee;
  } else {
    deliveryFee = 0;
  }

  total = subtotal + deliveryFee;
}

/* ---------- Render ---------- */
function renderSummary() {
  document.getElementById("summaryList").innerHTML = lines
    .map(
      (l) => `
      <li class="summary-item">
        <span class="name">${l.name} <span class="qty">× ${l.quantity}</span></span>
        <span class="total">${formatPrice(l.lineTotal)}</span>
      </li>`
    )
    .join("");

  document.getElementById("summarySubtotal").textContent = formatPrice(subtotal);
  document.getElementById("summaryFee").textContent =
    deliveryFee === 0 ? "FREE" : formatPrice(deliveryFee);
  document.getElementById("summaryTotal").textContent = formatPrice(total);
  document.getElementById("placeOrderTotal").textContent = formatPrice(total);
}

function bindOrderType() {
  document.querySelectorAll('input[name="orderType"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      orderType = radio.value;
      document.getElementById("addressField").style.display =
        orderType === "delivery" ? "" : "none";
      computeTotals();
      renderSummary();
      clearFieldError("address");
    });
  });
}

/* ---------- Form & validation ---------- */
function bindForm() {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    hideFormError();
    if (validate()) placeOrder();
  });

  form.addEventListener("input", hideFormError);
}

function validate() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address = document.getElementById("address").value.trim();
  let valid = true;

  if (!name) {
    setFieldError("name", "Please enter your name.");
    valid = false;
  } else if (name.length < 2) {
    setFieldError("name", "Please enter your full name (at least 2 characters).");
    valid = false;
  } else if (name.length > 100) {
    setFieldError("name", "Name must be 100 characters or fewer.");
    valid = false;
  } else {
    clearFieldError("name");
  }

  const digits = phone.replace(/\D/g, "");
  const phoneOk = /^(0?3\d{9}|92\d{10})$/.test(digits);
  if (!phone) {
    setFieldError("phone", "Please enter your phone number.");
    valid = false;
  } else if (!phoneOk) {
    setFieldError("phone", "Enter a valid Pakistani phone number (e.g. 03XX-XXXXXXX).");
    valid = false;
  } else {
    clearFieldError("phone");
  }

  if (orderType === "delivery" && !address) {
    setFieldError("address", "Please enter your delivery address.");
    valid = false;
  } else if (orderType === "delivery" && address.length < 5) {
    setFieldError("address", "Please enter your complete delivery address.");
    valid = false;
  } else {
    clearFieldError("address");
  }

  return valid;
}

function setFieldError(name, message) {
  const field = document.querySelector(`[data-field="${name}"]`);
  const error = document.querySelector(`[data-error="${name}"]`);
  if (field) field.classList.add("has-error");
  if (error) error.textContent = message;
}

function clearFieldError(name) {
  const field = document.querySelector(`[data-field="${name}"]`);
  const error = document.querySelector(`[data-error="${name}"]`);
  if (field) field.classList.remove("has-error");
  if (error) error.textContent = "";
}

/* ---------- Place order (POST /api/create-order) ---------- */
async function placeOrder() {
  if (isSubmitting) return;
  isSubmitting = true;

  const btn = document.getElementById("placeOrder");
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.textContent = "Placing order…";

  const payload = {
    customer_name: document.getElementById("name").value.trim(),
    phone: normalizePhone(document.getElementById("phone").value),
    order_type: orderType,
    address:
      orderType === "delivery"
        ? document.getElementById("address").value.trim()
        : "",
    notes: document.getElementById("notes").value.trim(),
    // Cart contains ids + quantities only; the server re-prices everything.
    items: lines.map((l) => ({ id: Number(l.id), qty: Number(l.quantity) })),
  };

  let redirecting = false;

  try {
    const res = await fetch("/api/create-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await readJson(res);

    if (!res.ok) {
      const message =
        data?.error ||
        `We couldn't place your order (server error ${res.status}). Please try again.`;
      showFormError(message);
      return;
    }

    const orderNumber = data?.order_number;
    const trackingToken = data?.tracking_token;

    if (!orderNumber || !trackingToken) {
      showFormError(
        "Your order was received, but we couldn't get a confirmation number. Please contact us before ordering again."
      );
      return;
    }

    // Success — clear the local cart/order snapshot before leaving the page.
    clearCart();
    try {
      localStorage.removeItem(ORDER_KEY);
    } catch (e) {
      /* storage unavailable — ignore */
    }

    redirecting = true;
    window.location.href =
      `confirmation.html?order=${encodeURIComponent(orderNumber)}` +
      `&token=${encodeURIComponent(trackingToken)}`;
  } catch (err) {
    console.error("Order submission failed:", err);
    showFormError(
      "Could not reach the order server. Please check your connection and try again."
    );
  } finally {
    if (!redirecting) {
      isSubmitting = false;
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.innerHTML = originalLabel;
    }
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

/* Normalise to a format the API accepts: 03XXXXXXXXX or +92XXXXXXXXXX */
function normalizePhone(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("92")) return "+" + digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits;
  if (digits.length === 10 && digits.startsWith("3")) return "0" + digits;
  return raw.replace(/\s+/g, "");
}

/* ---------- Form-level error banner ---------- */
function showFormError(message) {
  const el = document.getElementById("checkoutError");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function hideFormError() {
  const el = document.getElementById("checkoutError");
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}
