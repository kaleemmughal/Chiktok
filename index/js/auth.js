/* ============================================================
   Dera Karahi — optional customer authentication
   ------------------------------------------------------------
   Uses the shared client created in js/common.js
   (window.supabaseClient). Load this file AFTER common.js.

   Used by:
   - login.html    → sign in / create account card
   - index.html    → shared header widget ([data-auth-nav])
   - checkout.html → shared header widget + profile prefill

   Authentication is always optional. Guest checkout is unaffected.
   ============================================================ */

(function () {
  "use strict";

  const DEFAULT_REDIRECT = "index.html";
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const profileCache = new Map();
  let authPageReset = null;

  function getClient() {
    return window.supabaseClient || null;
  }

  function escapeValue(value) {
    if (typeof window.escapeHTML === "function") return window.escapeHTML(value);
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /* ---------- Redirects (same-site HTML pages only) ---------- */
  function safeRedirect(raw) {
    if (!raw) return DEFAULT_REDIRECT;

    try {
      const url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return DEFAULT_REDIRECT;
      if (!/\.html?$/i.test(url.pathname)) return DEFAULT_REDIRECT;
      // Never bounce back to the login page (would hide the signed-in state).
      if (/\/login\.html$/i.test(url.pathname)) return DEFAULT_REDIRECT;
      return url.pathname + url.search + url.hash;
    } catch (err) {
      return DEFAULT_REDIRECT;
    }
  }

  function getRedirectTarget() {
    const params = new URLSearchParams(window.location.search);
    return safeRedirect(params.get("redirect"));
  }

  /* ---------- Phone helpers ---------- */
  function normalizePhone(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");

    if (digits.length === 12 && digits.indexOf("92") === 0) return "0" + digits.slice(2);
    if (digits.length === 11 && digits.charAt(0) === "0") return digits;
    if (digits.length === 10 && digits.charAt(0) === "3") return "0" + digits;
    return raw;
  }

  function isValidPakistaniPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return /^(0?3\d{9}|92\d{10})$/.test(digits);
  }

  /* ---------- Profile helpers ---------- */
  function firstName(profile, user) {
    const fullName =
      (profile && profile.full_name) ||
      (user && user.user_metadata && user.user_metadata.full_name) ||
      "";
    const first = String(fullName).trim().split(/\s+/)[0];
    if (first) return first;

    const email = (user && user.email) || "";
    return email ? email.split("@")[0] : "there";
  }

  async function loadProfile(supabase, user) {
    if (!supabase || !user || !user.id) return null;
    if (profileCache.has(user.id)) return profileCache.get(user.id);

    const promise = (async function () {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("full_name, phone")
          .eq("id", user.id)
          .maybeSingle();

        if (error) throw error;
        return data || null;
      } catch (err) {
        console.warn("Could not load customer profile:", err);
        profileCache.delete(user.id);
        return null;
      }
    })();

    profileCache.set(user.id, promise);
    return promise;
  }

  async function getSignedInProfile() {
    const supabase = getClient();
    if (!supabase) return null;

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const session = data && data.session;
      if (!session || !session.user) return null;

      const profile = await loadProfile(supabase, session.user);
      return { session: session, user: session.user, profile: profile };
    } catch (err) {
      console.warn("Could not read the current session:", err);
      return null;
    }
  }

  /* ---------- Shared header widget ---------- */
  function loginHref() {
    const path = window.location.pathname || "/index.html";
    if (/\/login\.html?$/i.test(path)) return "login.html";

    const here = path + window.location.search + window.location.hash;
    return "login.html?redirect=" + encodeURIComponent(here);
  }

  function loggedOutMarkup() {
    return '<a class="auth-link" href="' + escapeValue(loginHref()) + '">Login / Sign Up</a>';
  }

  function loggedInMarkup(name) {
    return (
      '<span class="auth-greeting">Hi, ' + escapeValue(name) + "</span>" +
      '<a class="auth-link" href="my-orders.html">My Orders</a>' +
      '<button type="button" class="auth-logout" data-auth-logout>Logout</button>'
    );
  }

  async function renderAuthNav(session) {
    const nav = document.querySelector("[data-auth-nav]");
    if (!nav) return;

    const user = session && session.user;
    if (!user) {
      nav.dataset.authUserId = "";
      nav.innerHTML = loggedOutMarkup();
      return;
    }

    nav.dataset.authUserId = user.id;
    // Show the greeting immediately from auth metadata, then refine with the profile row.
    nav.innerHTML = loggedInMarkup(firstName(null, user));

    const profile = await loadProfile(getClient(), user);
    if (nav.dataset.authUserId !== user.id) return;
    nav.innerHTML = loggedInMarkup(firstName(profile, user));
  }

  async function initAuthHeader() {
    const nav = document.querySelector("[data-auth-nav]");
    if (!nav) return;

    const supabase = getClient();
    if (!supabase) {
      nav.innerHTML = loggedOutMarkup();
      return;
    }

    let session = null;
    try {
      const { data } = await supabase.auth.getSession();
      session = (data && data.session) || null;
    } catch (err) {
      console.warn("Could not read the current session:", err);
    }

    await renderAuthNav(session);

    supabase.auth.onAuthStateChange(function (event, nextSession) {
      if (event === "SIGNED_OUT") profileCache.clear();
      // Never await Supabase calls directly inside this callback (deadlock risk).
      window.setTimeout(function () {
        renderAuthNav(nextSession);
      }, 0);
    });
  }

  /* ---------- Login / sign-up page ---------- */
  function initAuthPage() {
    const page = document.querySelector("[data-auth-page]");
    if (!page) return;

    const supabase = getClient();
    const redirectTo = getRedirectTarget();
    const errorEl = document.getElementById("authError");
    const noticeEl = document.getElementById("authNotice");
    const signInForm = document.getElementById("signInForm");
    const signUpForm = document.getElementById("signUpForm");
    const signedInEl = document.getElementById("authSignedIn");
    const signedInAs = document.getElementById("authSignedInAs");
    const continueLink = document.getElementById("authContinue");
    const titleEl = document.getElementById("authTitle");
    const subtitleEl = document.getElementById("authSubtitle");
    const toggleEl = page.querySelector(".auth-toggle");
    const tabs = Array.prototype.slice.call(page.querySelectorAll("[data-auth-tab]"));
    const panels = Array.prototype.slice.call(page.querySelectorAll("[data-auth-panel]"));

    if (continueLink) continueLink.href = redirectTo;

    function hideMessages() {
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.hidden = true;
      }
      if (noticeEl) {
        noticeEl.textContent = "";
        noticeEl.hidden = true;
      }
    }

    function showError(message) {
      hideMessages();
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
      }
    }

    function showNotice(message) {
      hideMessages();
      if (noticeEl) {
        noticeEl.textContent = message;
        noticeEl.hidden = false;
      }
    }

    function clearFieldErrors() {
      Array.prototype.forEach.call(page.querySelectorAll(".field.has-error"), function (field) {
        field.classList.remove("has-error");
      });
    }

    function setMode(nextMode, options) {
      const isSignup = nextMode === "signup";
      const mode = isSignup ? "signup" : "signin";

      tabs.forEach(function (tab) {
        const active = tab.dataset.authTab === mode;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });

      panels.forEach(function (panel) {
        panel.hidden = panel.dataset.authPanel !== mode;
      });

      if (titleEl) titleEl.textContent = isSignup ? "Create your account" : "Welcome back";
      if (subtitleEl) {
        subtitleEl.textContent = isSignup
          ? "Save your details for faster checkout."
          : "Sign in to reorder faster and view your orders.";
      }

      if (!options || !options.keepMessages) hideMessages();
      clearFieldErrors();

      if (options && options.focus) {
        const activePanel = page.querySelector('[data-auth-panel="' + mode + '"]');
        const firstInput = activePanel && activePanel.querySelector("input");
        if (firstInput) firstInput.focus();
      }
    }

    function setBusy(form, busy, busyLabel) {
      if (!form) return;
      const btn = form.querySelector('button[type="submit"]');
      if (!btn) return;

      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.disabled = busy;
      btn.setAttribute("aria-busy", busy ? "true" : "false");
      btn.textContent = busy ? busyLabel : btn.dataset.label;
    }

    function markInvalid(input, message) {
      if (input) {
        const field = input.closest(".field");
        if (field) field.classList.add("has-error");
        input.focus();
      }
      showError(message);
      return false;
    }

    function friendlyError(err) {
      const message = String((err && err.message) || err || "").trim();
      const lower = message.toLowerCase();

      if (lower.indexOf("invalid login credentials") !== -1) {
        return "Incorrect email or password. Please try again.";
      }
      if (lower.indexOf("email not confirmed") !== -1) {
        return "Please confirm your email address before signing in.";
      }
      if (lower.indexOf("already registered") !== -1) {
        return "An account with this email already exists. Try signing in instead.";
      }
      if (lower.indexOf("password should be at least") !== -1) {
        return "Password must be at least 6 characters.";
      }
      if (lower.indexOf("rate limit") !== -1 || lower.indexOf("too many") !== -1) {
        return "Too many attempts. Please wait a moment and try again.";
      }
      if (lower.indexOf("failed to fetch") !== -1 || lower.indexOf("network") !== -1) {
        return "Could not reach the server. Please check your connection and try again.";
      }
      return message || "Something went wrong. Please try again.";
    }

    function showSignedIn(ctx) {
      if (!signedInEl) return;

      const name = firstName(ctx.profile, ctx.user);
      if (signedInAs) {
        signedInAs.textContent =
          "Hi, " + name + (ctx.user.email ? " · " + ctx.user.email : "");
      }

      signedInEl.hidden = false;
      if (toggleEl) toggleEl.hidden = true;
      panels.forEach(function (panel) {
        panel.hidden = true;
      });
      if (titleEl) titleEl.textContent = "Your account";
      if (subtitleEl) subtitleEl.textContent = "You're signed in.";
      hideMessages();
    }

    function showAuthForms() {
      if (signedInEl) signedInEl.hidden = true;
      if (toggleEl) toggleEl.hidden = false;
      setMode("signin");
    }

    authPageReset = showAuthForms;

    async function onSignIn(event) {
      event.preventDefault();
      hideMessages();

      const emailInput = document.getElementById("signinEmail");
      const passwordInput = document.getElementById("signinPassword");
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (!email) return markInvalid(emailInput, "Please enter your email address.");
      if (!EMAIL_RE.test(email)) return markInvalid(emailInput, "Please enter a valid email address.");
      if (!password) return markInvalid(passwordInput, "Please enter your password.");

      setBusy(signInForm, true, "Signing in…");

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email,
          password: password,
        });

        if (error) throw error;
        if (!data || !data.session) {
          throw new Error("Could not start a session. Please try again.");
        }

        window.location.replace(redirectTo);
      } catch (err) {
        showError(friendlyError(err));
        setBusy(signInForm, false);
      }
    }

    async function onSignUp(event) {
      event.preventDefault();
      hideMessages();

      const nameInput = document.getElementById("signupName");
      const phoneInput = document.getElementById("signupPhone");
      const emailInput = document.getElementById("signupEmail");
      const passwordInput = document.getElementById("signupPassword");

      const fullName = nameInput.value.trim().replace(/\s+/g, " ");
      const phoneRaw = phoneInput.value.trim();
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (fullName.length < 2) {
        return markInvalid(nameInput, "Please enter your full name.");
      }
      if (fullName.length > 100) {
        return markInvalid(nameInput, "Name must be 100 characters or fewer.");
      }
      if (!isValidPakistaniPhone(phoneRaw)) {
        return markInvalid(
          phoneInput,
          "Enter a valid Pakistani mobile number (e.g. 03XX-XXXXXXX)."
        );
      }
      if (!EMAIL_RE.test(email)) {
        return markInvalid(emailInput, "Please enter a valid email address.");
      }
      if (password.length < 6) {
        return markInvalid(passwordInput, "Password must be at least 6 characters.");
      }

      const phone = normalizePhone(phoneRaw);
      setBusy(signUpForm, true, "Creating account…");

      try {
        const { data, error } = await supabase.auth.signUp({
          email: email,
          password: password,
          options: {
            data: {
              full_name: fullName,
              phone: phone,
            },
          },
        });

        if (error) throw error;

        // Email confirmation disabled — a session is available immediately.
        if (data && data.session) {
          window.location.replace(redirectTo);
          return;
        }

        // Supabase may return an obfuscated user (no identities) for an existing email.
        if (
          data &&
          data.user &&
          Array.isArray(data.user.identities) &&
          data.user.identities.length === 0
        ) {
          showError("An account with this email already exists. Please sign in instead.");
          setBusy(signUpForm, false);
          return;
        }

        // Email confirmation enabled — no session yet.
        const signInEmail = document.getElementById("signinEmail");
        if (signInEmail) signInEmail.value = email;
        setMode("signin", { keepMessages: true });
        showNotice(
          "Account created! Check your email to confirm your address, then sign in."
        );
        setBusy(signUpForm, false);
      } catch (err) {
        showError(friendlyError(err));
        setBusy(signUpForm, false);
      }
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        setMode(tab.dataset.authTab, { focus: true });
      });
    });

    if (toggleEl) {
      toggleEl.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const next = event.key === "ArrowRight" ? "signup" : "signin";
        setMode(next, { focus: true });
        const nextTab = page.querySelector('[data-auth-tab="' + next + '"]');
        if (nextTab) nextTab.focus();
      });
    }

    if (signInForm) signInForm.addEventListener("submit", onSignIn);
    if (signUpForm) signUpForm.addEventListener("submit", onSignUp);

    page.addEventListener("input", function (event) {
      const field = event.target.closest(".field");
      if (field) field.classList.remove("has-error");
      hideMessages();
    });

    if (!supabase) {
      showError(
        "Authentication is unavailable right now. Please refresh the page and try again."
      );
      [signInForm, signUpForm].forEach(function (form) {
        if (!form) return;
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
      });
      return;
    }

    const initialMode = new URLSearchParams(window.location.search).get("mode");
    setMode(initialMode === "signup" || window.location.hash === "#signup" ? "signup" : "signin");

    getSignedInProfile().then(function (ctx) {
      if (ctx) showSignedIn(ctx);
    });
  }

  /* ---------- Logout (works in the header and on login.html) ---------- */
  document.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-auth-logout]");
    if (!button) return;

    event.preventDefault();

    const supabase = getClient();
    if (!supabase) return;

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Signing out…";

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      profileCache.clear();

      const nav = document.querySelector("[data-auth-nav]");
      if (nav) {
        nav.dataset.authUserId = "";
        nav.innerHTML = loggedOutMarkup();
      }

      if (typeof authPageReset === "function") authPageReset();
    } catch (err) {
      console.warn("Sign out failed:", err);
      button.disabled = false;
      button.textContent = originalLabel;
      showError("Could not sign out. Please try again.");
    }

    function showError(message) {
      const errorEl = document.getElementById("authError");
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  });

  /* ---------- Init ---------- */
  function init() {
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    initAuthHeader();
    initAuthPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* Public helpers used by checkout.js and other page scripts. */
  window.DeraAuth = {
    getRedirectTarget: getRedirectTarget,
    getSignedInProfile: getSignedInProfile,
    normalizePhone: normalizePhone,
    refreshHeader: function () {
      return getSignedInProfile().then(function (ctx) {
        return renderAuthNav(ctx ? ctx.session : null);
      });
    },
  };
})();
