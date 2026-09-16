import { validShop } from "./auth";
import { verifyHmac } from "./crypto";
import type { Env, ShopRow } from "./types";

export function createdAfterEnable(createdAt: unknown, enabledAt: string | null | undefined): boolean {
  return typeof createdAt === "string" && Boolean(enabledAt) &&
    Number.isFinite(Date.parse(createdAt)) && Date.parse(createdAt) > Date.parse(enabledAt!);
}

// Persist before queueing. A failed send returns 503 so Shopify retries the same work.
export async function orderCreatedWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (!await verifyHmac(raw, request.headers.get("X-Shopify-Hmac-Sha256"), env.SHOPIFY_API_SECRET)) {
    return new Response("Invalid signature", { status: 401 });
  }
  const domain = request.headers.get("X-Shopify-Shop-Domain")?.toLowerCase() ?? "";
  if (!validShop(domain) || request.headers.get("X-Shopify-Topic") !== "orders/create") {
    return new Response("Invalid webhook", { status: 400 });
  }
  let payload: { admin_graphql_api_id?: unknown; created_at?: unknown; name?: unknown };
  try { payload = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!payload || typeof payload.admin_graphql_api_id !== "string" || !/^gid:\/\/shopify\/Order\/\d+$/.test(payload.admin_graphql_api_id) ||
    typeof payload.created_at !== "string" || !Number.isFinite(Date.parse(payload.created_at))) {
    return new Response("Invalid order", { status: 400 });
  }
  const shop = await env.DB.prepare("SELECT * FROM shops WHERE shop_domain=? AND status='ACTIVE'").bind(domain).first<ShopRow>();
  if (!shop || !createdAfterEnable(payload.created_at, shop.automation_enabled_at)) return new Response(null, { status: 204 });
  try {
    await queueAutomaticOrder(shop, payload.admin_graphql_api_id, typeof payload.name === "string" ? payload.name : payload.admin_graphql_api_id,
      payload.created_at, env);
    console.info(JSON.stringify({ operation: "automatic_webhook", shopDomain: domain, status: "queued" }));
  } catch (error) {
    console.error(JSON.stringify({ operation: "automatic_webhook", shopDomain: domain, status: "failed",
      message: error instanceof Error ? error.message : "Unknown error" }));
    return new Response("Could not queue order", { status: 503 });
  }
  return new Response(null, { status: 204 });
}

async function queueAutomaticOrder(shop: ShopRow, orderId: string, orderName: string, createdAt: string, env: Env): Promise<void> {
  const timestamp = new Date().toISOString();
  const date = new Date(createdAt).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO jobs
      (id, shop_id, start_date, end_date, timezone, status, total_orders, created_at, updated_at, started_at, automation_enabled_at, automatic_order_id)
      VALUES (?, ?, ?, ?, ?, 'PROCESSING', 1, ?, ?, ?, ?, ?)`)
      .bind(`job_${crypto.randomUUID()}`, shop.id, date, date, shop.timezone, timestamp, timestamp, timestamp, shop.automation_enabled_at, orderId),
    env.DB.prepare(`INSERT OR IGNORE INTO job_orders
      (id, job_id, shop_id, shopify_order_id, order_name, status, updated_at)
      SELECT ?, id, shop_id, ?, ?, 'PENDING', ? FROM jobs WHERE shop_id=? AND automatic_order_id=?`)
      .bind(`jo_${crypto.randomUUID()}`, orderId, orderName, timestamp, shop.id, orderId),
  ]);
  const work = await env.DB.prepare("SELECT id, job_id, status FROM job_orders WHERE shop_id=? AND shopify_order_id=? AND job_id IN (SELECT id FROM jobs WHERE shop_id=? AND automatic_order_id=?)")
    .bind(shop.id, orderId, shop.id, orderId).first<{ id: string; job_id: string; status: string }>();
  if (!work) throw new Error("Could not persist automatic order");
  if (work.status === "PENDING") {
    await env.JOBS.send({ kind: "PROCESS", jobId: work.job_id, jobOrderId: work.id });
  }
}
