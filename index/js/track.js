/* ============================================================
   Dera Karahi — order tracking page logic (track.html)
   Reads the tracking token from the URL:
     track.html?token=<tracking_token>
   Calls the read-only /api/track endpoint. The token is never
   logged and no customer contact details are requested.
   ============================================================ */

const TRACK_POLL_INTERVAL_MS = 10000;
const TRACK_FINAL_STATUSES = ["delivered", "rejected"];

const TRACK_STATUS_META = {
  received: { label: "Received", modifier: "received" },
  accepted: { label: "Accepted", modifier: "accepted" },
  preparing: { label: "Preparing", modifier: "preparing" },
  out_for_delivery: { label: "Out for Delivery", modifier: "out-for-delivery" },
  delivered: { label: "Delivered", modifier: "delivered" },
  rejected: { label: "Rejected", modifier: "rejected" },
};

// Stages map to real database statuses. Pickup has no "ready" status,
// so its fourth stage has no status key and never shows a timestamp.
const DELIVERY_STAGE_LABELS = [
  "Received",
  "Accepted",
  "Preparing",
  "Out for Delivery",
  "Delivered",
];
const DELIVERY_STAGE_STATUSES = [
  "received",
  "accepted",
  "preparing",
  "out_for_delivery",
  "delivered",
];
const PICKUP_STAGE_LABELS = [
  "Received",
  "Accepted",
  "Preparing",
  "Ready Soon",
  "Delivered",
];
const PICKUP_STAGE_STATUSES = ["received", "accepted", "preparing", null, "delivered"];

let trackingToken = "";
let trackingTimer = null;
let trackingStopped = false;
let trackingBusy = false;
let currentOrder = null;
let transientBanner = null;

document.addEventListener("DOMContentLoaded", init);

function init() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  updateCartBadge();

  const params = new URLSearchParams(window.location.search);
  trackingToken = (params.get("token") || "").trim();

  // No token at all — explain the link is invalid and offer the menu.
  if (!trackingToken) {
    renderStateMessage({
      state: "invalid",
      emoji: "🔗",
      title: "This tracking link isn't valid",
      message:
        "The link you opened is missing its tracking token. Please use the full link from your order confirmation.",
    });
    return;
  }

  refreshOrder();
  startPolling();
}

/* ---------- Polling ---------- */
function startPolling() {
  if (trackingStopped || trackingTimer !== null || document.hidden) return;
  trackingTimer = setInterval(refreshOrder, TRACK_POLL_INTERVAL_MS);
}

function stopPolling() {
  if (trackingTimer === null) return;
  clearInterval(trackingTimer);
  trackingTimer = null;
}

function stopTrackingForever() {
  trackingStopped = true;
  stopPolling();
}

document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    stopPolling();
    return;
  }
  if (!trackingToken || trackingStopped) return;
  refreshOrder();
  startPolling();
});

window.addEventListener("pagehide", stopPolling);

window.addEventListener("pageshow", function (event) {
  // Only resume after a bfcache restore; the initial load already uses init().
  if (!event.persisted || !trackingToken || trackingStopped) return;
  refreshOrder();
  startPolling();
});

/* ---------- API ---------- */
async function refreshOrder() {
  if (trackingBusy || trackingStopped || !trackingToken) return;
  trackingBusy = true;

  try {
    const res = await fetch(`/api/track?token=${encodeURIComponent(trackingToken)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (res.status === 400) {
      stopTrackingForever();
      renderStateMessage({
        state: "invalid",
        emoji: "🔗",
        title: "This tracking link isn't valid",
        message:
          "The tracking token in this link is not in the expected format. Please open the link from your order confirmation again.",
      });
      return;
    }

    if (res.status === 404) {
      stopTrackingForever();
      renderStateMessage({
        state: "not-found",
        emoji: "🔍",
        title: "We couldn't find that order",
        message:
          "No order matches this tracking link. Please check that you opened the complete link from your confirmation.",
      });
      return;
    }

    if (!res.ok) {
      handleTransientFailure();
      return;
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    const order = data && data.order ? data.order : null;
    if (!order) {
      handleTransientFailure();
      return;
    }

    currentOrder = order;
    renderOrder(order);

    if (TRACK_FINAL_STATUSES.indexOf(normalizeStatus(order.status)) !== -1) {
      stopTrackingForever();
    }
  } catch (err) {
    handleTransientFailure();
  } finally {
    trackingBusy = false;
  }
}

function handleTransientFailure() {
  const message =
    "We're having trouble updating your order right now. We'll keep trying automatically.";

  if (currentOrder) {
    showTransientBanner(message);
    return;
  }

  const root = document.getElementById("trackRoot");
  const alreadyShown = root && root.dataset.state === "offline";
  if (alreadyShown) return;

  renderStateMessage({
    state: "offline",
    emoji: "📡",
    title: "We couldn't load your order",
    message:
      "Please check your connection. We'll keep trying automatically while this page stays open.",
    retry: true,
  });
}

/* ---------- Rendering ---------- */
function renderOrder(order) {
  const root = document.getElementById("trackRoot");
  if (!root) return;

  root.textContent = "";
  root.dataset.state = "order";
  transientBanner = null;

  const status = normalizeStatus(order.status);
  const rawType = String(order.order_type || "").trim().toLowerCase();
  const isPickup = rawType === "pickup";
  const isFinal = TRACK_FINAL_STATUSES.indexOf(status) !== -1;

  const grid = makeElement("div", "track-grid");
  grid.appendChild(buildProgressPanel(order, status, isPickup, isFinal));
  grid.appendChild(buildSummaryPanel(order, status, isPickup));
  root.appendChild(grid);
}

function buildProgressPanel(order, status, isPickup, isFinal) {
  const panel = makeElement("section", "track-panel track-panel--progress");
  const history = sortTrackHistory(order.order_status_history);
  const historyByStatus = indexHistoryByStatus(history);
  const statusMeta = getTrackStatusMeta(status);
  const isRejected = status === "rejected";

  // Header
  const head = makeElement("div", "track-head");
  const headMain = makeElement("div", "track-head-main");
  headMain.appendChild(
    makeElement("p", "track-eyebrow", "Order #" + String(order.order_number ?? ""))
  );
  headMain.appendChild(
    makeElement("h2", "track-heading", isRejected ? "Order update" : "Order progress")
  );
  headMain.appendChild(
    makeElement(
      "p",
      "track-updated",
      isFinal
        ? "Final status — no further updates will be made."
        : "Updated " + formatTrackTime(new Date()) + " · refreshes automatically"
    )
  );
  head.appendChild(headMain);
  head.appendChild(
    makeElement("span", "order-status order-status--" + statusMeta.modifier, statusMeta.label)
  );
  panel.appendChild(head);

  if (isRejected) {
    panel.appendChild(buildRejectionNotice(historyByStatus.rejected));
  } else {
    panel.appendChild(buildStages(status, isPickup, historyByStatus));

    if (isPickup) {
      panel.appendChild(buildPickupNote());
    }
  }

  const historyBlock = buildHistoryBlock(history);
  if (historyBlock) panel.appendChild(historyBlock);

  return panel;
}

function buildStages(status, isPickup, historyByStatus) {
  const labels = isPickup ? PICKUP_STAGE_LABELS : DELIVERY_STAGE_LABELS;
  const flowStatuses = isPickup ? PICKUP_STAGE_STATUSES : DELIVERY_STAGE_STATUSES;
  const currentIndex = flowStatuses.indexOf(status);

  const list = makeElement("ol", "track-stages");

  labels.forEach(function (label, index) {
    const state = getStageState(index, currentIndex, status);
    const stage = makeElement("li", "track-stage is-" + state);

    if (state === "current") {
      stage.setAttribute("aria-current", "step");
    }

    stage.appendChild(
      makeElement("span", "track-dot", state === "complete" ? "✓" : String(index + 1))
    );
    stage.lastChild.setAttribute("aria-hidden", "true");

    const body = makeElement("div", "track-stage-body");
    body.appendChild(makeElement("span", "track-stage-name", label));

    const stageStatus = flowStatuses[index];
    const changedAt = stageStatus ? historyByStatus[stageStatus] : null;
    if (changedAt) {
      body.appendChild(makeElement("span", "track-stage-time", formatTrackDateTime(changedAt)));
    }

    if (isPickup && label === "Ready Soon") {
      body.appendChild(
        makeElement(
          "span",
          "track-stage-note",
          "Collect from the restaurant once preparation is complete."
        )
      );
    }

    stage.appendChild(body);
    list.appendChild(stage);
  });

  return list;
}

function getStageState(index, currentIndex, status) {
  if (currentIndex === -1) return "pending";
  if (index < currentIndex) return "complete";
  if (index > currentIndex) return "pending";
  return status === "delivered" ? "complete" : "current";
}

function buildPickupNote() {
  const note = makeElement("p", "track-pickup-note");
  note.appendChild(makeElement("strong", "", "Pickup order. "));
  note.appendChild(
    document.createTextNode(
      "Please collect your order from Dera Karahi when preparation is complete. It stays marked as Delivered once you pick it up."
    )
  );
  return note;
}

function buildRejectionNotice(rejectedAt) {
  const notice = makeElement("div", "track-rejected");
  notice.setAttribute("role", "alert");

  const icon = makeElement("span", "track-rejected-icon", "!");
  icon.setAttribute("aria-hidden", "true");
  notice.appendChild(icon);

  notice.appendChild(makeElement("h3", "track-rejected-title", "We couldn't accept this order"));
  notice.appendChild(
    makeElement(
      "p",
      "track-rejected-text",
      "Sorry about that — the restaurant was unable to accept this order, so it won't be prepared."
    )
  );

  if (rejectedAt) {
    notice.appendChild(
      makeElement("p", "track-rejected-time", "Updated " + formatTrackDateTime(rejectedAt))
    );
  }

  const contact = makeElement("p", "track-rejected-contact");
  contact.appendChild(document.createTextNode("Questions? Call us at "));
  const phone = String((typeof CONFIG !== "undefined" && CONFIG.phone) || "");
  if (phone) {
    const phoneLink = makeElement("a", "track-contact-link", phone);
    phoneLink.href = "tel:" + phone.replace(/[^\d+]/g, "");
    contact.appendChild(phoneLink);
  } else {
    contact.appendChild(document.createTextNode("the restaurant"));
  }
  contact.appendChild(document.createTextNode("."));
  notice.appendChild(contact);

  return notice;
}

function buildHistoryBlock(history) {
  if (!history.length) return null;

  const wrap = makeElement("div", "track-history");
  wrap.appendChild(makeElement("h3", "track-history-title", "Status updates"));

  const list = makeElement("ul", "track-history-list");
  history.forEach(function (entry) {
    const meta = getTrackStatusMeta(normalizeStatus(entry.status));
    const item = makeElement("li", "track-history-item");
    item.appendChild(makeElement("span", "track-history-status", meta.label));
    item.appendChild(
      makeElement(
        "span",
        "track-history-time",
        formatTrackDateTime(entry.changed_at) || "Time unavailable"
      )
    );
    list.appendChild(item);
  });

  wrap.appendChild(list);
  return wrap;
}

function buildSummaryPanel(order, status, isPickup) {
  const panel = makeElement("section", "track-panel track-panel--summary");
  panel.appendChild(makeElement("h2", "track-panel-title", "Order Summary"));

  const statusMeta = getTrackStatusMeta(status);
  const typeLabel = isPickup ? "Pickup" : "Delivery";

  // Key details
  const meta = makeElement("div", "track-meta");
  appendMetaItem(meta, "Order No.", "#" + String(order.order_number ?? ""));
  appendMetaItem(meta, "Order Type", typeLabel);

  const statusItem = makeElement("div", "track-meta-item");
  statusItem.appendChild(makeElement("span", "track-meta-label", "Status"));
  const statusValue = makeElement("div", "track-meta-value");
  statusValue.appendChild(
    makeElement("span", "order-status order-status--" + statusMeta.modifier, statusMeta.label)
  );
  statusItem.appendChild(statusValue);
  meta.appendChild(statusItem);

  appendMetaItem(meta, "Placed", formatTrackDateTime(order.created_at) || "—");
  panel.appendChild(meta);

  // Items
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  const itemsList = makeElement("ul", "track-items");

  if (!items.length) {
    itemsList.appendChild(
      makeElement("li", "track-items-empty", "No items recorded for this order.")
    );
  } else {
    items.forEach(function (item) {
      const safeItem = item || {};
      const quantity = Math.max(0, Number(safeItem.quantity) || 0);
      const unitPrice = toTrackAmount(safeItem.unit_price, 0);

      const row = makeElement("li", "track-item");
      const info = makeElement("div", "track-item-info");
      info.appendChild(makeElement("span", "track-item-name", safeItem.name || "Item"));
      info.appendChild(
        makeElement(
          "span",
          "track-item-qty",
          quantity + " × " + formatPrice(unitPrice)
        )
      );

      row.appendChild(info);
      row.appendChild(
        makeElement("span", "track-item-total", formatPrice(unitPrice * quantity))
      );
      itemsList.appendChild(row);
    });
  }
  panel.appendChild(itemsList);

  // Totals
  const totals = makeElement("div", "order-totals");
  appendTotalRow(totals, "Subtotal", formatPrice(toTrackAmount(order.subtotal, 0)));

  const deliveryFee = toTrackAmount(order.delivery_fee, 0);
  appendTotalRow(totals, "Delivery fee", formatPrice(deliveryFee));

  const discount = toTrackAmount(order.discount, 0);
  appendTotalRow(
    totals,
    "Discount",
    discount > 0 ? "− " + formatPrice(discount) : formatPrice(0)
  );

  appendTotalRow(totals, "Total", formatPrice(toTrackAmount(order.total, 0)), "grand");
  panel.appendChild(totals);

  return panel;
}

function appendMetaItem(parent, label, value) {
  const item = makeElement("div", "track-meta-item");
  item.appendChild(makeElement("span", "track-meta-label", label));
  item.appendChild(makeElement("div", "track-meta-value", value));
  parent.appendChild(item);
}

function appendTotalRow(parent, label, value, modifier) {
  const row = makeElement(
    "div",
    "order-total-row" + (modifier ? " order-total-row--" + modifier : "")
  );
  row.appendChild(makeElement("span", "order-total-label", label));
  row.appendChild(
    makeElement(modifier === "grand" ? "strong" : "span", "order-total-value", value)
  );
  parent.appendChild(row);
}

function renderStateMessage(options) {
  const root = document.getElementById("trackRoot");
  if (!root) return;

  root.textContent = "";
  root.dataset.state = options.state || "error";

  const box = makeElement("div", "track-state");
  box.appendChild(makeElement("span", "track-state-emoji", options.emoji || "ℹ️"));
  box.appendChild(makeElement("h2", "track-state-title", options.title || "Something went wrong"));
  box.appendChild(makeElement("p", "track-state-text", options.message || ""));

  const actions = makeElement("div", "track-state-actions");

  if (options.retry) {
    const retryBtn = makeElement("button", "btn btn-primary", "Try again");
    retryBtn.type = "button";
    retryBtn.addEventListener("click", refreshOrder);
    actions.appendChild(retryBtn);
  }

  const menuLink = makeElement("a", "btn btn-ghost", "Browse Menu");
  menuLink.href = "index.html";
  actions.appendChild(menuLink);

  box.appendChild(actions);
  root.appendChild(box);
}

function showTransientBanner(message) {
  const root = document.getElementById("trackRoot");
  if (!root) return;

  if (!transientBanner || !root.contains(transientBanner)) {
    transientBanner = makeElement("div", "track-banner", message);
    transientBanner.setAttribute("role", "status");
    root.insertBefore(transientBanner, root.firstChild);
    return;
  }

  transientBanner.textContent = message;
}

/* ---------- Helpers ---------- */
function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function normalizeStatus(value) {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_") || "unknown"
  );
}

function getTrackStatusMeta(status) {
  return TRACK_STATUS_META[status] || { label: "Unknown", modifier: "unknown" };
}

function toTrackAmount(value, fallback) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

function sortTrackHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice().sort(function (a, b) {
    return toTrackTimestamp(a && a.changed_at) - toTrackTimestamp(b && b.changed_at);
  });
}

function toTrackTimestamp(value) {
  const date = value ? new Date(value) : null;
  const time = date && date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function indexHistoryByStatus(history) {
  const map = {};
  history.forEach(function (entry) {
    const status = normalizeStatus(entry && entry.status);
    if (!status || map[status]) return;
    map[status] = entry.changed_at;
  });
  return map;
}

function formatTrackDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTrackTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
