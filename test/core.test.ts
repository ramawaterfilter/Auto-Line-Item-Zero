import { describe, expect, it, vi } from "vitest";
import { etaSeconds, numericId, retryDelay, targetIds, validateDateRange, ValidationError, zonedDateBoundary } from "../src/core";
import { matchingLines, positiveMatchingLines, shopifyGraphql } from "../src/shopify";
import { runDestructiveFlow } from "../src/safety";
import type { Env, OrderLine } from "../src/types";

const line = (variantId: string | null, quantity = 1): OrderLine => ({
  id: `gid://shopify/LineItem/${variantId ?? "custom"}`,
  quantity,
  currentQuantity: quantity,
  name: "Test item",
  sku: null,
  variant: variantId ? { id: `gid://shopify/ProductVariant/${variantId}`, title: "Default", product: { title: "Product" } } : null,
  originalUnitPriceSet: { shopMoney: { amount: "10.00", currencyCode: "USD" } },
});

describe("target matching", () => {
  const targets = targetIds("58780018377088,58414723465600");
  it("matches neither target", () => expect(matchingLines([line("1")], targets)).toEqual([]));
  it("matches the first target", () => expect(matchingLines([line("58780018377088")], targets)).toHaveLength(1));
  it("matches the second target", () => expect(matchingLines([line("58414723465600")], targets)).toHaveLength(1));
  it("matches both targets and excludes unrelated/custom lines", () => {
    expect(matchingLines([line("58780018377088"), line("9"), line(null), line("58414723465600")], targets)).toHaveLength(2);
  });
  it("lists only orders with a target variant quantity greater than zero", () => {
    expect(positiveMatchingLines([line("58780018377088", 0), line("58414723465600", 2), line("9", 3)], targets)).toEqual([
      line("58414723465600", 2),
    ]);
  });
  it("uses current quantity after Shopify order edits", () => {
    const edited = { ...line("58414723465600", 1), currentQuantity: 0 };
    expect(positiveMatchingLines([edited], targets)).toEqual([]);
  });
  it("normalizes GraphQL IDs", () => expect(numericId("gid://shopify/ProductVariant/123")).toBe("123"));
  it("rejects empty target configuration", () => expect(() => targetIds("nope")).toThrow());
});

describe("date range", () => {
  it("accepts inclusive valid dates", () => expect(() => validateDateRange("2026-08-01", "2026-08-31", 31)).not.toThrow());
  it("rejects reversed dates", () => expect(() => validateDateRange("2026-08-02", "2026-08-01", 60)).toThrow(ValidationError));
  it("rejects impossible calendar dates", () => expect(() => validateDateRange("2026-02-30", "2026-03-01", 60)).toThrow(ValidationError));
  it("rejects ranges beyond the cap", () => expect(() => validateDateRange("2026-01-01", "2026-03-02", 60)).toThrow(ValidationError));
  it("uses the shop timezone for inclusive boundaries", () => {
    expect(zonedDateBoundary("2026-08-31", "Asia/Calcutta")).toBe("2026-08-30T18:30:00.000Z");
    expect(zonedDateBoundary("2026-08-31", "Asia/Calcutta", true)).toBe("2026-08-31T18:29:59.000Z");
  });
});

describe("progress", () => {
  it("does not invent an ETA before work completes", () => expect(etaSeconds(0, 10, null)).toBeNull());
  it("calculates remaining time", () => expect(etaSeconds(4, 10, 2000)).toBe(12));
  it("bounds retry delay", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(retryDelay(1)).toBe(5);
    expect(retryDelay(20)).toBe(3600);
    vi.restoreAllMocks();
  });
});

describe("destructive safety", () => {
  it("never mutates when BEFORE audit fails", async () => {
    const mutate = vi.fn();
    await expect(runDestructiveFlow({
      before: async () => { throw new Error("sheets down"); }, mutate,
      recordCommit: async () => undefined, after: async () => undefined,
    })).rejects.toThrow("sheets down");
    expect(mutate).not.toHaveBeenCalled();
  });
  it("records a commit before attempting AFTER audit", async () => {
    const events: string[] = [];
    await expect(runDestructiveFlow({
      before: async () => { events.push("before"); },
      mutate: async () => { events.push("mutate"); return "edit"; },
      recordCommit: async () => { events.push("record"); },
      after: async () => { events.push("after"); throw new Error("sheets down"); },
    })).rejects.toThrow("sheets down");
    expect(events).toEqual(["before", "mutate", "record", "after"]);
  });
});

describe("Shopify errors", () => {
  const env = { SHOPIFY_API_VERSION: "2026-07" } as Env;
  it("classifies 429 as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    await expect(shopifyGraphql("test.myshopify.com", "secret", env, "query { shop { id } }")).rejects.toThrow("HTTP 429");
    vi.unstubAllGlobals();
  });
  it("surfaces top-level GraphQL errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ errors: [{ message: "bad query" }] })));
    await expect(shopifyGraphql("test.myshopify.com", "secret", env, "bad")).rejects.toThrow("bad query");
    vi.unstubAllGlobals();
  });
});
