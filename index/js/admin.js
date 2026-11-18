/* ============================================================
   Dera Karahi — Admin authentication & dashboard logic
   File: js/admin.js
   Supabase Project Id: gwvzjazdwrkuzuijjzrb
   Publishable Key: sb_publishable_2CggYIxbMk87FfYKc2Xt5A_RdNTGjjZ
   ============================================================ */

(function () {
  "use strict";

  const SUPABASE_PROJECT_ID = "gwvzjazdwrkuzuijjzrb";
  const SUPABASE_URL = "https://gwvzjazdwrkuzuijjzrb.supabase.co";
  const SUPABASE_KEY = "sb_publishable_2CggYIxbMk87FfYKc2Xt5A_RdNTGjjZ";

  // Provide dual ID access for input elements and buttons (e.g. login-email vs email)
  const aliases = {
    "login-email": "email",
    "email": "login-email",
    "login-password": "password",
    "password": "login-password",
    "login-button": "login-btn",
    "login-btn": "login-button",
    "loginBtn": "login-button",
    "loginForm": "login-form",
    "login-form": "loginForm",
    "logout-button": "logout-btn",
    "logout-btn": "logout-button",
    "logoutBtn": "logout-button",
    "login-error": "loginError",
    "loginError": "login-error",
    "admin-user-email": "user-email",
    "admin-email": "user-email",
  };

  const origGetElementById = document.getElementById.bind(document);
  document.getElementById = function (id) {
    let el = origGetElementById(id);
    if (!el && aliases[id]) {
      el = origGetElementById(aliases[id]);
    }
    return el;
  };

  const origQuerySelector = document.querySelector.bind(document);
  document.querySelector = function (selector) {
    let el = origQuerySelector(selector);
    if (!el && typeof selector === "string" && selector.startsWith("#")) {
      const id = selector.slice(1);
      if (aliases[id]) {
        el = origQuerySelector("#" + aliases[id]);
      }
    }
    return el;
  };

  function getEscapeHTML() {
    if (typeof window.escapeHTML === "function") {
      return window.escapeHTML;
    }
    return function (str) {
      return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };
  }

  function getSupabaseClient() {
    if (window.supabaseClient) {
      return window.supabaseClient;
    }
    if (typeof supabaseClient !== "undefined" && supabaseClient) {
      return supabaseClient;
    }
    if (window.supabase && typeof window.supabase.createClient === "function") {
      const url = (window.CONFIG && window.CONFIG.supabaseUrl) || SUPABASE_URL;
      const key = (window.CONFIG && window.CONFIG.supabaseKey) || SUPABASE_KEY;
      window.supabaseClient = window.supabase.createClient(url, key);
      return window.supabaseClient;
    }
    return null;
  }

  document.addEventListener("DOMContentLoaded", initAdmin);

  function initAdmin() {
    // Set current year in footer
    const yearEl = document.getElementById("year");
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }

    const loginSection = document.getElementById("login-section");
    const adminDashboard = document.getElementById("admin-dashboard");
    const loginForm = document.getElementById("login-form");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const loginButton = document.getElementById("login-button");
    const loginError = document.getElementById("login-error");
    const logoutButton = document.getElementById("logout-button");
    const userEmailEl = document.getElementById("user-email");
    const loggedInAsEl = document.getElementById("logged-in-as");

    const escapeHTML = getEscapeHTML();
    let isOverviewLoaded = false;

    // ---------- Kitchen Orders ----------
    const ordersContainer = document.getElementById("admin-orders-container");
    const ordersCountEl = document.getElementById("orders-count");
    const refreshOrdersBtn = document.getElementById("refresh-orders-btn");
    const orderFilterButtons = Array.prototype.slice.call(
      document.querySelectorAll("[data-order-filter]")
    );

    const ACTIVE_ORDER_STATUSES = ["received", "accepted", "preparing", "out_for_delivery"];
    const COMPLETED_ORDER_STATUSES = ["delivered", "rejected"];
    const ORDER_STATUS_META = {
      received: { label: "Received", modifier: "received" },
      accepted: { label: "Accepted", modifier: "accepted" },
      preparing: { label: "Preparing", modifier: "preparing" },
      out_for_delivery: { label: "Out for Delivery", modifier: "out-for-delivery" },
      delivered: { label: "Delivered", modifier: "delivered" },
      rejected: { label: "Rejected", modifier: "rejected" },
    };

    let orders = [];
    let currentOrderFilter = "active";
    let ordersHaveLoaded = false;
    let isOrdersLoading = false;
    let ordersRequestId = 0;

    function makeElement(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    }

    function toOrderAmount(value, fallback) {
      const amount = Number(value);
      return Number.isFinite(amount) ? amount : fallback;
    }

    function formatOrderMoney(value) {
      const amount = toOrderAmount(value, 0);
      if (typeof window.formatPrice === "function") {
        return window.formatPrice(amount);
      }
      return "Rs " + amount.toLocaleString("en-PK");
    }

    function normalizeOrderStatus(value) {
      return (
        String(value || "unknown")
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_") || "unknown"
      );
    }

    function getOrderStatusMeta(status) {
      return ORDER_STATUS_META[status] || { label: "Unknown", modifier: "unknown" };
    }

    function formatRelativeTime(date) {
      const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
      if (diffSeconds < 60) return "just now";

      const minutes = Math.floor(diffSeconds / 60);
      if (minutes < 60) return minutes + (minutes === 1 ? " min ago" : " mins ago");

      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + (hours === 1 ? " hr ago" : " hrs ago");

      const days = Math.floor(hours / 24);
      return days + (days === 1 ? " day ago" : " days ago");
    }

    function getOrderTimeParts(value) {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) {
        return { time: "Time unavailable", relative: "" };
      }

      return {
        time: date.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }),
        relative: formatRelativeTime(date),
      };
    }

    function getTelephoneHref(phone) {
      const digits = String(phone || "").replace(/[^\d+]/g, "");
      return digits ? "tel:" + digits : "";
    }

    function appendOrderTotal(parent, label, value, modifier) {
      const row = makeElement(
        "div",
        "order-total-row" + (modifier ? " order-total-row--" + modifier : "")
      );
      const valueTag = modifier === "grand" ? "strong" : "span";
      row.appendChild(makeElement("span", "order-total-label", label));
      row.appendChild(makeElement(valueTag, "order-total-value", value));
      parent.appendChild(row);
    }

    function buildOrderCard(order) {
      const safeOrder = order || {};
      const status = normalizeOrderStatus(safeOrder.status);
      const statusMeta = getOrderStatusMeta(status);
      const rawType = String(safeOrder.order_type || "").trim().toLowerCase();
      const typeLabel =
        rawType === "delivery"
          ? "DELIVERY"
          : rawType === "pickup"
          ? "PICKUP"
          : rawType
          ? rawType.toUpperCase()
          : "—";
      const typeModifier =
        rawType === "delivery" ? "delivery" : rawType === "pickup" ? "pickup" : "unknown";
      const timeParts = getOrderTimeParts(safeOrder.created_at);

      const card = makeElement("article", "order-card order-card--" + statusMeta.modifier);
      card.setAttribute("data-status", status);

      const head = makeElement("div", "order-card-head");
      const title = makeElement("div", "order-card-title");
      const orderNumber = safeOrder.order_number ?? safeOrder.id ?? "—";
      title.appendChild(makeElement("h3", "order-number", "#" + orderNumber));

      const timeEl = makeElement("span", "order-time", timeParts.time);
      if (timeParts.relative) {
        timeEl.appendChild(makeElement("span", "order-relative", " · " + timeParts.relative));
      }
      title.appendChild(timeEl);

      const badges = makeElement("div", "order-card-badges");
      badges.appendChild(
        makeElement(
          "span",
          "order-status order-status--" + statusMeta.modifier,
          statusMeta.label
        )
      );
      badges.appendChild(
        makeElement("span", "order-type-badge order-type-badge--" + typeModifier, typeLabel)
      );

      head.append(title, badges);
      card.appendChild(head);

      const body = makeElement("div", "order-card-body");

      // Customer details — every value below is inserted with textContent only.
      const customer = makeElement("div", "order-customer");
      const customerName = String(safeOrder.customer_name || "").trim() || "Customer";
      customer.appendChild(makeElement("div", "order-customer-name", customerName));

      const phone = String(safeOrder.phone || "").trim();
      if (phone) {
        const telHref = getTelephoneHref(phone);
        if (telHref) {
          const phoneLink = makeElement("a", "order-phone", phone);
          phoneLink.href = telHref;
          customer.appendChild(phoneLink);
        } else {
          customer.appendChild(makeElement("span", "order-phone", phone));
        }
      }

      if (rawType === "delivery") {
        const address = String(safeOrder.address || "").trim();
        if (address) {
          customer.appendChild(makeElement("p", "order-address", address));
        }
      }

      const notes = String(safeOrder.notes || "").trim();
      if (notes) {
        const note = makeElement("div", "order-note");
        note.appendChild(makeElement("strong", "", "Note: "));
        note.appendChild(makeElement("span", "order-note-text", notes));
        customer.appendChild(note);
      }

      body.appendChild(customer);

      const orderItems = Array.isArray(safeOrder.order_items) ? safeOrder.order_items : [];
      const itemsList = makeElement("ul", "order-items");

      if (orderItems.length === 0) {
        itemsList.appendChild(
          makeElement("li", "order-item order-item--missing", "No items recorded")
        );
      } else {
        orderItems.forEach(function (item) {
          const safeItem = item || {};
          const quantity = Math.max(0, Number(safeItem.quantity) || 0);
          const unitPrice = toOrderAmount(safeItem.unit_price, 0);
          const row = makeElement("li", "order-item");

          row.appendChild(makeElement("span", "order-item-qty", quantity + "x "));
          row.appendChild(makeElement("span", "order-item-name", safeItem.name || "Item"));
          row.appendChild(makeElement("span", "order-item-dash", " — "));
          row.appendChild(
            makeElement("span", "order-item-price", formatOrderMoney(unitPrice * quantity))
          );
          itemsList.appendChild(row);
        });
      }

      body.appendChild(itemsList);

      const itemsSubtotal = orderItems.reduce(function (sum, item) {
        const safeItem = item || {};
        const quantity = Math.max(0, Number(safeItem.quantity) || 0);
        return sum + toOrderAmount(safeItem.unit_price, 0) * quantity;
      }, 0);
      const subtotal = toOrderAmount(safeOrder.subtotal, itemsSubtotal);
      const deliveryFee = toOrderAmount(safeOrder.delivery_fee, 0);
      const discount = toOrderAmount(safeOrder.discount, 0);
      const total = toOrderAmount(safeOrder.total, subtotal + deliveryFee - discount);

      const totals = makeElement("div", "order-totals");
      appendOrderTotal(totals, "Subtotal", formatOrderMoney(subtotal));
      appendOrderTotal(
        totals,
        "Delivery fee",
        deliveryFee > 0 ? formatOrderMoney(deliveryFee) : "Free"
      );
      appendOrderTotal(
        totals,
        "Discount",
        discount > 0 ? "- " + formatOrderMoney(discount) : formatOrderMoney(0)
      );
      appendOrderTotal(totals, "Total", formatOrderMoney(total), "grand");
      body.appendChild(totals);

      card.appendChild(body);
      return card;
    }

    function getFilteredOrders() {
      if (currentOrderFilter === "all") return orders;

      const allowed =
        currentOrderFilter === "completed"
          ? COMPLETED_ORDER_STATUSES
          : ACTIVE_ORDER_STATUSES;

      return orders.filter(function (order) {
        return allowed.indexOf(normalizeOrderStatus(order && order.status)) !== -1;
      });
    }

    function renderOrdersMessage(message) {
      if (!ordersContainer) return;
      ordersContainer.textContent = "";
      ordersContainer.appendChild(makeElement("p", "order-empty", message));
    }

    function renderOrders() {
      if (!ordersContainer) return;

      const filteredOrders = getFilteredOrders();
      ordersContainer.textContent = "";

      if (ordersCountEl) {
        const noun = filteredOrders.length === 1 ? "order" : "orders";
        let qualifier = "";
        if (currentOrderFilter === "active") qualifier = "active ";
        else if (currentOrderFilter === "completed") qualifier = "completed ";
        ordersCountEl.textContent = filteredOrders.length + " " + qualifier + noun;
      }

      if (filteredOrders.length === 0) {
        let message = "No orders yet.";
        if (orders.length > 0 && currentOrderFilter === "active") {
          message = "No active orders right now.";
        } else if (orders.length > 0 && currentOrderFilter === "completed") {
          message = "No completed orders yet.";
        }
        renderOrdersMessage(message);
        return;
      }

      const fragment = document.createDocumentFragment();
      filteredOrders.forEach(function (order) {
        fragment.appendChild(buildOrderCard(order));
      });
      ordersContainer.appendChild(fragment);
    }

    async function loadAdminOrders(force) {
      if (!ordersContainer || !supabase) return;
      if (isOrdersLoading) return;
      if (ordersHaveLoaded && !force) return;

      const requestId = ++ordersRequestId;
      isOrdersLoading = true;
      ordersContainer.setAttribute("aria-busy", "true");

      if (refreshOrdersBtn) {
        refreshOrdersBtn.disabled = true;
        refreshOrdersBtn.textContent = "Refreshing…";
      }
      if (!ordersHaveLoaded) {
        renderOrdersMessage("Loading orders…");
      }

      try {
        const { data, error } = await supabase
          .from("orders")
          .select("*, order_items(*)")
          .order("created_at", { ascending: false })
          .limit(100);

        if (requestId !== ordersRequestId) return;
        if (error) throw error;

        orders = Array.isArray(data) ? data : [];
        ordersHaveLoaded = true;
        renderOrders();
      } catch (err) {
        if (requestId !== ordersRequestId) return;
        console.error("Could not load orders in admin:", err);
        ordersHaveLoaded = false;
        if (ordersCountEl) ordersCountEl.textContent = "";
        renderOrdersMessage("Could not load orders. Use Refresh to try again.");
      } finally {
        if (requestId === ordersRequestId) {
          isOrdersLoading = false;
          ordersContainer.setAttribute("aria-busy", "false");
          if (refreshOrdersBtn) {
            refreshOrdersBtn.disabled = false;
            refreshOrdersBtn.textContent = "Refresh";
          }
        }
      }
    }

    orderFilterButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        currentOrderFilter = button.getAttribute("data-order-filter") || "active";

        orderFilterButtons.forEach(function (otherButton) {
          const isActive = otherButton === button;
          otherButton.classList.toggle("is-active", isActive);
          otherButton.setAttribute("aria-pressed", isActive ? "true" : "false");
        });

        if (ordersHaveLoaded && !isOrdersLoading) {
          renderOrders();
        }
      });
    });

    if (refreshOrdersBtn) {
      refreshOrdersBtn.addEventListener("click", function () {
        loadAdminOrders(true);
      });
    }

    // Immediately hide admin content when there is no valid session
    hideAdminContent();

    function showAdminContent(session) {
      const email = (session && session.user && session.user.email) || "";

      // Hide the login form and show the admin content
      if (loginSection) {
        loginSection.hidden = true;
        loginSection.setAttribute("hidden", "");
        loginSection.style.display = "none";
      }

      if (adminDashboard) {
        adminDashboard.hidden = false;
        adminDashboard.removeAttribute("hidden");
        adminDashboard.style.display = "";
      }

      // Display "Logged in as [email]"
      if (userEmailEl) {
        userEmailEl.textContent = email;
      }
      if (loggedInAsEl) {
        const strong = loggedInAsEl.querySelector("#user-email");
        if (strong) {
          strong.textContent = email;
        } else {
          loggedInAsEl.innerHTML = `Logged in as <strong id="user-email">${escapeHTML(email)}</strong>`;
        }
      }

      // Clear any pending login errors
      clearLoginError();

      // Load the kitchen queue and the menu preview for a verified admin
      loadAdminOrders();
      loadAdminOverview();
    }

    function hideAdminContent() {
      // Invalidate any in-flight order request and clear cached order data
      ordersRequestId += 1;
      isOrdersLoading = false;
      orders = [];
      ordersHaveLoaded = false;
      if (ordersContainer) {
        ordersContainer.setAttribute("aria-busy", "false");
      }
      if (refreshOrdersBtn) {
        refreshOrdersBtn.disabled = false;
        refreshOrdersBtn.textContent = "Refresh";
      }

      // Hide admin content immediately when there is no valid session
      if (adminDashboard) {
        adminDashboard.hidden = true;
        adminDashboard.setAttribute("hidden", "");
        adminDashboard.style.display = "none";
      }

      // Show login form
      if (loginSection) {
        loginSection.hidden = false;
        loginSection.removeAttribute("hidden");
        loginSection.style.display = "";
      }

      if (userEmailEl) {
        userEmailEl.textContent = "";
      }
      if (loggedInAsEl) {
        const strong = loggedInAsEl.querySelector("#user-email");
        if (strong) {
          strong.textContent = "";
        } else {
          loggedInAsEl.textContent = "";
        }
      }
    }

    function showLoginError(msg) {
      if (!loginError) return;
      if (msg) {
        loginError.textContent = msg;
        loginError.hidden = false;
        loginError.removeAttribute("hidden");
        loginError.style.display = "";
      } else {
        clearLoginError();
      }
    }

    function clearLoginError() {
      if (!loginError) return;
      loginError.textContent = "";
      loginError.hidden = true;
      loginError.setAttribute("hidden", "");
      loginError.style.display = "none";
    }

    function setLoginLoading(isLoading) {
      if (!loginButton) return;
      loginButton.disabled = isLoading;
      loginButton.textContent = isLoading ? "Signing In..." : "Log In";
      if (emailInput) emailInput.disabled = isLoading;
      if (passwordInput) passwordInput.disabled = isLoading;
    }

    // ---------- Supabase Auth Integration ----------
    const supabase = getSupabaseClient();
    if (!supabase || !supabase.auth) {
      console.error("Supabase client is not available.");
      showLoginError("Unable to connect to authentication service. Please refresh.");
      return;
    }

    // ---------- Admin role verification ----------
    const ACCESS_DENIED_MESSAGE = "Access denied: This account does not have admin privileges.";

    // Guards against stale async role checks revealing the dashboard after a newer check
    let roleCheckId = 0;
    // User id whose admin role has already been confirmed during this page lifetime
    let verifiedAdminUserId = null;

    // Called whenever a session is active: the dashboard is only revealed for role === "admin"
    async function handleActiveSession(session) {
      const userId = session && session.user ? session.user.id : null;

      if (!userId) {
        hideAdminContent();
        return;
      }

      // Already verified in this page load — just keep the dashboard visible
      if (verifiedAdminUserId === userId) {
        showAdminContent(session);
        return;
      }

      const checkId = ++roleCheckId;

      // Keep admin content hidden until the role has been confirmed
      hideAdminContent();

      let isAdmin = false;
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single();

        if (error) {
          console.error("Error verifying admin role:", error);
        } else if (data && data.role === "admin") {
          isAdmin = true;
        }
      } catch (err) {
        console.error("Admin role check exception:", err);
        isAdmin = false;
      }

      // A newer session check started while this one was in flight
      if (checkId !== roleCheckId) return;

      if (isAdmin) {
        verifiedAdminUserId = userId;
        showAdminContent(session);
      } else {
        verifiedAdminUserId = null;
        await denyAccess(checkId);
      }
    }

    // Signs the non-admin user out, keeps the dashboard hidden and reports why
    async function denyAccess(checkId) {
      hideAdminContent();

      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error("Sign out after failed admin check exception:", err);
      }

      if (typeof checkId === "number" && checkId !== roleCheckId) return;

      hideAdminContent();
      showLoginError(ACCESS_DENIED_MESSAGE);
    }

    // 1. Listen for auth state changes using Supabase Auth session listener
    supabase.auth.onAuthStateChange((event, session) => {
      // Defer the async role lookup so it never runs inside the auth callback
      window.setTimeout(function () {
        if (session && session.user) {
          handleActiveSession(session);
        } else {
          verifiedAdminUserId = null;
          hideAdminContent();
        }
      }, 0);
    });

    // 2. Check the existing session when the page loads so refreshing does not log out
    async function checkExistingSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error("Error retrieving existing session:", error);
          hideAdminContent();
          return;
        }

        if (data && data.session && data.session.user) {
          await handleActiveSession(data.session);
        } else {
          hideAdminContent();
        }
      } catch (err) {
        console.error("Session check exception:", err);
        hideAdminContent();
      }
    }

    checkExistingSession();

    // 3. Login form submission
    if (loginForm) {
      loginForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        clearLoginError();

        const email = emailInput ? emailInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";

        if (!email) {
          showLoginError("Please enter your email address.");
          emailInput?.focus();
          return;
        }

        if (!password) {
          showLoginError("Please enter your password.");
          passwordInput?.focus();
          return;
        }

        setLoginLoading(true);

        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (error) {
            showLoginError(error.message || "Invalid login credentials.");
            setLoginLoading(false);
            return;
          }

          if (data && data.session) {
            if (passwordInput) passwordInput.value = "";
            await handleActiveSession(data.session);
          }
        } catch (err) {
          console.error("Sign in exception:", err);
          showLoginError(err.message || "An unexpected error occurred during sign in.");
        } finally {
          setLoginLoading(false);
        }
      });
    }

    // 4. Logout action
    async function handleLogout() {
      try {
        if (logoutButton) {
          logoutButton.disabled = true;
          logoutButton.textContent = "Logging Out...";
        }

        const { error } = await supabase.auth.signOut();
        if (error) {
          console.error("Sign out error:", error);
        }
      } catch (err) {
        console.error("Sign out exception:", err);
      } finally {
        if (logoutButton) {
          logoutButton.disabled = false;
          logoutButton.textContent = "Log Out";
        }
        hideAdminContent();
      }
    }

    if (logoutButton) {
      logoutButton.addEventListener("click", handleLogout);
    }

    // Also support any element with id="logout-btn"
    const logoutBtnAlt = document.getElementById("logout-btn");
    if (logoutBtnAlt && logoutBtnAlt !== logoutButton) {
      logoutBtnAlt.addEventListener("click", handleLogout);
    }

    // 5. Admin Dashboard Menu Overview
    async function loadAdminOverview() {
      if (isOverviewLoaded) return;
      const menuContainer = document.getElementById("admin-menu-container");
      const statMenuCount = document.getElementById("stat-menu-count");
      if (!menuContainer) return;

      try {
        const [catRes, itemRes] = await Promise.all([
          supabase.from("categories").select("id, name, sort_order").order("sort_order", { ascending: true }),
          supabase.from("menu_items").select("id, category_id, name, price, is_available").order("id", { ascending: true }),
        ]);

        const categories = catRes.data || [];
        const items = itemRes.data || [];

        if (statMenuCount) {
          statMenuCount.textContent = items.length;
        }

        if (items.length === 0) {
          menuContainer.innerHTML = `<p class="text-muted">No menu items found in the database.</p>`;
          return;
        }

        const catMap = new Map(categories.map((c) => [c.id, c.name]));

        const rows = items
          .map((item) => {
            const catName = catMap.get(item.category_id) || "—";
            const statusBadge = item.is_available
              ? `<span class="badge-status badge-status--active">Available</span>`
              : `<span class="badge-status badge-status--inactive">Sold Out</span>`;
            const priceStr =
              typeof window.formatPrice === "function"
                ? window.formatPrice(item.price)
                : `Rs ${Number(item.price).toLocaleString("en-PK")}`;

            return `
              <tr>
                <td><strong>${escapeHTML(item.name)}</strong></td>
                <td>${escapeHTML(catName)}</td>
                <td>${priceStr}</td>
                <td>${statusBadge}</td>
              </tr>
            `;
          })
          .join("");

        menuContainer.innerHTML = `
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        `;
        isOverviewLoaded = true;
      } catch (err) {
        console.warn("Could not load menu items in admin:", err);
        menuContainer.innerHTML = `<p class="text-muted">Connected to Supabase. Menu overview will update automatically.</p>`;
      }
    }

    const refreshBtn = document.getElementById("refresh-menu-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        isOverviewLoaded = false;
        loadAdminOverview();
      });
    }
  }
})();
