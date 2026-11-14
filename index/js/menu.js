/* ============================================================
   Dera Karahi — menu page logic (index.html)
   ============================================================ */

document.addEventListener("DOMContentLoaded", init);

let menu = { categories: [], menu_items: [] };
let activeCategoryId = null;

const grid = document.getElementById("menuGrid");
const categoryTabs = document.getElementById("categories");

async function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  updateCartBadge();
  bindDrawerEvents();
  bindMenuEvents();

  try {
    menu = await loadMenu();
    renderCategories();
    renderMenu();
    renderCartDrawer();
  } catch (err) {
    console.error("Failed to load menu from Supabase:", err);
    const detail = err?.message || (typeof err === "string" ? err : "");
    grid.innerHTML = `
      <div class="load-error">
        <p><strong>Could not load the menu from Supabase.</strong></p>
        ${detail ? `<p style="margin-top:8px;font-size:0.88em;">Details: <code>${escapeHTML(detail)}</code></p>` : ""}
        <p style="margin-top:8px;font-size:0.82em;">If this is a permission error, run the RLS / SELECT grant query in your Supabase SQL Editor.</p>
      </div>`;
  }
}

/* ---------- Categories ---------- */
function renderCategories() {
  const categories = [
    { id: null, name: "All" },
    ...[...menu.categories].sort((a, b) => a.sort_order - b.sort_order),
  ];

  categoryTabs.innerHTML = categories
    .map((cat) => {
      const isActive = cat.id === activeCategoryId;
      return `<button class="cat-tab${isActive ? " active" : ""}" data-category-id="${cat.id ?? ""}" role="tab" aria-selected="${isActive}">${cat.name}</button>`;
    })
    .join("");
}

/* ---------- Menu rendering ---------- */
function renderMenu() {
  const items =
    activeCategoryId === null
      ? menu.menu_items
      : menu.menu_items.filter((i) => i.category_id === activeCategoryId);

  if (items.length === 0) {
    grid.innerHTML =
      '<div class="load-error">No items available in this category yet.</div>';
    return;
  }

  grid.innerHTML = items.map(cardHTML).join("");
}

function cardHTML(item) {
  const qty = getCartQuantity(item.id);
  const available = item.is_available !== false;
  const category = getCategoryById(menu, item.category_id);
  const actions = !available
    ? '<button class="btn-add" disabled>Sold Out</button>'
    : qty > 0
    ? stepperHTML(item.id, qty)
    : `<button class="btn-add" data-add="${item.id}">Add +</button>`;

  return `
    <article class="card${available ? "" : " card--soldout"}" data-id="${item.id}">
      <div class="card-media">
        <img src="${imgUrl(item.image_url)}" alt="${item.name}" loading="lazy"
             onerror="this.closest('.card-media').classList.add('no-img'); this.remove();" />
        <span class="card-badge">${category ? category.name : ""}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${item.name}</h3>
        <p class="card-desc">${item.description || ""}</p>
        <div class="card-foot">
          <span class="card-price">${formatPrice(item.price)}</span>
          <div class="card-actions" data-card-actions="${item.id}">${actions}</div>
        </div>
      </div>
    </article>`;
}

function stepperHTML(id, qty) {
  return `
    <div class="qty-stepper">
      <button class="qty-btn" data-dec="${id}" aria-label="Decrease quantity">−</button>
      <span class="qty-value">${qty}</span>
      <button class="qty-btn" data-inc="${id}" aria-label="Increase quantity">+</button>
    </div>`;
}

function refreshCardActions(id) {
  const container = document.querySelector(`[data-card-actions="${id}"]`);
  const item = getItemById(menu, id);
  if (!container || !item) return;
  const qty = getCartQuantity(id);
  container.innerHTML =
    qty > 0
      ? stepperHTML(id, qty)
      : `<button class="btn-add" data-add="${id}">Add +</button>`;
}

/* ---------- Menu events ---------- */
function bindMenuEvents() {
  categoryTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".cat-tab");
    if (!btn) return;
    const categoryId = btn.dataset.categoryId;
    activeCategoryId = categoryId === "" ? null : Number(categoryId);
    categoryTabs
      .querySelectorAll(".cat-tab")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderMenu();
  });

  grid.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    const inc = e.target.closest("[data-inc]");
    const dec = e.target.closest("[data-dec]");

    if (add) {
      addToCart(add.dataset.add, 1);
      refreshCardActions(add.dataset.add);
    } else if (inc) {
      const id = inc.dataset.inc;
      setCartQuantity(id, getCartQuantity(id) + 1);
      refreshCardActions(id);
    } else if (dec) {
      const id = dec.dataset.dec;
      setCartQuantity(id, getCartQuantity(id) - 1);
      refreshCardActions(id);
    } else {
      return;
    }
    renderCartDrawer();
  });
}

/* ---------- Cart drawer ---------- */
function bindDrawerEvents() {
  const drawer = document.getElementById("cartDrawer");
  const overlay = document.getElementById("drawerOverlay");

  document.getElementById("cartOpen").addEventListener("click", () => {
    renderCartDrawer();
    openDrawer();
  });
  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer);

  document.getElementById("emptyBrowseBtn").addEventListener("click", () => {
    closeDrawer();
  });

  document.getElementById("clearCartBtn").addEventListener("click", () => {
    clearCart();
    renderCartDrawer();
    // reset all visible cards back to "Add" buttons
    document.querySelectorAll("[data-card-actions]").forEach((el) => {
      const id = el.getAttribute("data-card-actions");
      el.innerHTML = `<button class="btn-add" data-add="${id}">Add +</button>`;
    });
  });

  document.getElementById("cartList").addEventListener("click", (e) => {
    const inc = e.target.closest("[data-inc]");
    const dec = e.target.closest("[data-dec]");
    if (inc) {
      const id = inc.dataset.inc;
      setCartQuantity(id, getCartQuantity(id) + 1);
      refreshCardActions(id);
    } else if (dec) {
      const id = dec.dataset.dec;
      setCartQuantity(id, getCartQuantity(id) - 1);
      refreshCardActions(id);
    } else {
      return;
    }
    renderCartDrawer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  function openDrawer() {
    drawer.classList.add("open");
    overlay.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    overlay.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
  }
}

function renderCartDrawer() {
  const cart = getCart();
  const listEl = document.getElementById("cartList");
  const emptyEl = document.getElementById("cartEmpty");
  const footer = document.getElementById("cartFooter");
  const fdEl = document.getElementById("freeDelivery");
  const countEl = document.getElementById("drawerCount");

  const lines = cart
    .map((entry) => {
      const item = getItemById(menu, entry.id);
      if (!item) return null;
      return {
        ...item,
        quantity: Number(entry.quantity) || 0,
        lineTotal: item.price * (Number(entry.quantity) || 0),
      };
    })
    .filter(Boolean);

  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

  updateCartBadge();
  countEl.textContent = count ? `(${count})` : "";

  if (lines.length === 0) {
    emptyEl.style.display = "";
    listEl.innerHTML = "";
    footer.hidden = true;
    fdEl.hidden = true;
    return;
  }

  emptyEl.style.display = "none";
  footer.hidden = false;

  listEl.innerHTML = lines
    .map(
      (l) => `
      <li class="cart-item" data-id="${l.id}">
        <img src="${imgUrl(l.image_url, 120)}" alt="${l.name}" onerror="this.remove();" />
        <div class="cart-item-info">
          <h4>${l.name}</h4>
          <span class="cart-item-price">${formatPrice(l.price)} each</span>
        </div>
        <div class="cart-item-actions">
          <div class="qty-stepper qty-stepper--sm">
            <button class="qty-btn" data-dec="${l.id}" aria-label="Decrease quantity">−</button>
            <span class="qty-value">${l.quantity}</span>
            <button class="qty-btn" data-inc="${l.id}" aria-label="Increase quantity">+</button>
          </div>
          <span class="cart-line-total">${formatPrice(l.lineTotal)}</span>
        </div>
      </li>`
    )
    .join("");

  document.getElementById("cartSubtotal").textContent = formatPrice(subtotal);

  const remaining = CONFIG.freeDeliveryThreshold - subtotal;
  if (remaining > 0) {
    fdEl.hidden = false;
    const pct = Math.min(
      100,
      Math.round((subtotal / CONFIG.freeDeliveryThreshold) * 100)
    );
    fdEl.innerHTML = `
      <div class="fd-text">Add <strong>${formatPrice(remaining)}</strong> more for FREE delivery</div>
      <div class="fd-bar"><div class="fd-fill" style="width:${pct}%"></div></div>`;
  } else {
    fdEl.hidden = false;
    fdEl.innerHTML =
      '<div class="fd-text fd-done">🎉 You\'ve unlocked FREE delivery!</div>';
  }
}
