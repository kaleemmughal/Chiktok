/* ============================================================
   Dera Karahi — shared cart & config utilities
   Loaded on every page BEFORE page-specific scripts.
   ------------------------------------------------------------
   Important: the cart stored in localStorage contains ONLY
   { id, quantity } pairs. Prices are NEVER persisted client-side
   — they are always resolved from Supabase at render time.
   ============================================================ */

const CART_KEY = "dera-karahi-cart";
const ORDER_KEY = "dera-karahi-order";

const CONFIG = {
  restaurantName: "Dera Karahi",
  tagline: "Authentic Desi Karahi, Served Sizzling Hot",
  currencySymbol: "Rs",
  supabaseUrl: "https://gwvzjazdwrkuzuijjzrb.supabase.co",
  supabaseKey: "sb_publishable_2CggYIxbMk87FfYKc2Xt5A_RdNTGjjZ",

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

/* ---------- Supabase Client ---------- */
const supabaseClient =
  typeof window !== "undefined" && window.supabase?.createClient
    ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey)
    : null;

if (typeof window !== "undefined") {
  window.supabaseClient = supabaseClient;
  // Also expose helper on window.supabase for browser console access
  if (window.supabase && supabaseClient) {
    if (!window.supabase.from) {
      window.supabase.from = (...args) => supabaseClient.from(...args);
    }
    if (!window.supabase.auth) {
      window.supabase.auth = supabaseClient.auth;
    }
  }
}

/* ---------- Formatting ---------- */
function formatPrice(n) {
  return CONFIG.currencySymbol + " " + Number(n).toLocaleString("en-PK");
}

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

/* ---------- Menu loading (via Supabase) ---------- */
async function loadMenu() {
  const client =
    supabaseClient ||
    (typeof window !== "undefined" && window.supabase?.createClient
      ? (window.supabaseClient = window.supabase.createClient(
          CONFIG.supabaseUrl,
          CONFIG.supabaseKey
        ))
      : null);

  if (!client) {
    throw new Error(
      "Supabase client is not initialized. Please ensure the Supabase CDN script is included."
    );
  }

  // Fetch categories (ordered by sort_order) and available menu items (ordered by id)
  const [categoriesRes, menuItemsRes] = await Promise.all([
    client
      .from("categories")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true }),
    client
      .from("menu_items")
      .select("id, category_id, name, description, price, image_url, is_available")
      .eq("is_available", true)
      .order("id", { ascending: true }),
  ]);

  if (categoriesRes.error) {
    console.error("Error fetching categories:", categoriesRes.error);
    throw categoriesRes.error;
  }

  if (menuItemsRes.error) {
    console.error("Error fetching menu items:", menuItemsRes.error);
    throw menuItemsRes.error;
  }

  return {
    categories: categoriesRes.data || [],
    menu_items: menuItemsRes.data || [],
  };
}

function getMenuItems(menu) {
  return Array.isArray(menu?.menu_items) ? menu.menu_items : [];
}

function getCategoryById(menu, id) {
  return (menu?.categories || []).find((c) => String(c.id) === String(id)) || null;
}

function getItemById(menu, id) {
  return getMenuItems(menu).find((i) => String(i.id) === String(id));
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
