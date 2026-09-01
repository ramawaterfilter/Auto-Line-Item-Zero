import { describe, expect, it } from "vitest";
import { api, selectedOrderIds } from "../src/api";
import { missingScopes } from "../src/auth";
import { signedValue, verifyHmac, verifySignedValue } from "../src/crypto";
import { validateAuditSheet } from "../src/sheets";
import type { Env, ShopRow } from "../src/types";

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

describe("Shopify scopes", () => {
  it("trims granted scopes and identifies missing scopes", () => {
    expect(missingScopes("read_orders,write_order_edits", "read_orders, write_order_edits")).toEqual([]);
    expect(missingScopes("read_orders,write_order_edits", "write_orders,write_order_edits")).toEqual([]);
    expect(missingScopes("read_orders,write_order_edits", "read_orders")).toEqual(["write_order_edits"]);
    expect(missingScopes("read_orders,read_products,write_order_edits", "write_orders,write_order_edits")).toEqual(["read_products"]);
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
  it("does not return another shop's job even with a valid job ID", async () => {
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
    const env = { DB: db, SHOPIFY_API_SECRET: "secret" } as Env;
    const session = await signedValue({ shop: shop.shop_domain, exp: Date.now() + 60_000 }, "secret");
    const request = new Request("https://app.test/api/jobs/job_11111111-1111-1111-1111-111111111111", { headers: { Cookie: `app_session=${session}` } });
    const response = await api(request, env);
    expect(response.status).toBe(404);
  });
});
