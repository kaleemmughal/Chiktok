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
    if (validate()) placeOrder();
  });
}

function validate() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address = document.getElementById("address").value.trim();
  let valid = true;

  if (!name) {
    setFieldError("name", "Please enter your name.");
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

/* ---------- Place order (no backend yet) ---------- */
function placeOrder() {
  const btn = document.getElementById("placeOrder");
  btn.disabled = true;
  btn.textContent = "Placing order…";

  const order = {
    orderNo: genOrderNo(),
    placedAt: new Date().toISOString(),
    type: orderType,
    customer: {
      name: document.getElementById("name").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      address: orderType === "delivery" ? document.getElementById("address").value.trim() : "",
      notes: document.getElementById("notes").value.trim(),
    },
    items: lines,
    subtotal,
    deliveryFee,
    total,
    eta: orderType === "delivery" ? CONFIG.deliveryTime : CONFIG.prepTime,
  };

  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch (e) {
    /* ignore storage errors */
  }

  clearCart();

  // Brief delay to give visual feedback (will become a real API call later)
  setTimeout(() => {
    window.location.href = "confirmation.html";
  }, 600);
}

function genOrderNo() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    d.getFullYear().toString().slice(-2) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    Math.floor(1000 + Math.random() * 9000);
  return "DK-" + stamp;
}
