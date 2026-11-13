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

  // 4. Fetch real prices & availability from Supabase using service_role key
  const uniqueIds = Array.from(qtyById.keys());
  const inFilter = `(${uniqueIds.join(",")})`;
  const dbRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/menu_items?id=in.${inFilter}&select=id,name,price,is_available`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`
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

  // Day 10 return (Day 11 will save verifiedItems + order to Supabase)
  return Response.json({
    ok: true,
    subtotal,
    verified_items: verifiedItems
  });
}