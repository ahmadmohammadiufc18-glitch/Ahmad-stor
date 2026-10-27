import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") ?? "https://ahmadmohammadiufc18-glitch.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const html = (title: string, message: string) => new Response(
  `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px sans-serif;max-width:650px;margin:12vh auto;padding:24px;line-height:2"><h1>${title}</h1><p>${message}</p><a href="${Deno.env.get("SITE_URL") ?? "/"}">بازگشت به احمد استور</a></body></html>`,
  { headers: { ...cors, "Content-Type": "text/html; charset=utf-8" } },
);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const merchantId = Deno.env.get("ZARINPAL_MERCHANT_ID");
  if (!url || !serviceKey || !merchantId) return html("خطای تنظیمات", "درگاه هنوز پیکربندی نشده است.");
  const params = new URL(req.url).searchParams;
  const authority = params.get("Authority");
  const status = params.get("Status");
  const orderId = params.get("order_id");
  if (!authority || !orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return html("پرداخت نامعتبر", "اطلاعات بازگشت پرداخت معتبر نیست.");

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: order, error } = await db.from("orders").select("id,status,total_toman,payment_authority").eq("id", orderId).maybeSingle();
  if (error || !order || order.payment_authority !== authority) return html("سفارش پیدا نشد", "اطلاعات سفارش با پرداخت مطابقت ندارد.");
  if (order.status === "paid") return html("پرداخت موفق", "این سفارش قبلاً تأیید شده است.");
  if (status !== "OK") {
    await db.from("orders").update({ status: "payment_failed" }).eq("id", order.id).eq("status", "pending_payment");
    return html("پرداخت تکمیل نشد", "بانک پرداخت را تأیید نکرد. اگر مبلغ کسر شده، با پشتیبانی تماس بگیر.");
  }

  let response: Response;
  try {
    response = await fetch("https://payment.zarinpal.com/pg/v4/payment/verify.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant_id: merchantId, amount: Number(order.total_toman) * 10, authority }),
    });
  } catch {
    return html("تأیید در حال بررسی", "ارتباط با درگاه برقرار نشد. لطفاً این صفحه را نگه دار و با پشتیبانی تماس بگیر.");
  }
  const result = await response.json().catch(() => null);
  const code = result?.data?.code;
  if (!response.ok || (code !== 100 && code !== 101)) {
    await db.from("orders").update({ status: "payment_failed" }).eq("id", order.id).eq("status", "pending_payment");
    return html("پرداخت تأیید نشد", "تأیید قطعی از درگاه دریافت نشد؛ سفارش نهایی نشده است.");
  }

  const refId = String(result.data.ref_id ?? "");
  const { data: updated, error: updateError } = await db.from("orders")
    .update({ status: "paid", payment_ref_id: refId, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", order.id).in("status", ["pending_payment", "payment_failed"]).select("id").maybeSingle();
  if (updateError) return html("پرداخت دریافت شد", "پرداخت توسط درگاه تأیید شد، اما به‌روزرسانی سفارش نیاز به بررسی پشتیبانی دارد.");
  return html("پرداخت موفق", "پرداخت شما تأیید شد. شماره سفارش: " + order.id + (updated ? "" : " (قبلاً پردازش شده)"));
});
