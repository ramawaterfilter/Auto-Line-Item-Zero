import { accessToken, validShop } from "./auth";
import { verifyHmac } from "./crypto";
import { discoverOrderPage } from "./shopify";
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

// The webhook is the fast path. This scan catches deliveries Shopify missed or could not complete.
export async function reconcileAutomaticOrders(env: Env): Promise<void> {
  const shops = await env.DB.prepare("SELECT * FROM shops WHERE status='ACTIVE' AND automation_enabled_at IS NOT NULL")
    .all<ShopRow>();
  for (const shop of shops.results) {
    try {
      await reconcileShop(shop, env);
    } catch (error) {
      console.error(JSON.stringify({ operation: "automatic_reconciliation", shopDomain: shop.shop_domain,
        status: "failed", message: error instanceof Error ? error.message : "Unknown error" }));
    }
  }
}

async function reconcileShop(shop: ShopRow, env: Env): Promise<void> {
  if (!shop.automation_enabled_at) return;
  const until = new Date(Date.now() - 2 * 60_000).toISOString();
  if (Date.parse(until) <= Date.parse(shop.automation_enabled_at)) return;
  // Revisit recent results because Shopify order search can lag behind order creation.
  const from = shop.automation_checked_through
    ? new Date(Math.max(Date.parse(shop.automation_enabled_at), Date.parse(shop.automation_checked_through) - 15 * 60_000)).toISOString()
    : shop.automation_enabled_at;
  const token = await accessToken(shop, env);
  const query = `created_at:>="${from}" created_at:<="${until}"`;
  let cursor: string | null = null;
  let scanned = 0;
  do {
    const page = await discoverOrderPage(shop.shop_domain, token, env, query, cursor);
    for (const order of page.nodes) {
      scanned++;
      if (createdAfterEnable(order.createdAt, shop.automation_enabled_at) && Date.parse(order.createdAt) <= Date.parse(until)) {
        await queueAutomaticOrder(shop, order.id, order.name, order.createdAt, env);
      }
    }
    if (!page.pageInfo.hasNextPage) break;
    if (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor) throw new Error("Order search returned an invalid cursor");
    cursor = page.pageInfo.endCursor;
  } while (true);
  await env.DB.prepare("UPDATE shops SET automation_checked_through=? WHERE id=? AND automation_enabled_at=?")
    .bind(until, shop.id, shop.automation_enabled_at).run();
  console.info(JSON.stringify({ operation: "automatic_reconciliation", shopDomain: shop.shop_domain,
    status: "completed", scanned, checkedThrough: until }));
}
