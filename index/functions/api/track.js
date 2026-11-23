// File: functions/api/track.js — Public read-only order tracking
const TRACKING_TOKEN_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Privacy: never expose phone, address, lat, lng, or user_id
const TRACK_SELECT =
  "order_number,order_type,status,subtotal,delivery_fee,discount,total,created_at," +
  "order_items(name,quantity,unit_price),order_status_history(status,changed_at)";

// Every response is uncached: order status changes at any moment
function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet({ request, env }) {
  // 1. Read the tracking token from the query string
  const token = new URL(request.url).searchParams.get("token");

  // 2. Reject missing or malformed tokens before touching the database
  if (!token || !TRACKING_TOKEN_REGEX.test(token)) {
    return jsonResponse({ error: "Invalid tracking token" }, 400);
  }

  // 3. Fail fast (and quietly) when the deployment is misconfigured
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    console.error("Tracking lookup skipped: Supabase environment is not configured.");
    return jsonResponse({ error: "Tracking is temporarily unavailable." }, 500);
  }

  // 4. Read-only lookup by tracking_token (never writes)
  const dbRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?tracking_token=eq.${token}&select=${TRACK_SELECT}`,
    {
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
      }
    }
  );

  if (!dbRes.ok) {
    console.error("Tracking lookup failed:", await dbRes.text());
    return jsonResponse({ error: "Database lookup failed." }, 500);
  }

  // 5. No matching row
  const rows = await dbRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ error: "Order not found" }, 404);
  }

  // 6. Timeline must read oldest-first (Received → Delivered)
  const order = rows[0];
  order.order_status_history = (order.order_status_history || [])
    .slice()
    .sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)));

  // 7. Always serve fresh status to the browser
  return jsonResponse({ order });
}
