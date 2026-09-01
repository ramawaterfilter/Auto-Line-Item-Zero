import { cookie, decrypt, encrypt, readCookie, signedValue, verifyHmac, verifySignedValue } from "./crypto";
import { shopifyGraphql } from "./shopify";
import { PermanentError, RetryableError } from "./core";
import type { Env, ShopRow } from "./types";

const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

interface OAuthPayload { shop: string; exp: number; nonce: string; mode: "install" | "staff" }
interface SessionPayload {
  shop: string;
  userId: string;
  email: string;
  name: string;
  tokenCiphertext: string;
  tokenIv: string;
  exp: number;
}
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  associated_user_scope?: string;
  associated_user?: {
    id: string | number;
    first_name?: string;
    last_name?: string;
    email: string;
  };
}

export interface AuthenticatedStaff {
  shop: ShopRow;
  user: { id: string; email: string; name: string };
}

export function validShop(value: string): boolean {
  return SHOP_PATTERN.test(value) && value.length <= 255;
}

export function missingScopes(required: string, granted: string): string[] {
  const grantedSet = new Set(granted.split(",").map((scope) => scope.trim()).filter(Boolean));
  return required.split(",").map((scope) => scope.trim()).filter((scope) =>
    scope && !grantedSet.has(scope) && !(scope.startsWith("read_") && grantedSet.has(`write_${scope.slice(5)}`))
  );
}

export async function beginAuth(request: Request, env: Env): Promise<Response> {
  const shop = new URL(request.url).searchParams.get("shop")?.toLowerCase() ?? "";
  if (!validShop(shop)) return new Response("Invalid shop domain", { status: 400 });
  const mode = await findShop(env, shop) ? "staff" : "install";
  const nonce = crypto.randomUUID();
  const state = await signedValue({ shop, nonce, mode, exp: Date.now() + 10 * 60_000 }, env.SHOPIFY_API_SECRET);
  const callback = `${env.SHOPIFY_APP_URL.replace(/\/$/, "")}/auth/callback`;
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  const parameters = new URLSearchParams({
    client_id: env.SHOPIFY_API_KEY,
    scope: env.SHOPIFY_SCOPES,
    redirect_uri: callback,
    state: nonce,
  });
  if (mode === "staff") parameters.append("grant_options[]", "per-user");
  authorize.search = parameters.toString();
  return new Response(null, {
    status: 302,
    headers: { Location: authorize.toString(), "Set-Cookie": cookie("oauth_state", state, 600) },
  });
}

export async function finishAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.toLowerCase() ?? "";
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const timestamp = Number(url.searchParams.get("timestamp"));
  const saved = await verifySignedValue<OAuthPayload>(readCookie(request, "oauth_state"), env.SHOPIFY_API_SECRET);
  if (!validShop(shop) || !code || !saved || saved.shop !== shop || saved.nonce !== state || !Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return new Response("Invalid OAuth callback", { status: 403 });
  }
  const message = [...url.searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  if (!await verifyHmac(message, url.searchParams.get("hmac"), env.SHOPIFY_API_SECRET)) {
    return new Response("Invalid OAuth signature", { status: 403 });
  }
  const exchange = new URLSearchParams({ client_id: env.SHOPIFY_API_KEY, client_secret: env.SHOPIFY_API_SECRET, code });
  if (saved.mode === "install") exchange.set("expiring", "1");
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: exchange,
  });
  if (!response.ok) return new Response("Shopify token exchange failed", { status: 502 });
  const tokens = await response.json<TokenResponse>();
  const grantedScopes = saved.mode === "staff" ? tokens.associated_user_scope ?? "" : tokens.scope;
  const missing = missingScopes(env.SHOPIFY_SCOPES, grantedScopes);
  if (missing.length) {
    const subject = saved.mode === "staff" ? "Your Shopify staff account" : "The app installation";
    return new Response(`${subject} lacks required permissions. Missing: ${missing.join(", ")}.`, { status: 403 });
  }

  if (saved.mode === "staff") return finishStaffLogin(shop, tokens, env);

  const access = await encrypt(tokens.access_token, env);
  const refresh = tokens.refresh_token ? await encrypt(tokens.refresh_token, env) : null;
  const now = new Date();
  const shopId = `shop_${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO shops (
      id, shop_domain, access_token_ciphertext, access_token_iv, refresh_token_ciphertext, refresh_token_iv,
      token_expires_at, refresh_token_expires_at, scopes, installed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_domain) DO UPDATE SET
      access_token_ciphertext=excluded.access_token_ciphertext, access_token_iv=excluded.access_token_iv,
      refresh_token_ciphertext=excluded.refresh_token_ciphertext, refresh_token_iv=excluded.refresh_token_iv,
      token_expires_at=excluded.token_expires_at, refresh_token_expires_at=excluded.refresh_token_expires_at,
      scopes=excluded.scopes, status='ACTIVE', updated_at=excluded.updated_at`)
    .bind(shopId, shop, access.ciphertext, access.iv, refresh?.ciphertext ?? null, refresh?.iv ?? null,
      tokens.expires_in ? new Date(now.getTime() + tokens.expires_in * 1000).toISOString() : null,
      tokens.refresh_token_expires_in ? new Date(now.getTime() + tokens.refresh_token_expires_in * 1000).toISOString() : null,
      tokens.scope, now.toISOString(), now.toISOString()).run();

  const stored = await findShop(env, shop);
  if (!stored) return new Response("Installation could not be saved", { status: 500 });
  const token = await decrypt(stored.access_token_ciphertext, stored.access_token_iv, env);
  try {
    const data = await shopifyGraphql<{ shop: { ianaTimezone: string } }>(shop, token, env, `query ShopTimezone { shop { ianaTimezone } }`);
    await env.DB.prepare("UPDATE shops SET timezone=?, updated_at=? WHERE id=?").bind(data.shop.ianaTimezone, new Date().toISOString(), stored.id).run();
    await registerUninstallWebhook(shop, token, env);
  } catch (error) {
    console.warn(JSON.stringify({ operation: "post_install_setup", shopDomain: shop, status: "failed", message: safeError(error) }));
  }
  const headers = new Headers({ Location: `${env.SHOPIFY_APP_URL.replace(/\/$/, "")}/auth?shop=${encodeURIComponent(shop)}` });
  headers.append("Set-Cookie", cookie("oauth_state", "", 0));
  return new Response(null, { status: 302, headers });
}

export async function authenticatedStaff(request: Request, env: Env): Promise<AuthenticatedStaff | null> {
  const payload = await verifySignedValue<SessionPayload>(readCookie(request, "app_session"), env.SHOPIFY_API_SECRET);
  if (!payload?.shop || !payload.userId || !payload.tokenCiphertext || !payload.tokenIv) return null;
  const shop = await findShop(env, payload.shop);
  if (!shop) return null;
  const onlineToken = await decrypt(payload.tokenCiphertext, payload.tokenIv, env);
  return await validOnlineToken(shop.shop_domain, onlineToken, env)
    ? { shop, user: { id: payload.userId, email: payload.email, name: payload.name } }
    : null;
}

export function logout(): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: "/", "Set-Cookie": cookie("app_session", "", 0) },
  });
}

export async function findShop(env: Env, domain: string): Promise<ShopRow | null> {
  return env.DB.prepare("SELECT * FROM shops WHERE shop_domain=? AND status='ACTIVE'").bind(domain).first<ShopRow>();
}

export async function accessToken(shop: ShopRow, env: Env): Promise<string> {
  if (!shop.token_expires_at || Date.parse(shop.token_expires_at) > Date.now() + 5 * 60_000) {
    return decrypt(shop.access_token_ciphertext, shop.access_token_iv, env);
  }
  if (!shop.refresh_token_ciphertext || !shop.refresh_token_iv) throw new Error("Shopify authorization expired; reinstall the app");
  const locked = await env.DB.prepare(`UPDATE shops SET token_refreshing_at=? WHERE id=? AND access_token_ciphertext=? AND
    (token_refreshing_at IS NULL OR token_refreshing_at < ?)`)
    .bind(new Date().toISOString(), shop.id, shop.access_token_ciphertext, new Date(Date.now() - 2 * 60_000).toISOString()).run();
  if (!locked.meta.changes) throw new RetryableError("Shopify token refresh is already in progress");
  const refreshToken = await decrypt(shop.refresh_token_ciphertext, shop.refresh_token_iv, env);
  try {
    const response = await fetch(`https://${shop.shop_domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token", client_id: env.SHOPIFY_API_KEY,
        client_secret: env.SHOPIFY_API_SECRET, refresh_token: refreshToken,
      }),
    });
    if (!response.ok) throw response.status >= 500 || response.status === 429
      ? new RetryableError("Temporary Shopify token refresh failure")
      : new PermanentError("Shopify authorization expired; reinstall the app");
    const tokens = await response.json<TokenResponse>();
    const access = await encrypt(tokens.access_token, env);
    const refresh = tokens.refresh_token ? await encrypt(tokens.refresh_token, env) : null;
    const now = Date.now();
    await env.DB.prepare(`UPDATE shops SET access_token_ciphertext=?, access_token_iv=?,
      refresh_token_ciphertext=COALESCE(?, refresh_token_ciphertext), refresh_token_iv=COALESCE(?, refresh_token_iv),
      token_expires_at=?, refresh_token_expires_at=COALESCE(?, refresh_token_expires_at), token_refreshing_at=NULL, updated_at=? WHERE id=?`)
      .bind(access.ciphertext, access.iv, refresh?.ciphertext ?? null, refresh?.iv ?? null,
        tokens.expires_in ? new Date(now + tokens.expires_in * 1000).toISOString() : null,
        tokens.refresh_token_expires_in ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString() : null,
        new Date(now).toISOString(), shop.id).run();
    return tokens.access_token;
  } catch (error) {
    await env.DB.prepare("UPDATE shops SET token_refreshing_at=NULL WHERE id=?").bind(shop.id).run();
    throw error;
  }
}

export async function uninstallWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (!await verifyHmac(body, request.headers.get("X-Shopify-Hmac-Sha256"), env.SHOPIFY_API_SECRET)) {
    return new Response("Invalid signature", { status: 401 });
  }
  const domain = request.headers.get("X-Shopify-Shop-Domain")?.toLowerCase() ?? "";
  if (validShop(domain)) await env.DB.prepare("DELETE FROM shops WHERE shop_domain=?").bind(domain).run();
  return new Response(null, { status: 204 });
}

async function registerUninstallWebhook(shop: string, token: string, env: Env): Promise<void> {
  const result = await shopifyGraphql<{ webhookSubscriptionCreate: { userErrors: Array<{ message: string }> } }>(shop, token, env, `mutation RegisterUninstall($subscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription: $subscription) {
      userErrors { field message }
    }
  }`, { subscription: { callbackUrl: `${env.SHOPIFY_APP_URL.replace(/\/$/, "")}/webhooks/app-uninstalled`, format: "JSON" } });
  if (result.webhookSubscriptionCreate.userErrors.length) {
    throw new Error(`Uninstall webhook registration failed: ${result.webhookSubscriptionCreate.userErrors.map((error) => error.message).join("; ")}`);
  }
}

async function finishStaffLogin(shop: string, tokens: TokenResponse, env: Env): Promise<Response> {
  const user = tokens.associated_user;
  if (!user) return new Response("Shopify did not return a staff identity", { status: 403 });
  const encrypted = await encrypt(tokens.access_token, env);
  const maxAge = Math.max(1, Math.min(tokens.expires_in ?? 86_400, 43_200));
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
  const session = await signedValue({
    shop,
    userId: String(user.id),
    email: user.email,
    name,
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    exp: Date.now() + maxAge * 1000,
  }, env.SHOPIFY_API_SECRET);
  const headers = new Headers({ Location: `${env.SHOPIFY_APP_URL.replace(/\/$/, "")}/app` });
  headers.append("Set-Cookie", cookie("app_session", session, maxAge));
  headers.append("Set-Cookie", cookie("oauth_state", "", 0));
  return new Response(null, { status: 302, headers });
}

async function validOnlineToken(shop: string, token: string, env: Env): Promise<boolean> {
  const response = await fetch(`https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: "query StaffSession { shop { id } }" }),
  });
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) throw new Error(`Shopify staff-session check returned HTTP ${response.status}`);
  return true;
}

const safeError = (error: unknown): string => error instanceof Error ? error.message.slice(0, 300) : "Unknown error";
