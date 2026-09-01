import { base64url, fromBase64 } from "./crypto";
import { PermanentError, RetryableError } from "./core";
import type { Env } from "./types";

const encoder = new TextEncoder();
let cachedToken: { value: string; expiresAt: number; email: string } | undefined;

export const BEFORE_HEADERS = [
  "Timestamp", "Shop Domain", "Job ID", "Order ID", "Order Name", "Order Created At", "Customer Email",
  "Variant ID", "Product Title", "Variant Title", "SKU", "Quantity Before", "Unit Price", "Line Item ID",
  "Order Total Before", "Processing Status",
];

export const AFTER_HEADERS = [
  "Timestamp", "Shop Domain", "Job ID", "Order ID", "Order Name", "Variant ID", "Product Title", "Variant Title",
  "SKU", "Quantity After", "Order Total After", "Shopify Order Edit ID", "Processing Status", "Error",
];

async function googleToken(env: Env): Promise<string> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new PermanentError("Google Sheets service-account credentials are not configured");
  }
  if (cachedToken && cachedToken.email === env.GOOGLE_SERVICE_ACCOUNT_EMAIL && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(encoder.encode(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const pem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", fromBase64(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new PermanentError("Google private key is invalid");
  }
  const unsigned = `${header}.${claims}`;
  const signature = base64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned)));
  const response = await googleFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const data = await response.json<{ access_token?: string; expires_in?: number; error_description?: string }>();
  if (!data.access_token) throw new PermanentError(`Google authentication failed: ${data.error_description ?? "missing access token"}`);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000, email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL };
  return data.access_token;
}

export async function validateAuditSheet(env: Env): Promise<void> {
  if (!env.GOOGLE_SPREADSHEET_ID) throw new PermanentError("Google spreadsheet ID is not configured");
  const response = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${await googleToken(env)}` },
  });
  const data = await response.json<{ sheets?: Array<{ properties: { title: string } }> }>();
  const tabs = new Set(data.sheets?.map((sheet) => sheet.properties.title));
  if (!tabs.has("BEFORE") || !tabs.has("AFTER")) throw new PermanentError("Google spreadsheet must contain BEFORE and AFTER tabs");
  const ranges = new URLSearchParams();
  ranges.append("ranges", "BEFORE!A1:P1");
  ranges.append("ranges", "AFTER!A1:N1");
  ranges.append("ranges", "BEFORE!A:A");
  ranges.append("ranges", "AFTER!A:A");
  const headersResponse = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values:batchGet?${ranges}`, {
    headers: { Authorization: `Bearer ${await googleToken(env)}` },
  });
  const headers = await headersResponse.json<{ valueRanges?: Array<{ values?: string[][] }> }>();
  if (JSON.stringify(headers.valueRanges?.[0]?.values?.[0]) !== JSON.stringify(BEFORE_HEADERS) ||
      JSON.stringify(headers.valueRanges?.[1]?.values?.[0]) !== JSON.stringify(AFTER_HEADERS)) {
    throw new PermanentError("Google spreadsheet audit headers do not match the documented BEFORE/AFTER columns");
  }
  const beforeNext = (headers.valueRanges?.[2]?.values?.length ?? 1) + 1;
  const afterNext = (headers.valueRanges?.[3]?.values?.length ?? 1) + 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE audit_counters SET next_row=MAX(next_row, ?) WHERE tab='BEFORE'").bind(beforeNext),
    env.DB.prepare("UPDATE audit_counters SET next_row=MAX(next_row, ?) WHERE tab='AFTER'").bind(afterNext),
  ]);
}

export async function writeRows(env: Env, tab: "BEFORE" | "AFTER", startRow: number, rows: Array<Array<string | number>>): Promise<void> {
  if (!rows.length) return;
  if (!env.GOOGLE_SPREADSHEET_ID) throw new PermanentError("Google spreadsheet ID is not configured");
  const width = tab === "BEFORE" ? BEFORE_HEADERS.length : AFTER_HEADERS.length;
  const range = `${tab}!A${startRow}:${columnName(width)}${startRow + rows.length - 1}`;
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${await googleToken(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range, majorDimension: "ROWS", values: rows }),
  });
}

async function googleFetch(url: string, init: RequestInit, attempt = 1): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    if (attempt < 3) return googleFetch(url, init, attempt + 1);
    throw new RetryableError("Google Sheets network request failed");
  }
  if ((response.status === 429 || response.status >= 500) && attempt < 3) return googleFetch(url, init, attempt + 1);
  if (response.status === 429 || response.status >= 500) throw new RetryableError(`Google Sheets returned HTTP ${response.status}`);
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.clone().json<{ error?: { message?: string } }>();
      detail = body.error?.message?.slice(0, 300) ?? "";
    } catch { /* Google did not return JSON. */ }
    throw new PermanentError(`Google Sheets returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response;
}

function columnName(count: number): string {
  let result = "";
  for (let value = count; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}
