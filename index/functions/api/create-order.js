// File: functions/api/create-order.js (Day 10 — Validate & Price)
const PK_PHONE_REGEX = /^(?:03\d{2}-?\d{7}|\+923\d{9})$/;

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Safely parse JSON body
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  // 2. Validate customer fields
  const customer_name = String(body.customer_name || "").trim();
  const rawPhone = String(body.phone || "").trim().replace(/\s+/g, "");
  const order_type = body.order_type;
  const address = String(body.address || "").trim();
  const notes = String(body.notes || "").trim().slice(0, 500);

  if (customer_name.length < 2 || customer_name.length > 100) {
    return Response.json({ error: "Please enter your full name (2-100 characters)." }, { status: 400 });
  }
  if (!PK_PHONE_REGEX.test(rawPhone)) {
    return Response.json(
      { error: "Please enter a valid Pakistani mobile number (e.g. 03001234567 or +923001234567)." },
      { status: 400 }
    );
  }
  if (order_type !== "delivery" && order_type !== "pickup") {
    return Response.json({ error: "order_type must be 'delivery' or 'pickup'." }, { status: 400 });
  }
  if (order_type === "delivery" && address.length < 5) {
    return Response.json({ error: "Delivery address is required for delivery orders." }, { status: 400 });
  }

  // 3. Validate cart items array & merge duplicate item IDs
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 30) {
    return Response.json({ error: "Cart must contain between 1 and 30 items." }, { status: 400 });
  }

  const qtyById = new Map();
  for (const entry of body.items) {
    const id = Number(entry?.id);
    const qty = Number(entry?.qty);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: `Invalid item id: ${entry?.id}` }, { status: 400 });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      return Response.json({ error: `Quantity for item #${id} must be a whole number between 1 and 20.` }, { status: 400 });
    }
    const mergedQty = (qtyById.get(id) || 0) + qty;
    if (mergedQty > 20) {
      return Response.json({ error: `Total quantity for item #${id} cannot exceed 20.` }, { status: 400 });
    }
    qtyById.set(id, mergedQty);
  }

  // 4. Fetch real prices & availability from Supabase using secret_role key
  const uniqueIds = Array.from(qtyById.keys());
  const inFilter = `(${uniqueIds.join(",")})`;
  const dbRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/menu_items?id=in.${inFilter}&select=id,name,price,is_available`,
    {
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
      }
    }
  );

  if (!dbRes.ok) {
    return Response.json({ error: "Database lookup failed." }, { status: 500 });
  }
  const dbItems = await dbRes.json();
  const dbMap = new Map(dbItems.map(item => [item.id, item]));

  // 5. Ensure every requested item exists AND is currently available
  let subtotal = 0;
  const verifiedItems = [];

  for (const [id, qty] of qtyById.entries()) {
    const dbItem = dbMap.get(id);
    if (!dbItem) {
      return Response.json({ error: `Menu item #${id} does not exist.` }, { status: 400 });
    }
    if (!dbItem.is_available) {
      return Response.json({ error: `Sorry, "${dbItem.name}" is currently sold out.` }, { status: 400 });
    }
    subtotal += dbItem.price * qty;
    verifiedItems.push({
      menu_item_id: dbItem.id,
      name: dbItem.name,
      unit_price: dbItem.price,
      quantity: qty
    });
  }

  // 6. Insert parent row into `orders` and ask PostgREST for the created row back
  const delivery_fee = 0; // Day 25 upgrades this to Haversine distance fee
  const discount = 0;     // Day 26 upgrades this to server-verified promo discount
  const tax = 0;
  const total = subtotal + delivery_fee + tax - discount;

  const supaHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };

  const orderRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
    method: "POST",
    headers: supaHeaders,
    body: JSON.stringify({
      customer_name,
      phone: rawPhone,
      order_type,
      address: order_type === "delivery" ? address : "",
      notes,
      subtotal,
      delivery_fee,
      tax,
      discount,
      total,
      status: "received"
    })
  });

if (!orderRes.ok) {
  const errText = await orderRes.text();
  console.error("Order insert failed:", errText);

  return Response.json(
    {
      error: "Could not save order.",
      details: errText
    },
    { status: 500 }
  );
}

  const [createdOrder] = await orderRes.json();

  // 7. Insert all `order_items` rows in one bulk POST using DB-verified names & prices
  const orderItemsPayload = verifiedItems.map(item => ({
    order_id: createdOrder.id,
    menu_item_id: item.menu_item_id,
    name: item.name,
    unit_price: item.unit_price,
    quantity: item.quantity
  }));

  const itemsRes = await fetch(`${env.SUPABASE_URL}/rest/v1/order_items`, {
    method: "POST",
    headers: supaHeaders,
    body: JSON.stringify(orderItemsPayload)
  });

  // 8. Compensating rollback: if order_items fails, delete the orphan order row!
  if (!itemsRes.ok) {
    const errText = await itemsRes.text();
    console.error("Order items insert failed, rolling back order:", errText);
    await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${createdOrder.id}`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
      }
    });
    return Response.json({ error: "Could not save order items." }, { status: 500 });
  }

  // 9. Return ONLY safe confirmation identifiers to the browser
  return Response.json(
    {
      ok: true,
      order_number: createdOrder.order_number,
      tracking_token: createdOrder.tracking_token,
      total: createdOrder.total
    },
    { status: 201 }
  );
}
