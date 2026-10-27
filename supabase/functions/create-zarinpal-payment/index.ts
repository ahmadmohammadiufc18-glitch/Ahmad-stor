import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") ?? "https://ahmadmohammadiufc18-glitch.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const rial = (toman: number) => Math.round(toman * 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const merchantId = Deno.env.get("ZARINPAL_MERCHANT_ID");
  const siteUrl = Deno.env.get("SITE_URL");
  if (!url || !serviceKey || !merchantId || !siteUrl) return reply({ error: "payment_not_configured" }, 503);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply({ error: "authentication_required" }, 401);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const token = authHeader.slice(7);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return reply({ error: "invalid_session" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "invalid_json" }, 400); }
  const customerName = String(body.customer_name ?? "").trim().slice(0, 100);
  const customerPhone = String(body.customer_phone ?? "").trim().slice(0, 20);
  const address = String(body.shipping_address ?? "").trim().slice(0, 1000);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!customerName || !customerPhone || !address || rawItems.length < 1 || rawItems.length > 30) {
    return reply({ error: "customer_and_items_required" }, 400);
  }

  const quantities = new Map<number, number>();
  for (const item of rawItems) {
    const id = Number(item.product_id);
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      return reply({ error: "invalid_item" }, 400);
    }
    quantities.set(id, (quantities.get(id) ?? 0) + quantity);
  }
  const ids = [...quantities.keys()];
  if (ids.length > 30) return reply({ error: "too_many_items" }, 400);

  const { data: products, error: productsError } = await supabase.from("products")
    .select("id,name,price_toman,active,stock").in("id", ids);
  if (productsError || !products || products.length !== ids.length) return reply({ error: "product_unavailable" }, 400);

  let totalToman = 0;
  const lines: any[] = [];
  for (const p of products) {
    const quantity = quantities.get(Number(p.id))!;
    if (!p.active || p.stock < quantity) return reply({ error: "out_of_stock", product: p.name }, 409);
    totalToman += Number(p.price_toman) * quantity;
    lines.push({ product_id: p.id, product_name: p.name, unit_price_toman: p.price_toman, quantity, line_total_toman: Number(p.price_toman) * quantity });
  }
  if (!Number.isSafeInteger(totalToman) || totalToman < 1000 || totalToman > 500_000_000) {
    return reply({ error: "invalid_total" }, 400);
  }

  const { data: order, error: orderError } = await supabase.from("orders").insert({
    user_id: authData.user.id, status: "pending_payment", currency: "IRR",
    subtotal_toman: totalToman, total_toman: totalToman,
    customer_name: customerName, customer_phone: customerPhone, shipping_address: address,
    payment_provider: "zarinpal",
  }).select("id").single();
  if (orderError || !order) return reply({ error: "order_create_failed" }, 500);

  const { error: itemsError } = await supabase.from("order_items").insert(lines.map(line => ({ ...line, order_id: order.id })));
  if (itemsError) {
    await supabase.from("orders").delete().eq("id", order.id);
    return reply({ error: "order_items_create_failed" }, 500);
  }

  const callback = url.replace(/\/$/, "") + "/functions/v1/verify-zarinpal-payment";
  let gatewayResponse: Response;
  try {
    gatewayResponse = await fetch("https://payment.zarinpal.com/pg/v4/payment/request.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId, amount: rial(totalToman),
        callback_url: callback + "?order_id=" + encodeURIComponent(order.id),
        description: "خرید از احمد استور - سفارش " + order.id,
        metadata: { email: authData.user.email ?? "", mobile: customerPhone },
      }),
    });
  } catch {
    await supabase.from("orders").update({ status: "payment_failed" }).eq("id", order.id);
    return reply({ error: "gateway_unreachable" }, 502);
  }
  const gateway = await gatewayResponse.json().catch(() => null);
  const data = gateway?.data;
  if (!gatewayResponse.ok || data?.code !== 100 || !data?.authority) {
    await supabase.from("orders").update({ status: "payment_failed" }).eq("id", order.id);
    return reply({ error: "gateway_request_failed", code: data?.code ?? null }, 502);
  }
  const { error: updateError } = await supabase.from("orders")
    .update({ payment_authority: data.authority }).eq("id", order.id);
  if (updateError) return reply({ error: "payment_tracking_failed", order_id: order.id }, 500);

  return reply({
    order_id: order.id,
    payment_url: "https://www.zarinpal.com/pg/StartPay/" + encodeURIComponent(data.authority),
  }, 201);
});
