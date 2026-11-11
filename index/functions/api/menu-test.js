export async function onRequestGet({ env }) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/menu_items?select=id,name,price`,
    {
      headers: {
        apikey: env.SUPABASE_SECRET_KEY
      }
    }
  );

  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
