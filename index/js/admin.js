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

      // Optionally load admin dashboard menu preview
      loadAdminOverview();
    }

    function hideAdminContent() {
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
