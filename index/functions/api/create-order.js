// Cloudflare Pages Function: POST /api/create-order
// Takes the cart from the browser, checks it, and returns the subtotal
// calculated from the prices stored in the database.

// Small helper so every response is JSON with the right content type.
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost({ request, env }) {
  // 1. Read the JSON body. Invalid JSON is a 400, not a crash.
  let order;
  try {
    order = await request.json();
  } catch (err) {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  // 2. Validate the order before touching the database.
  if (order === null || typeof order !== "object" || Array.isArray(order)) {
    return json({ error: "Request body must be a JSON object." }, 400);
  }

  const customerName = order.customer_name;
  const phone = order.phone;
  const orderType = order.order_type;
  const items = order.items;

  if (typeof customerName !== "string" || customerName.trim() === "") {
    return json({ error: "customer_name is required." }, 400);
  }

  // Phone must be 03 followed by exactly 9 digits (11 digits total).
  if (typeof phone !== "string" || !/^03\d{9}$/.test(phone)) {
    return json(
      { error: "phone must start with 03 and be followed by 9 digits." },
      400
    );
  }

  if (orderType !== "delivery" && orderType !== "pickup") {
    return json({ error: 'order_type must be "delivery" or "pickup".' }, 400);
  }

  if (!Array.isArray(items) || items.length === 0) {
    return json({ error: "items must be a non-empty array." }, 400);
  }

  const seenIds = new Set();

  for (const item of items) {
    // Each item must be an object with a whole-number id and qty 1-20.
    if (item === null || typeof item !== "object") {
      return json({ error: "Each item must be an object with id and qty." }, 400);
    }

    if (!Number.isInteger(item.id)) {
      return json({ error: "Each item id must be a whole number." }, 400);
    }

    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 20) {
      return json(
        { error: "Each item qty must be a whole number from 1 to 20." },
        400
      );
    }

    if (seenIds.has(item.id)) {
      return json({ error: "Item id " + item.id + " appears more than once." }, 400);
    }
    seenIds.add(item.id);
  }

  // 3. Fetch the requested items from Supabase (service key stays on the server).
  const idList = [...seenIds].join(",");
  const url =
    env.SUPABASE_URL +
    "/rest/v1/menu_items?select=id,name,price,is_available&id=in.(" +
    idList +
    ")";

  const supabaseRes = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
    },
  });

if (!supabaseRes.ok) {
  const detail = await supabaseRes.text();
  return json({ error: "Supabase said no", status: supabaseRes.status, detail: detail }, 500);
}

  const menuItems = await supabaseRes.json();

  // 4. Every requested id must exist and be available.
  const menuById = new Map();
  for (const menuItem of menuItems) {
    menuById.set(menuItem.id, menuItem);
  }

  for (const item of items) {
    const menuItem = menuById.get(item.id);

    if (!menuItem) {
      return json({ error: "Item " + item.id + " was not found." }, 400);
    }

    if (!menuItem.is_available) {
      return json(
        { error: "Item " + item.id + " (" + menuItem.name + ") is not available." },
        400
      );
    }
  }

  // 5. Subtotal uses ONLY the database price; any browser price is ignored.
  let subtotal = 0;
  for (const item of items) {
    const menuItem = menuById.get(item.id);
    const price = Number(menuItem.price);
    subtotal = subtotal + price * item.qty;
  }

  // Round to 2 decimals so floating point noise does not leak out.
  subtotal = Math.round(subtotal * 100) / 100;

  // 6. Nothing is saved yet, we just report the subtotal.
  return json({ subtotal: subtotal }, 200);
}
