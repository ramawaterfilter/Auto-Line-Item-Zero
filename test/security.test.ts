import { describe, expect, it } from "vitest";
import { api, selectedOrderIds } from "../src/api";
import { beginAuth, missingScopes, verifyIdToken } from "../src/auth";
import { signedValue, verifyHmac, verifySignedValue } from "../src/crypto";
import worker, { isEmbeddedAppRequest } from "../src/index";
import { validateAuditSheet } from "../src/sheets";
import type { Env, ShopRow } from "../src/types";

async function idToken(aud = "key"): Promise<string> {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud, dest: "https://a.myshopify.com", iss: "https://a.myshopify.com/admin", sub: "123", nbf: now - 1, exp: now + 60 })}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
}

describe("signed sessions", () => {
  it("accepts an intact value and rejects tampering", async () => {
    const value = await signedValue({ shop: "a.myshopify.com", exp: Date.now() + 1000 }, "secret");
    expect(await verifySignedValue<{ shop: string }>(value, "secret")).toMatchObject({ shop: "a.myshopify.com" });
    expect(await verifySignedValue(value.replace(/^./, value[0] === "a" ? "b" : "a"), "secret")).toBeNull();
  });

  it("rejects expired values", async () => {
    const value = await signedValue({ shop: "a.myshopify.com", exp: Date.now() - 1 }, "secret");
    expect(await verifySignedValue(value, "secret")).toBeNull();
  });
});

describe("Shopify HMAC signatures", () => {
  it("accepts OAuth hex and webhook base64 signatures", async () => {
    expect(await verifyHmac("message", "8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b", "secret")).toBe(true);
    expect(await verifyHmac("message", "i19IcCmVwVmMVz2x4hhmqbgl1KeU0WnXBgoDYFeWNgs=", "secret")).toBe(true);
  });
});

describe("order webhook routes", () => {
  it("routes the configured URL and previous Shopify URL through signature verification", async () => {
    const env = { SHOPIFY_API_SECRET: "secret" } as Env;
    for (const path of ["/webhooks/orders-create", "/app/webhooks/orders-create"]) {
      const request = new Request(`https://app.test${path}`, { method: "POST", body: "{}" }) as Parameters<typeof worker.fetch>[0];
      expect((await worker.fetch(request, env)).status).toBe(401);
    }
  });
});

describe("Shopify ID tokens", () => {
  it("accepts a valid embedded identity and rejects the wrong audience", async () => {
    const env = { SHOPIFY_API_KEY: "key", SHOPIFY_API_SECRET: "secret" } as Env;
    expect(await verifyIdToken(await idToken(), env)).toEqual({ shop: "a.myshopify.com", userId: "123" });
    expect(await verifyIdToken(await idToken("another-key"), env)).toBeNull();
  });
});

describe("embedded app entry", () => {
  const url = "https://app.test/app?shop=a.myshopify.com&host=encoded-host";

  it("accepts the Shopify Admin iframe and rejects a direct browser visit", () => {
    expect(isEmbeddedAppRequest(new Request(url, { headers: { "Sec-Fetch-Dest": "iframe" } }))).toBe(true);
    expect(isEmbeddedAppRequest(new Request(url, { headers: { "Sec-Fetch-Dest": "document" } }))).toBe(false);
    expect(isEmbeddedAppRequest(new Request("https://app.test/app"))).toBe(false);
  });

  it("returns 404 for top-level app URLs", async () => {
    const env = { SHOPIFY_API_KEY: "key" } as Env;
    const request = (input: string, headers?: HeadersInit) => new Request(input, { headers }) as Parameters<typeof worker.fetch>[0];
    expect((await worker.fetch(request(url, { "Sec-Fetch-Dest": "document" }), env)).status).toBe(404);
    expect((await worker.fetch(request("https://app.test/"), env)).status).toBe(404);
  });
});

describe("Shopify scopes", () => {
  it("trims granted scopes and identifies missing scopes", () => {
    expect(missingScopes("read_orders,write_order_edits", "read_orders, write_order_edits")).toEqual([]);
    expect(missingScopes("read_orders,write_order_edits", "write_orders,write_order_edits")).toEqual([]);
    expect(missingScopes("read_orders,write_order_edits", "read_orders")).toEqual(["write_order_edits"]);
    expect(missingScopes("read_orders,read_products,write_order_edits", "write_orders,write_order_edits")).toEqual(["read_products"]);
  });
});

describe("Shopify staff login", () => {
  it("requests per-user access only after the shop is installed", async () => {
    const envFor = (installed: boolean) => ({
      DB: {
        prepare() {
          return { bind() { return this; }, async first() { return installed ? {} : null; } };
        },
      } as unknown as D1Database,
      SHOPIFY_API_KEY: "key",
      SHOPIFY_API_SECRET: "secret",
      SHOPIFY_APP_URL: "https://app.test",
      SHOPIFY_SCOPES: "read_orders",
    } as Env);
    const request = new Request("https://app.test/auth?shop=a.myshopify.com");
    const install = new URL((await beginAuth(request, envFor(false))).headers.get("Location")!);
    const staff = new URL((await beginAuth(request, envFor(true))).headers.get("Location")!);
    expect(install.searchParams.has("grant_options[]")).toBe(false);
    expect(staff.searchParams.get("grant_options[]")).toBe("per-user");
  });
});

describe("Google Sheets configuration", () => {
  it("reports missing configuration without a JavaScript type error", async () => {
    await expect(validateAuditSheet({} as Env)).rejects.toThrow("Google spreadsheet ID is not configured");
  });
});

describe("order selection", () => {
  it("accepts unique job-order IDs and rejects invalid selections", () => {
    const id = "jo_11111111-1111-1111-1111-111111111111";
    expect(selectedOrderIds([id, id])).toEqual([id]);
    expect(selectedOrderIds([])).toBeNull();
    expect(selectedOrderIds(["another-shop-order"])).toBeNull();
  });
});

describe("shop isolation", () => {
  it("does not return another shop's job even with a valid App Bridge identity", async () => {
    const shop: ShopRow = {
      id: "shop_a", shop_domain: "a.myshopify.com", access_token_ciphertext: "x", access_token_iv: "x",
      refresh_token_ciphertext: null, refresh_token_iv: null, token_expires_at: null, refresh_token_expires_at: null,
      scopes: "read_orders,write_order_edits", timezone: "UTC", status: "ACTIVE",
    };
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) { values = args; return this; },
          async first() {
            if (sql.includes("FROM shops WHERE shop_domain")) return values[0] === shop.shop_domain ? shop : null;
            if (sql.includes("FROM jobs WHERE id")) return values[0] === "job_11111111-1111-1111-1111-111111111111" && values[1] === "shop_b" ? {} : null;
            return null;
          },
        };
      },
    } as unknown as D1Database;
    const env = { DB: db, SHOPIFY_API_KEY: "key", SHOPIFY_API_SECRET: "secret" } as Env;
    const request = new Request("https://app.test/api/jobs/job_11111111-1111-1111-1111-111111111111", {
      headers: { Authorization: `Bearer ${await idToken()}` },
    });
    expect((await api(request, env)).status).toBe(404);
  });

  it("rejects cookie sessions so APIs only accept App Bridge ID tokens", async () => {
    const session = await signedValue({ shop: "a.myshopify.com", exp: Date.now() + 60_000 }, "secret");
    const request = new Request("https://app.test/api/session", { headers: { Cookie: `app_session=${session}` } });
    const response = await api(request, { SHOPIFY_API_SECRET: "secret" } as Env);
    expect(response.status).toBe(401);
  });
});
