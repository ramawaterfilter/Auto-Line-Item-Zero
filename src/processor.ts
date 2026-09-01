import { accessToken } from "./auth";
import { numericId, PermanentError, retryDelay, RetryableError, targetIds, zonedDateBoundary } from "./core";
import { discoverOrderPage, editTargetQuantities, fetchOrder, matchingLines, positiveMatchingLines } from "./shopify";
import { writeRows } from "./sheets";
import { runDestructiveFlow } from "./safety";
import type { AuditLine, Env, JobOrderRow, JobRow, OrderSnapshot, ShopRow } from "./types";

interface WorkContext {
  job: JobRow;
  order: JobOrderRow;
  shop: ShopRow;
}

interface ProcessResult { editId: string; totalAfter: string }

export async function discover(jobId: string, env: Env): Promise<void> {
  const row = await env.DB.prepare(`SELECT j.*, s.shop_domain, s.access_token_ciphertext, s.access_token_iv,
    s.refresh_token_ciphertext, s.refresh_token_iv, s.token_expires_at, s.refresh_token_expires_at,
    s.scopes, s.status AS shop_status, s.timezone AS shop_timezone
    FROM jobs j JOIN shops s ON s.id=j.shop_id WHERE j.id=?`).bind(jobId).first<Record<string, unknown>>();
  if (!row || row.status === "CANCELLED" || row.status === "CANCELLING" || row.status === "COMPLETED") return;
  const job = row as unknown as JobRow;
  const shop = joinedShop(row);
  const token = await accessToken(shop, env);
  await env.DB.prepare("UPDATE jobs SET status='DISCOVERING', error_message=NULL, started_at=COALESCE(started_at, ?), updated_at=? WHERE id=? AND shop_id=?")
    .bind(now(), now(), job.id, shop.id).run();
  const query = `created_at:>=${zonedDateBoundary(job.start_date, job.timezone)} created_at:<=${zonedDateBoundary(job.end_date, job.timezone, true)}`;
  const page = await discoverOrderPage(shop.shop_domain, token, env, query, job.discovery_cursor);
  const currentJob = await env.DB.prepare("SELECT status FROM jobs WHERE id=? AND shop_id=?").bind(job.id, shop.id).first<{ status: string }>();
  if (!currentJob || currentJob.status === "CANCELLING" || currentJob.status === "CANCELLED") {
    await refreshJob(job.id, shop.id, env);
    return;
  }
  const targets = targetIds(env.TARGET_VARIANT_IDS);
  const previews: Array<{ order: Awaited<ReturnType<typeof fetchOrder>>; snapshot: OrderSnapshot }> = [];
  for (const reference of page.nodes) {
    const order = await fetchOrder(shop.shop_domain, token, env, reference.id);
    if (!order || order.cancelledAt) continue;
    const lines = positiveMatchingLines(order.lineItems.nodes, targets);
    if (!lines.length) continue;
    previews.push({ order, snapshot: snapshotFor(order, lines) });
  }
  if (previews.length) {
    await env.DB.batch(previews.map(({ order, snapshot }) => env.DB.prepare(`INSERT OR IGNORE INTO job_orders
      (id, job_id, shop_id, shopify_order_id, order_name, eligible, status, snapshot_json, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 'PENDING', ?, ?)`)
      .bind(`jo_${crypto.randomUUID()}`, job.id, shop.id, order!.id, order!.name, JSON.stringify(snapshot), now())));
  }
  await env.DB.prepare(`UPDATE jobs SET discovery_cursor=?, total_orders=(SELECT COUNT(*) FROM job_orders WHERE job_id=? AND shop_id=?),
    eligible_orders=(SELECT COUNT(*) FROM job_orders WHERE job_id=? AND shop_id=? AND eligible=1),
    status=?, selection_ready=?, updated_at=? WHERE id=? AND shop_id=?`)
    .bind(page.pageInfo.endCursor, job.id, shop.id, job.id, shop.id, page.pageInfo.hasNextPage ? "DISCOVERING" : "PENDING",
      page.pageInfo.hasNextPage ? 0 : 1, now(), job.id, shop.id).run();
  if (page.pageInfo.hasNextPage) {
    try { await env.JOBS.send({ kind: "DISCOVER", jobId: job.id }); }
    catch { throw new RetryableError("Could not queue the next discovery page"); }
  }
}

export async function processOrder(jobId: string, jobOrderId: string, env: Env, deliveryAttempt = 5): Promise<void> {
  const context = await loadContext(jobId, jobOrderId, env);
  if (!context || ["SUCCESS", "SKIPPED", "CANCELLED"].includes(context.order.status)) return;
  if (["CANCELLING", "CANCELLED"].includes(context.job.status) && context.order.status !== "PROCESSING") {
    await env.DB.prepare("UPDATE job_orders SET status='CANCELLED', completed_at=?, updated_at=? WHERE id=? AND shop_id=?")
      .bind(now(), now(), context.order.id, context.shop.id).run();
    await refreshJob(context.job.id, context.shop.id, env);
    return;
  }
  const claimed = await env.DB.prepare(`UPDATE job_orders SET status='PROCESSING', attempts=attempts+1,
    started_at=COALESCE(started_at, ?), error_message=NULL, updated_at=?
    WHERE id=? AND job_id=? AND shop_id=? AND (
      status IN ('PENDING','FAILED','AUDIT_AFTER_FAILED') OR (status='PROCESSING' AND updated_at < ?)
    )`).bind(now(), now(), context.order.id, context.job.id, context.shop.id, new Date(Date.now() - 10 * 60_000).toISOString()).run();
  if (!claimed.meta.changes) return;

  const started = Date.now();
  try {
    const current = await loadContext(jobId, jobOrderId, env);
    if (!current) return;
    if (current.order.result_json) {
      await writeAfter(current, JSON.parse(current.order.result_json) as ProcessResult, env);
      await finishOrder(current, "SUCCESS", started, env);
      return;
    }
    const token = await accessToken(current.shop, env);
    const order = await fetchOrder(current.shop.shop_domain, token, env, current.order.shopify_order_id);
    if (!order) throw new PermanentError("Order no longer exists or is inaccessible");
    const targets = targetIds(env.TARGET_VARIANT_IDS);
    const targetLines = matchingLines(order.lineItems.nodes, targets);
    await env.DB.prepare("UPDATE job_orders SET eligible=?, order_name=?, updated_at=? WHERE id=? AND shop_id=?")
      .bind(targetLines.length ? 1 : 0, order.name, now(), current.order.id, current.shop.id).run();
    if (order.cancelledAt) {
      await finishOrder(current, "SKIPPED", started, env, "Cancelled order");
      return;
    }
    const positive = targetLines.filter((line) => line.quantity > 0);
    if (!positive.length) {
      if (current.order.before_audit_status === "WRITTEN" && current.order.snapshot_json) {
        const result = { editId: current.order.shopify_order_edit_id ?? "reconciled", totalAfter: order.totalPriceSet.shopMoney.amount };
        await saveResult(current, result, env);
        const reloaded = await loadContext(jobId, jobOrderId, env);
        if (!reloaded) return;
        await writeAfter(reloaded, result, env);
        await finishOrder(reloaded, "SUCCESS", started, env);
      } else {
        await finishOrder(current, "SKIPPED", started, env, targetLines.length ? "Already processed" : "No target variants");
      }
      return;
    }

    const snapshot = snapshotFor(order, positive);
    const withBefore = await ensureBeforeReservation(current, snapshot, env);
    const normalized = await runDestructiveFlow<ProcessResult>({
      before: async () => {
        await writeBefore(withBefore, snapshot, env);
        await env.DB.prepare("UPDATE job_orders SET before_audit_status='WRITTEN', updated_at=? WHERE id=? AND shop_id=?")
          .bind(now(), withBefore.order.id, withBefore.shop.id).run();
      },
      mutate: async () => {
        const result = await editTargetQuantities(withBefore.shop.shop_domain, token, env, order.id, targets);
        return { editId: result.editId, totalAfter: result.total };
      },
      recordCommit: (result) => saveResult(withBefore, result, env),
      after: async (result) => {
        const reloaded = await loadContext(jobId, jobOrderId, env);
        if (!reloaded) throw new PermanentError("Order state disappeared after commit");
        await writeAfter(reloaded, result, env);
      },
    });
    const completed = await loadContext(jobId, jobOrderId, env);
    if (!completed) throw new PermanentError(`Order state disappeared after ${normalized.editId}`);
    await finishOrder(completed, "SUCCESS", started, env);
  } catch (error) {
    const latest = await loadContext(jobId, jobOrderId, env);
    if (!latest) throw error;
    const afterCommit = Boolean(latest.order.result_json);
    const finalAttempt = deliveryAttempt >= 5 || !(error instanceof RetryableError);
    const status = finalAttempt ? (afterCommit ? "AUDIT_AFTER_FAILED" : "FAILED") : "PENDING";
    await env.DB.prepare("UPDATE job_orders SET status=?, error_message=?, updated_at=? WHERE id=? AND shop_id=?")
      .bind(status, safeError(error), now(), latest.order.id, latest.shop.id).run();
    await refreshJob(latest.job.id, latest.shop.id, env);
    if (error instanceof RetryableError) throw error;
  }
}

function snapshotFor(order: NonNullable<Awaited<ReturnType<typeof fetchOrder>>>, lines: ReturnType<typeof matchingLines>): OrderSnapshot {
  return {
    orderId: order.id,
    orderName: order.name,
    orderCreatedAt: order.createdAt,
    customerEmail: order.email ?? "",
    orderTotalBefore: order.totalPriceSet.shopMoney.amount,
    lines: lines.map((line): AuditLine => ({
      variantId: numericId(line.variant!.id), productTitle: line.variant!.product.title, variantTitle: line.variant!.title,
      sku: line.sku ?? "", quantityBefore: line.quantity, unitPrice: line.originalUnitPriceSet.shopMoney.amount, lineItemId: line.id,
    })),
  };
}

async function ensureBeforeReservation(context: WorkContext, snapshot: OrderSnapshot, env: Env): Promise<WorkContext> {
  if (!context.order.before_row_start) {
    const start = await reserveRows("BEFORE", snapshot.lines.length, env);
    await env.DB.prepare(`UPDATE job_orders SET before_row_start=?, audit_row_count=?, snapshot_json=?,
      before_audit_status='RESERVED', updated_at=? WHERE id=? AND shop_id=?`)
      .bind(start, snapshot.lines.length, JSON.stringify(snapshot), now(), context.order.id, context.shop.id).run();
  }
  return (await loadContext(context.job.id, context.order.id, env))!;
}

async function writeBefore(context: WorkContext, snapshot: OrderSnapshot, env: Env): Promise<void> {
  if (!context.order.before_row_start) throw new Error("BEFORE row was not reserved");
  const timestamp = now();
  await writeRows(env, "BEFORE", context.order.before_row_start, snapshot.lines.map((line) => [
    timestamp, context.shop.shop_domain, context.job.id, numericId(snapshot.orderId), snapshot.orderName,
    snapshot.orderCreatedAt, snapshot.customerEmail, line.variantId, line.productTitle, line.variantTitle, line.sku,
    line.quantityBefore, line.unitPrice, numericId(line.lineItemId), snapshot.orderTotalBefore, "RECORDED",
  ]));
}

async function saveResult(context: WorkContext, result: ProcessResult, env: Env): Promise<void> {
  await env.DB.prepare("UPDATE job_orders SET result_json=?, shopify_order_edit_id=?, after_audit_status='PENDING', updated_at=? WHERE id=? AND shop_id=?")
    .bind(JSON.stringify(result), result.editId, now(), context.order.id, context.shop.id).run();
}

async function writeAfter(context: WorkContext, result: ProcessResult, env: Env): Promise<void> {
  if (!context.order.snapshot_json) throw new PermanentError("Missing BEFORE snapshot for AFTER reconciliation");
  const snapshot = JSON.parse(context.order.snapshot_json) as OrderSnapshot;
  let start = context.order.after_row_start;
  if (!start) {
    start = await reserveRows("AFTER", snapshot.lines.length, env);
    await env.DB.prepare("UPDATE job_orders SET after_row_start=?, after_audit_status='RESERVED', updated_at=? WHERE id=? AND shop_id=?")
      .bind(start, now(), context.order.id, context.shop.id).run();
  }
  const timestamp = now();
  await writeRows(env, "AFTER", start, snapshot.lines.map((line) => [
    timestamp, context.shop.shop_domain, context.job.id, numericId(snapshot.orderId), snapshot.orderName,
    line.variantId, line.productTitle, line.variantTitle, line.sku, 0, result.totalAfter, result.editId, "SUCCESS", "",
  ]));
  await env.DB.prepare("UPDATE job_orders SET after_audit_status='WRITTEN', updated_at=? WHERE id=? AND shop_id=?")
    .bind(now(), context.order.id, context.shop.id).run();
}

async function reserveRows(tab: "BEFORE" | "AFTER", count: number, env: Env): Promise<number> {
  const row = await env.DB.prepare("UPDATE audit_counters SET next_row=next_row+? WHERE tab=? RETURNING next_row-? AS start_row")
    .bind(count, tab, count).first<{ start_row: number }>();
  if (!row) throw new RetryableError("Could not reserve audit rows");
  return row.start_row;
}

async function finishOrder(context: WorkContext, status: "SUCCESS" | "SKIPPED", started: number, env: Env, reason: string | null = null): Promise<void> {
  await env.DB.prepare("UPDATE job_orders SET status=?, error_message=?, completed_at=?, updated_at=? WHERE id=? AND shop_id=?")
    .bind(status, reason, now(), now(), context.order.id, context.shop.id).run();
  await updateRollingAverage(context.job.id, context.shop.id, Date.now() - started, env);
  await env.DB.prepare("UPDATE jobs SET last_order_name=?, updated_at=? WHERE id=? AND shop_id=?")
    .bind(context.order.order_name, now(), context.job.id, context.shop.id).run();
  await refreshJob(context.job.id, context.shop.id, env);
}

async function updateRollingAverage(jobId: string, shopId: string, duration: number, env: Env): Promise<void> {
  await env.DB.prepare(`UPDATE jobs SET rolling_avg_ms=CASE WHEN rolling_avg_ms IS NULL THEN ? ELSE rolling_avg_ms * 0.8 + ? * 0.2 END,
    updated_at=? WHERE id=? AND shop_id=?`).bind(duration, duration, now(), jobId, shopId).run();
}

export async function refreshJob(jobId: string, shopId: string, env: Env): Promise<void> {
  const counts = await env.DB.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN eligible=1 THEN 1 ELSE 0 END) eligible,
    SUM(CASE WHEN status IN ('SUCCESS','SKIPPED','FAILED','AUDIT_AFTER_FAILED','CANCELLED') THEN 1 ELSE 0 END) processed,
    SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) success,
    SUM(CASE WHEN status='SKIPPED' THEN 1 ELSE 0 END) skipped,
    SUM(CASE WHEN status IN ('FAILED','AUDIT_AFTER_FAILED') THEN 1 ELSE 0 END) failed,
    SUM(CASE WHEN status IN ('PENDING','PROCESSING') THEN 1 ELSE 0 END) active
    FROM job_orders WHERE job_id=? AND shop_id=?`).bind(jobId, shopId).first<Record<string, number>>();
  if (!counts) return;
  const job = await env.DB.prepare("SELECT status FROM jobs WHERE id=? AND shop_id=?").bind(jobId, shopId).first<{ status: string }>();
  if (!job) return;
  let status = job.status;
  if (status === "CANCELLING" && !counts.active) status = "CANCELLED";
  else if (status === "PROCESSING" && !counts.active) status = "COMPLETED";
  await env.DB.prepare(`UPDATE jobs SET total_orders=?, eligible_orders=?, processed_orders=?, success_count=?, skipped_count=?, failed_count=?,
    status=?, completed_at=CASE WHEN ? IN ('COMPLETED','CANCELLED') THEN COALESCE(completed_at, ?) ELSE completed_at END, updated_at=?
    WHERE id=? AND shop_id=?`).bind(counts.total ?? 0, counts.eligible ?? 0, counts.processed ?? 0, counts.success ?? 0,
      counts.skipped ?? 0, counts.failed ?? 0, status, status, now(), now(), jobId, shopId).run();
}

async function loadContext(jobId: string, jobOrderId: string, env: Env): Promise<WorkContext | null> {
  const order = await env.DB.prepare("SELECT * FROM job_orders WHERE id=? AND job_id=?").bind(jobOrderId, jobId).first<JobOrderRow>();
  if (!order) return null;
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE id=? AND shop_id=?").bind(jobId, order.shop_id).first<JobRow>();
  const shop = await env.DB.prepare("SELECT * FROM shops WHERE id=? AND status='ACTIVE'").bind(order.shop_id).first<ShopRow>();
  return job && shop ? { job, order, shop } : null;
}

function joinedShop(row: Record<string, unknown>): ShopRow {
  return {
    id: row.shop_id as string,
    shop_domain: row.shop_domain as string,
    access_token_ciphertext: row.access_token_ciphertext as string,
    access_token_iv: row.access_token_iv as string,
    refresh_token_ciphertext: row.refresh_token_ciphertext as string | null,
    refresh_token_iv: row.refresh_token_iv as string | null,
    token_expires_at: row.token_expires_at as string | null,
    refresh_token_expires_at: row.refresh_token_expires_at as string | null,
    token_refreshing_at: row.token_refreshing_at as string | null,
    scopes: row.scopes as string,
    timezone: row.shop_timezone as string,
    status: row.shop_status as "ACTIVE" | "UNINSTALLED",
  };
}

export const safeError = (error: unknown): string => error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
export const isRetryable = (error: unknown): boolean => error instanceof RetryableError;
export const messageRetryDelay = (attempt: number): number => retryDelay(attempt);
const now = (): string => new Date().toISOString();
