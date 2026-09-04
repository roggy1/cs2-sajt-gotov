import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal signed-cookie session, server-only.
 *
 * The cookie holds just the steamid64 plus an HMAC signature — it is never
 * trusted without verifying that signature, so a user can't hand-edit the
 * cookie to impersonate another Steam account. HttpOnly keeps it out of
 * reach of any script on the page.
 */
const COOKIE_NAME = "cs2hub_steam";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  // A fixed dev fallback keeps local development working without setup;
  // production should always set SESSION_SECRET in the environment.
  return process.env.SESSION_SECRET ?? "cs2-inventory-hub-dev-secret";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionCookie(steamId: string): string {
  const payload = `${steamId}.${sign(steamId)}`;
  return [
    `${COOKIE_NAME}=${payload}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Returns the verified steamid64 from the request, or null. */
export function readSession(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  const raw = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;

  const steamId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  const expected = Buffer.from(sign(steamId));
  const received = Buffer.from(signature);
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  return /^\d{17}$/.test(steamId) ? steamId : null;
}
