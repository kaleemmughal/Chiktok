/* ============================================================
   Dera Karahi — shared cart & config utilities
   Loaded on every page BEFORE page-specific scripts.
   ------------------------------------------------------------
   Important: the cart stored in localStorage contains ONLY
   { id, quantity } pairs. Prices are NEVER persisted client-side
   — they are always resolved from data/menu.json at render time.
   ============================================================ */

const CART_KEY = "dera-karahi-cart";
const ORDER_KEY = "dera-karahi-order";

const CONFIG = {
  restaurantName: "Dera Karahi",
  tagline: "Authentic Desi Karahi, Served Sizzling Hot",
  currencySymbol: "Rs",
  menuUrl: "data/menu.json",

  // Ordering rules (edit these freely)
  deliveryFee: 150,
  freeDeliveryThreshold: 1500,
  minOrder: 300,

  // Restaurant details (placeholder — update later)
  phone: "+92 300 1234567",
  email: "hello@derakarahi.pk",
  address: "Shop #12, G.T. Road, Rawalpindi",
  hours: "Mon–Sun · 12:00 PM – 12:00 AM",
  prepTime: "25–35 min",
  deliveryTime: "40–50 min",
};

/* ---------- Formatting ---------- */
function formatPrice(n) {
  return CONFIG.currencySymbol + " " + Number(n).toLocaleString("en-PK");
}

function imgUrl(url, w = 640) {
  if (!url) return "";
  if (url.includes("?")) return url;
  return `${url}?auto=format&fit=crop&w=${w}&q=80`;
}

/* ---------- Cart (id + quantity ONLY) ---------- */
function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const cart = raw ? JSON.parse(raw) : [];
    return Array.isArray(cart) ? cart : [];
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (e) {
    /* storage unavailable — fail silently */
  }
}

function getCartCount() {
  return getCart().reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
}

function getCartQuantity(id) {
  const entry = getCart().find((i) => String(i.id) === String(id));
  return entry ? Number(entry.quantity) || 0 : 0;
}

function addToCart(id, qty = 1) {
  setCartQuantity(id, getCartQuantity(id) + qty);
}

function setCartQuantity(id, qty) {
  let cart = getCart();
  if (qty <= 0) {
    cart = cart.filter((i) => String(i.id) !== String(id));
  } else {
    const existing = cart.find((i) => String(i.id) === String(id));
    if (existing) existing.quantity = qty;
    else cart.push({ id: String(id), quantity: qty });
  }
  saveCart(cart);
  updateCartBadge();
  return cart;
}

function clearCart() {
  try {
    localStorage.removeItem(CART_KEY);
  } catch (e) {}
  updateCartBadge();
}

/* ---------- Menu loading ---------- */
async function loadMenu() {
  const res = await fetch(CONFIG.menuUrl);
  if (!res.ok) throw new Error("Failed to load menu (HTTP " + res.status + ")");
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("Menu data is not an array");
  return data;
}

function getItemById(items, id) {
  return items.find((i) => String(i.id) === String(id));
}

/* ---------- Cart badge UI ---------- */
function updateCartBadge() {
  const count = getCartCount();
  document.querySelectorAll("[data-cart-badge]").forEach((el) => {
    el.textContent = count;
    el.classList.toggle("is-empty", count === 0);
    el.classList.remove("bump");
    void el.offsetWidth; // restart animation
    el.classList.add("bump");
  });
}
