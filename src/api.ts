import { authenticatedStaff, StaffAuthError } from "./auth";
import { etaSeconds, ValidationError, validateDateRange } from "./core";
import { refreshJob } from "./processor";
import { validateAuditSheet } from "./sheets";
import type { Env, JobOrderRow, JobRow, ShopRow } from "./types";

export async function api(request: Request, env: Env): Promise<Response> {
  let staff;
  try { staff = await authenticatedStaff(request, env); }
  catch (error) {
    if (!(error instanceof StaffAuthError)) throw error;
    return Response.json({ error: error.message }, { status: error.status, headers: {
      "Cache-Control": "no-store", ...(error.retrySession ? { "X-Shopify-Retry-Invalid-Session-Request": "1" } : {}),
    } });
  }
  if (!staff) return Response.json({ error: request.headers.has("Authorization")
    ? "Shopify session could not be verified. Reopen the app from Shopify Admin → Apps. If this persists, check that the deployed app credentials match the installed app."
    : "Shopify session is missing. Open this app from Shopify Admin → Apps, then reload." }, {
    status: 401,
    headers: { "Cache-Control": "no-store", ...(request.headers.has("Authorization") ? { "X-Shopify-Retry-Invalid-Session-Request": "1" } : {}) },
  });
  const shop = staff.shop;
  const url = new URL(request.url);
  if (request.method !== "GET" && !sameOrigin(request, env)) return json({ error: "Invalid request origin" }, 403);

  if (request.method === "GET" && url.pathname === "/api/session") {
    return json({ shop: shop.shop_domain, staff: staff.user, timezone: shop.timezone, scopes: shop.scopes.split(","), targetVariants: env.TARGET_VARIANT_IDS.split(",") });
  }
  if (request.method === "POST" && url.pathname === "/api/jobs") return createJob(request, shop, env);
  if (url.pathname === "/api/automation") {
    if (request.method === "PUT") {
      let body: { enabled?: unknown };
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      if (!body || typeof body.enabled !== "boolean") return json({ error: "enabled must be a boolean" }, 400);
      if (body.enabled) {
        try { await validateAuditSheet(env); }
        catch (error) { return json({ error: error instanceof Error ? error.message : "Google Sheets validation failed" }, 502); }
      }
      await env.DB.prepare(`UPDATE shops SET automation_enabled_at=CASE WHEN ?=1 THEN COALESCE(automation_enabled_at, ?) ELSE NULL END,
        updated_at=? WHERE id=? AND status='ACTIVE'`)
        .bind(body.enabled ? 1 : 0, new Date().toISOString(), new Date().toISOString(), shop.id).run();
    } else if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const settings = await env.DB.prepare("SELECT automation_enabled_at FROM shops WHERE id=? AND status='ACTIVE'")
      .bind(shop.id).first<{ automation_enabled_at: string | null }>();
    const jobs = await env.DB.prepare(`SELECT id, status, last_order_name, success_count, skipped_count, failed_count, created_at
      FROM jobs WHERE shop_id=? AND automatic_order_id IS NOT NULL ORDER BY created_at DESC LIMIT 20`)
      .bind(shop.id).all();
    return json({ enabled: Boolean(settings?.automation_enabled_at), enabledAt: settings?.automation_enabled_at ?? null, jobs: jobs.results });
  }
  const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(retry-failed|cancel|errors|orders|process))?$/);
  if (!match) return json({ error: "Not found" }, 404);
  const jobId = match[1]!;
  const action = match[2];
  if (!/^job_[0-9a-f-]{36}$/.test(jobId)) return json({ error: "Invalid job ID" }, 400);
  if (request.method === "GET" && !action) return getJob(jobId, shop, env);
  if (request.method === "GET" && action === "orders") return getOrders(jobId, shop, env);
  if (request.method === "GET" && action === "errors") return getErrors(jobId, shop, env);
  if (request.method === "POST" && action === "process") return processSelected(request, jobId, shop, env);
  if (request.method === "POST" && action === "retry-failed") return retryFailed(jobId, shop, env);
  if (request.method === "POST" && action === "cancel") return cancelJob(jobId, shop, env);
  return json({ error: "Method not allowed" }, 405);
}

async function createJob(request: Request, shop: ShopRow, env: Env): Promise<Response> {
  let body: { startDate?: unknown; endDate?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  try {
    validateDateRange(body.startDate, body.endDate, Number(env.MAX_DATE_RANGE_DAYS));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400);
  }
  const id = `job_${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO jobs (id, shop_id, start_date, end_date, timezone, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`)
    .bind(id, shop.id, body.startDate, body.endDate, shop.timezone, timestamp, timestamp).run();
  try { await env.JOBS.send({ kind: "DISCOVER", jobId: id }); }
  catch { await env.DB.prepare("UPDATE jobs SET status='FAILED', updated_at=? WHERE id=? AND shop_id=?").bind(new Date().toISOString(), id, shop.id).run(); return json({ error: "Could not queue the job" }, 503); }
  return json({ jobId: id, status: "PENDING" }, 202);
}

async function getJob(id: string, shop: ShopRow, env: Env): Promise<Response> {
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE id=? AND shop_id=?").bind(id, shop.id).first<JobRow>();
  if (!job) return json({ error: "Job not found" }, 404);
  const remaining = Math.max(0, job.total_orders - job.processed_orders);
  return json({
    jobId: job.id, status: job.status, totalOrders: job.total_orders, eligibleOrders: job.eligible_orders,
    selectionReady: Boolean(job.selection_ready),
    processedOrders: job.processed_orders, successCount: job.success_count, skippedCount: job.skipped_count,
    failedCount: job.failed_count, remaining,
    progressPercent: job.total_orders ? Math.round(job.processed_orders / job.total_orders * 1000) / 10 : 0,
    etaSeconds: etaSeconds(job.processed_orders, job.total_orders, job.rolling_avg_ms),
    startedAt: job.started_at, completedAt: job.completed_at, lastOrder: job.last_order_name,
    errorMessage: job.error_message,
  });
}

async function getOrders(id: string, shop: ShopRow, env: Env): Promise<Response> {
  const job = await env.DB.prepare("SELECT status, selection_ready FROM jobs WHERE id=? AND shop_id=?").bind(id, shop.id)
    .first<{ status: string; selection_ready: number }>();
  if (!job) return json({ error: "Job not found" }, 404);
  if (!job.selection_ready || job.status !== "PENDING") return json({ error: "Order preview is not ready" }, 409);
  const rows = await env.DB.prepare(`SELECT id, order_name, snapshot_json FROM job_orders
    WHERE job_id=? AND shop_id=? AND eligible=1 AND status='PENDING' ORDER BY order_name`).bind(id, shop.id)
    .all<Pick<JobOrderRow, "id" | "order_name" | "snapshot_json">>();
  return json({ orders: rows.results.map((row) => {
    const snapshot = JSON.parse(row.snapshot_json ?? "{}") as { orderCreatedAt?: string; orderTotalBefore?: string; lines?: Array<{ variantId: string; productTitle: string; variantTitle: string; quantityBefore: number }> };
    return { id: row.id, orderName: row.order_name, createdAt: snapshot.orderCreatedAt, total: snapshot.orderTotalBefore, lines: snapshot.lines ?? [] };
  }) });
}

export function selectedOrderIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 10_000) return null;
  const ids = [...new Set(value)];
  return ids.every((id): id is string => typeof id === "string" && /^jo_[0-9a-f-]{36}$/.test(id)) ? ids : null;
}

async function processSelected(request: Request, id: string, shop: ShopRow, env: Env): Promise<Response> {
  let body: { orderIds?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const requested = selectedOrderIds(body.orderIds);
  if (!requested) return json({ error: "Select at least one valid order" }, 400);
  const job = await env.DB.prepare("SELECT status, selection_ready FROM jobs WHERE id=? AND shop_id=?").bind(id, shop.id)
    .first<{ status: string; selection_ready: number }>();
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status !== "PENDING" || !job.selection_ready) return json({ error: "Job is not ready for selection" }, 409);
  const candidates = await env.DB.prepare("SELECT id FROM job_orders WHERE job_id=? AND shop_id=? AND eligible=1 AND status='PENDING'")
    .bind(id, shop.id).all<{ id: string }>();
  const available = new Set(candidates.results.map((row) => row.id));
  if (requested.some((orderId) => !available.has(orderId))) return json({ error: "Selection contains an unavailable order" }, 400);
  try { await validateAuditSheet(env); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Google Sheets validation failed" }, 502); }
  const selected = new Set(requested);
  const unselected = candidates.results.filter((row) => !selected.has(row.id));
  const deletions = [];
  for (let index = 0; index < unselected.length; index += 100) {
    const ids = unselected.slice(index, index + 100).map((row) => row.id);
    deletions.push(env.DB.prepare(`DELETE FROM job_orders WHERE job_id=? AND shop_id=? AND status='PENDING' AND id IN (${ids.map(() => "?").join(",")})`)
      .bind(id, shop.id, ...ids));
  }
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    ...deletions,
    env.DB.prepare(`UPDATE jobs SET status='PROCESSING', selection_ready=0, error_message=NULL, total_orders=?, eligible_orders=?,
      processed_orders=0, success_count=0, skipped_count=0, failed_count=0, completed_at=NULL, updated_at=? WHERE id=? AND shop_id=?`)
      .bind(requested.length, requested.length, timestamp, id, shop.id),
  ]);
  try {
    for (let index = 0; index < requested.length; index += 100) {
      await env.JOBS.sendBatch(requested.slice(index, index + 100).map((orderId) => ({ body: { kind: "PROCESS" as const, jobId: id, jobOrderId: orderId } })));
    }
  } catch {
    await env.DB.prepare("UPDATE jobs SET status='FAILED', updated_at=? WHERE id=? AND shop_id=?").bind(new Date().toISOString(), id, shop.id).run();
    return json({ error: "Could not queue the selected orders" }, 503);
  }
  return json({ jobId: id, selected: requested.length, status: "PROCESSING" }, 202);
}

async function getErrors(id: string, shop: ShopRow, env: Env): Promise<Response> {
  if (!await ownsJob(id, shop.id, env)) return json({ error: "Job not found" }, 404);
  const rows = await env.DB.prepare(`SELECT id, order_name, status, attempts, error_message FROM job_orders
    WHERE job_id=? AND shop_id=? AND status IN ('FAILED','AUDIT_AFTER_FAILED') ORDER BY updated_at DESC LIMIT 100`)
    .bind(id, shop.id).all<Pick<JobOrderRow, "id" | "order_name" | "status" | "attempts" | "error_message">>();
  return json({ errors: rows.results.map((row) => ({ jobOrderId: row.id, orderName: row.order_name, status: row.status, attempts: row.attempts, message: row.error_message ?? "Unknown error" })) });
}

async function retryFailed(id: string, shop: ShopRow, env: Env): Promise<Response> {
  if (!await ownsJob(id, shop.id, env)) return json({ error: "Job not found" }, 404);
  const rows = await env.DB.prepare("SELECT id FROM job_orders WHERE job_id=? AND shop_id=? AND status IN ('FAILED','AUDIT_AFTER_FAILED')")
    .bind(id, shop.id).all<{ id: string }>();
  if (rows.results.length) {
    await env.DB.prepare("UPDATE jobs SET status='PROCESSING', completed_at=NULL, updated_at=? WHERE id=? AND shop_id=?")
      .bind(new Date().toISOString(), id, shop.id).run();
    for (let i = 0; i < rows.results.length; i += 100) {
      await env.JOBS.sendBatch(rows.results.slice(i, i + 100).map((row) => ({ body: { kind: "PROCESS" as const, jobId: id, jobOrderId: row.id } })));
    }
  }
  return json({ jobId: id, requeued: rows.results.length });
}

async function cancelJob(id: string, shop: ShopRow, env: Env): Promise<Response> {
  if (!await ownsJob(id, shop.id, env)) return json({ error: "Job not found" }, 404);
  const timestamp = new Date().toISOString();
  await env.DB.prepare("UPDATE jobs SET status='CANCELLING', updated_at=? WHERE id=? AND shop_id=? AND status IN ('PENDING','DISCOVERING','PROCESSING')")
    .bind(timestamp, id, shop.id).run();
  await env.DB.prepare("UPDATE job_orders SET status='CANCELLED', completed_at=?, updated_at=? WHERE job_id=? AND shop_id=? AND status IN ('PENDING','FAILED')")
    .bind(timestamp, timestamp, id, shop.id).run();
  await refreshJob(id, shop.id, env);
  return json({ jobId: id, status: "CANCELLING" });
}

async function ownsJob(id: string, shopId: string, env: Env): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 ok FROM jobs WHERE id=? AND shop_id=?").bind(id, shopId).first());
}

function sameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(env.SHOPIFY_APP_URL).origin);
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
