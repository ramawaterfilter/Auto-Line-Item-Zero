import { cookie, decrypt, encrypt, fromBase64, readCookie, signedValue, verifyHmac, verifySignedValue } from "./crypto";
import { shopifyGraphql } from "./shopify";
import { PermanentError, RetryableError } from "./core";
import type { Env, ShopRow } from "./types";

const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

interface OAuthPayload { shop: string; exp: number; nonce: string; mode: "install" | "staff" }
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

interface IdTokenPayload {
  aud: string;
  dest: string;
  exp: number;
  iss: string;
  nbf: number;
  sub: string;
}

export interface AuthenticatedStaff {
  shop: ShopRow;
  user: { id: string; email: string; name: string };
}

export class StaffAuthError extends Error {
  constructor(message: string, public status: 401 | 403 | 502, public retrySession = false) { super(message); }
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

  await saveInstallation(shop, tokens, env);
  const headers = new Headers({ Location: `${env.SHOPIFY_APP_URL.replace(/\/$/, "")}/auth?shop=${encodeURIComponent(shop)}` });
  headers.append("Set-Cookie", cookie("oauth_state", "", 0));
  return new Response(null, { status: 302, headers });
}

export async function authenticatedStaff(request: Request, env: Env): Promise<AuthenticatedStaff | null> {
  const idToken = bearerToken(request);
  if (!idToken) return null;
  const identity = await verifyIdToken(idToken, env);
  if (!identity) return null;
  let shop = await findShop(env, identity.shop);
  let user = { id: identity.userId, email: "", name: "Shopify staff" };
  const needsOnlineAuthorization = request.method !== "GET" || new URL(request.url).pathname === "/api/session" || !shop;
  if (needsOnlineAuthorization) {
    const tokens = await exchangeIdToken(identity.shop, idToken, "online", env);
    if (!tokens?.associated_user) throw new StaffAuthError("Shopify did not return a staff identity. Reopen the app from Shopify Admin → Apps.", 403);
    const missing = missingScopes(env.SHOPIFY_SCOPES, tokens.associated_user_scope ?? "");
    if (missing.length) throw new StaffAuthError(`Your Shopify staff account lacks required permissions: ${missing.join(", ")}. Ask the store owner to grant app, order-editing, and product access, and verify the app's approved scopes.`, 403);
    const associated = tokens.associated_user;
    user = {
      id: String(associated.id),
      email: associated.email,
      name: [associated.first_name, associated.last_name].filter(Boolean).join(" ") || associated.email,
    };
  }
  shop ??= await ensureEmbeddedInstallation(identity.shop, idToken, env);
  if (!shop) return null;
  return { shop, user };
}

export async function verifyIdToken(token: string, env: Env): Promise<{ shop: string; userId: string } | null> {
  const [encodedHeader, encodedPayload, signature, extra] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature || extra) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64(encodedHeader))) as { alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(fromBase64(encodedPayload))) as Partial<IdTokenPayload>;
    if (header.alg !== "HS256" || !await verifyHmac(`${encodedHeader}.${encodedPayload}`, signature, env.SHOPIFY_API_SECRET)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== env.SHOPIFY_API_KEY || !payload.sub || !payload.exp || payload.exp <= now || !payload.nbf || payload.nbf > now) return null;
    const issuer = new URL(payload.iss ?? "");
    const destination = new URL(payload.dest ?? "");
    const shop = destination.hostname.toLowerCase();
    if (issuer.hostname.toLowerCase() !== shop || !validShop(shop)) return null;
    return { shop, userId: payload.sub };
  } catch {
    return null;
  }
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

async function ensureEmbeddedInstallation(domain: string, idToken: string, env: Env): Promise<ShopRow | null> {
  const existing = await findShop(env, domain);
  if (existing) return existing;
  const tokens = await exchangeIdToken(domain, idToken, "offline", env);
  if (!tokens || missingScopes(env.SHOPIFY_SCOPES, tokens.scope).length) throw new StaffAuthError("The app installation lacks required scopes. Ask the store owner to open the app and approve its requested access.", 403);
  await saveInstallation(domain, tokens, env);
  return findShop(env, domain);
}

async function exchangeIdToken(shop: string, idToken: string, mode: "online" | "offline", env: Env): Promise<TokenResponse | null> {
  const exchange = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: idToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: `urn:shopify:params:oauth:token-type:${mode}-access-token`,
      ...(mode === "offline" ? { expiring: "1" } : {}),
    }),
  };
  let response = await fetch(`https://${shop}/admin/oauth/access_token`, exchange);
  // Retry online authorization only; repeating offline exchange can rotate stored tokens.
  for (let attempt = 0; mode === "online" && response.status >= 500 && attempt < 2; attempt++) {
    console.warn(JSON.stringify({ operation: "staff_token_exchange_retry", mode, status: response.status, attempt: attempt + 1 }));
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    response = await fetch(`https://${shop}/admin/oauth/access_token`, exchange);
  }
  if (!response.ok) {
    // Never log the response body, credentials, or ID token.
    console.warn(JSON.stringify({ operation: "staff_token_exchange", mode, status: response.status }));
    if (response.status === 400) throw new StaffAuthError("Shopify could not exchange the session token. Reopen the app from Shopify Admin; if this persists, verify the app credentials and installation.", 401, true);
    if (response.status === 401 || response.status === 403) throw new StaffAuthError("Shopify rejected the app's authorization. Verify that the deployed client ID and secret belong to the installed app.", 502);
    throw new StaffAuthError("Shopify authentication is temporarily unavailable. Please try again.", 502);
  }
  return response.json<TokenResponse>();
}

async function saveInstallation(shop: string, tokens: TokenResponse, env: Env): Promise<void> {
  const access = await encrypt(tokens.access_token, env);
  const refresh = tokens.refresh_token ? await encrypt(tokens.refresh_token, env) : null;
  const now = new Date();
  await env.DB.prepare(`INSERT INTO shops (
      id, shop_domain, access_token_ciphertext, access_token_iv, refresh_token_ciphertext, refresh_token_iv,
      token_expires_at, refresh_token_expires_at, scopes, installed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_domain) DO UPDATE SET
      access_token_ciphertext=excluded.access_token_ciphertext, access_token_iv=excluded.access_token_iv,
      refresh_token_ciphertext=excluded.refresh_token_ciphertext, refresh_token_iv=excluded.refresh_token_iv,
      token_expires_at=excluded.token_expires_at, refresh_token_expires_at=excluded.refresh_token_expires_at,
      scopes=excluded.scopes, status='ACTIVE', updated_at=excluded.updated_at`)
    .bind(`shop_${crypto.randomUUID()}`, shop, access.ciphertext, access.iv, refresh?.ciphertext ?? null, refresh?.iv ?? null,
      tokens.expires_in ? new Date(now.getTime() + tokens.expires_in * 1000).toISOString() : null,
      tokens.refresh_token_expires_in ? new Date(now.getTime() + tokens.refresh_token_expires_in * 1000).toISOString() : null,
      tokens.scope, now.toISOString(), now.toISOString()).run();

  const stored = await findShop(env, shop);
  if (!stored) throw new Error("Installation could not be saved");
  try {
    const data = await shopifyGraphql<{ shop: { ianaTimezone: string } }>(shop, tokens.access_token, env, `query ShopTimezone { shop { ianaTimezone } }`);
    await env.DB.prepare("UPDATE shops SET timezone=?, updated_at=? WHERE id=?").bind(data.shop.ianaTimezone, new Date().toISOString(), stored.id).run();
    await registerUninstallWebhook(shop, tokens.access_token, env);
  } catch (error) {
    console.warn(JSON.stringify({ operation: "post_install_setup", shopDomain: shop, status: "failed", message: safeError(error) }));
  }
}

const bearerToken = (request: Request): string | null => {
  const match = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i);
  return match?.[1] ?? null;
};

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

const safeError = (error: unknown): string => error instanceof Error ? error.message.slice(0, 300) : "Unknown error";
