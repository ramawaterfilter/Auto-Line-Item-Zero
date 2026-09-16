/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createdAfterEnable, orderCreatedWebhook } from "../src/automation";
import { api } from "../src/api";
import { processOrder } from "../src/processor";
import type { Env } from "../src/types";

vi.mock("../src/auth", async (original) => ({
  ...await original<typeof import("../src/auth")>(),
  authenticatedStaff: vi.fn(async (request: Request, env: Env) => {
    if (request.headers.get("Authorization") !== "test-staff") return null;
    const shop = await env.DB.prepare("SELECT * FROM shops WHERE id='shop-a'").first();
    return { shop, user: { id: "staff" } };
  }),
}));
vi.mock("../src/sheets", () => ({ validateAuditSheet: vi.fn(async () => {}), writeRows: vi.fn() }));

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.clearAllMocks(); });

function setup() {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.prepare(`INSERT INTO shops (id, shop_domain, access_token_ciphertext, access_token_iv, scopes, installed_at, updated_at)
    VALUES (?, ?, '', '', '', '', '')`).run("shop-a", "a.myshopify.com");
  db.prepare(`INSERT INTO shops (id, shop_domain, access_token_ciphertext, access_token_iv, scopes, installed_at, updated_at)
    VALUES (?, ?, '', '', '', '', '')`).run("shop-b", "b.myshopify.com");
  function prepare(sql: string) {
    let args: Array<string | number | null> = [];
    return {
      bind(...values: typeof args) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    };
  }
  const send = vi.fn(async (_message: unknown) => {});
  const env = { DB: { prepare, async batch(statements: Array<ReturnType<typeof prepare>>) {
    db.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } }, JOBS: { send }, SHOPIFY_API_SECRET: "secret", SHOPIFY_APP_URL: "https://app.test" } as unknown as Env;
  const enable = () => db.prepare("UPDATE shops SET automation_enabled_at=? WHERE id='shop-a'").run("2026-09-11T10:00:00.000Z");
  return { db, env, send, enable };
}

async function webhook(createdAt = "2026-09-11T10:00:01Z", domain = "a.myshopify.com", signatureValid = true) {
  const body = JSON.stringify({ admin_graphql_api_id: "gid://shopify/Order/123", name: "#1001", created_at: createdAt });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))).toString("base64");
  return new Request("https://app.test/webhooks/orders-create", { method: "POST", body, headers: {
    "X-Shopify-Hmac-Sha256": signatureValid ? signature : "invalid", "X-Shopify-Shop-Domain": domain, "X-Shopify-Topic": "orders/create",
  } });
}

describe("automatic order processing", () => {
  it("defaults off and ignores orders from before enabling and from other stores", async () => {
    const { env, send, enable } = setup();
    expect((await orderCreatedWebhook(await webhook(), env)).status).toBe(204);
    enable();
    await orderCreatedWebhook(await webhook("2026-09-11T09:59:59Z"), env);
    await orderCreatedWebhook(await webhook(undefined, "b.myshopify.com"), env);
    expect(send).not.toHaveBeenCalled();
    expect(createdAfterEnable("invalid", "2026-09-11T10:00:00Z")).toBe(false);
    expect(createdAfterEnable("2026-09-11T15:30:00+05:30", "2026-09-11T10:00:00Z")).toBe(false);
  });

  it("rejects invalid signatures before recording work", async () => {
    const { env, send, enable } = setup(); enable();
    expect((await orderCreatedWebhook(await webhook(undefined, undefined, false), env)).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("persists one job across duplicate deliveries and recovers a queue send failure", async () => {
    const { env, db, send, enable } = setup(); enable();
    send.mockRejectedValueOnce(new Error("Queue unavailable"));
    expect((await orderCreatedWebhook(await webhook(), env)).status).toBe(503);
    expect((await orderCreatedWebhook(await webhook(), env)).status).toBe(204);
    expect(db.prepare("SELECT COUNT(*) count FROM jobs").get()?.count).toBe(1);
    expect(db.prepare("SELECT COUNT(*) count FROM job_orders").get()?.count).toBe(1);
    expect(send.mock.calls[0]?.[0]).toEqual(send.mock.calls[1]?.[0]);
    db.exec("UPDATE job_orders SET status='SUCCESS'");
    await orderCreatedWebhook(await webhook(), env);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("skips waiting automatic work after disabling without calling Shopify", async () => {
    const { env, db, send, enable } = setup(); enable();
    await orderCreatedWebhook(await webhook(), env);
    db.exec("UPDATE shops SET automation_enabled_at=NULL");
    const message = send.mock.calls[0]![0] as { jobId: string; jobOrderId: string };
    await processOrder(message.jobId, message.jobOrderId, env);
    expect(db.prepare("SELECT status FROM job_orders").get()?.status).toBe("SKIPPED");
    expect(db.prepare("SELECT status FROM jobs").get()?.status).toBe("COMPLETED");
  });

  it("saves settings per store, preserves the cutoff on repeated enable, and requires staff authorization", async () => {
    const { env, db, enable } = setup();
    const request = (enabled: unknown, auth = "test-staff") => new Request("https://app.test/api/automation", {
      method: "PUT", headers: { Authorization: auth, Origin: "https://app.test" }, body: JSON.stringify({ enabled }),
    });
    expect((await api(request(true, ""), env)).status).toBe(401);
    expect((await api(request("true"), env)).status).toBe(400);
    expect((await api(request(true), env)).status).toBe(200);
    expect(db.prepare("SELECT automation_enabled_at FROM shops WHERE id='shop-b'").get()?.automation_enabled_at).toBeNull();
    enable();
    const saved = await (await api(request(true), env)).json() as { enabledAt: string };
    expect(saved.enabledAt).toBe("2026-09-11T10:00:00.000Z");
    expect((await api(request(false), env)).status).toBe(200);
    expect(db.prepare("SELECT automation_enabled_at FROM shops WHERE id='shop-a'").get()?.automation_enabled_at).toBeNull();
  });

});
