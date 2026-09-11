import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { clientScript } from "../src/ui-client";
import type { Env } from "../src/types";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function request() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256" })}.${encode({ aud: "key", sub: "1", nbf: now - 1, exp: now + 60, iss: "https://4b0f4b.myshopify.com/admin", dest: "https://4b0f4b.myshopify.com" })}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned))).toString("base64url");
  return new Request("https://app.test/api/session", { headers: { Authorization: `Bearer ${unsigned}.${signature}` } });
}
const env = {
  SHOPIFY_API_KEY: "key", SHOPIFY_API_SECRET: "secret", SHOPIFY_SCOPES: "read_orders,read_products,write_order_edits", TARGET_VARIANT_IDS: "123",
  DB: { prepare() { return { bind() { return this; }, async first() { return { id: "shop", shop_domain: "4b0f4b.myshopify.com", scopes: "read_orders,read_products,write_order_edits", timezone: "UTC" }; } }; } },
} as unknown as Env;

describe("staff login diagnostics", () => {
  it("accepts a valid staff identity with the required scopes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ associated_user: { id: 1, first_name: "Staff", email: "staff@example.test" }, associated_user_scope: env.SHOPIFY_SCOPES })));
    const response = await api(await request(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ shop: "4b0f4b.myshopify.com", staff: { name: "Staff" } });
  });
  it("reports missing permissions as 403 without requesting a token-refresh loop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ associated_user: { id: 1 }, associated_user_scope: "read_orders,read_products" })));
    const response = await api(await request(), env);
    expect(response.status).toBe(403);
    expect(response.headers.has("X-Shopify-Retry-Invalid-Session-Request")).toBe(false);
    expect(await response.text()).toContain("write_order_edits");
  });
  it("distinguishes rejected app credentials from missing staff login without exposing Shopify response data", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private provider response", { status: 401 })));
    const response = await api(await request(), env);
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("deployed client ID and secret");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private provider response");
  });
  it("allows App Bridge to refresh rejected session tokens", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 400 })));
    const response = await api(await request(), env);
    expect(response.status).toBe(401);
    expect(response.headers.get("X-Shopify-Retry-Invalid-Session-Request")).toBe("1");
  });
});

describe("authenticated browser requests", () => {
  const source = clientScript.slice(clientScript.indexOf("const api ="), clientScript.indexOf("const formatEta"));
  it("gets a fresh token for each request and attaches it to the backend call", async () => {
    const idToken = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const call = new Function("window", "fetch", source + "return api;")({ shopify: { idToken } }, fetch);
    await call("/api/session"); await call("/api/automation");
    expect(fetch.mock.calls).toMatchObject([
      ["/api/session", { headers: { Authorization: "Bearer first" } }],
      ["/api/automation", { headers: { Authorization: "Bearer second" } }],
    ]);
  });
  it("explains how to reopen the app when App Bridge is unavailable", async () => {
    const fetch = vi.fn();
    const call = new Function("window", "fetch", source + "return api;")({}, fetch);
    await expect(call("/api/session")).rejects.toThrow("Shopify Admin → Apps");
    expect(fetch).not.toHaveBeenCalled();
  });
});
