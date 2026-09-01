import type { Env } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const base64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

async function hmacBytes(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

const hmac = async (secret: string, message: string): Promise<string> => base64url(await hmacBytes(secret, message));

export async function signedValue(payload: object, secret: string): Promise<string> {
  const value = base64url(encoder.encode(JSON.stringify(payload)));
  return `${value}.${await hmac(secret, value)}`;
}

export async function verifySignedValue<T>(value: string | undefined, secret: string): Promise<T | null> {
  if (!value) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !constantTimeEqual(signature, await hmac(secret, payload))) return null;
  try {
    const parsed = JSON.parse(decoder.decode(fromBase64(payload))) as T & { exp?: number };
    return parsed.exp && parsed.exp < Date.now() ? null : parsed;
  } catch {
    return null;
  }
}

export async function verifyHmac(message: string, supplied: string | null, secret: string): Promise<boolean> {
  if (!supplied) return false;
  if (/^[0-9a-f]{64}$/i.test(supplied)) {
    const expected = [...new Uint8Array(await hmacBytes(secret, message))]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return constantTimeEqual(expected, supplied.toLowerCase());
  }
  return constantTimeEqual(await hmac(secret, message), supplied.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return different === 0;
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const bytes = fromBase64(env.TOKEN_ENCRYPTION_KEY);
  if (bytes.byteLength !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(value: string, env: Env): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), encoder.encode(value));
  return { ciphertext: base64url(ciphertext), iv: base64url(iv) };
}

export async function decrypt(ciphertext: string, iv: string, env: Env): Promise<string> {
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await encryptionKey(env), fromBase64(ciphertext));
  return decoder.decode(clear);
}

export const cookie = (name: string, value: string, maxAge: number): string =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export function readCookie(request: Request, name: string): string | undefined {
  return request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
