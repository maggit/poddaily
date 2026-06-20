import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/** Sign a one-time state value: `${nonce}.${issuedAt}.${hmac}`. */
export function signState(secret: string, now: number = Date.now()): string {
  const payload = `${randomBytes(16).toString("hex")}.${now}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** Verify HMAC + freshness. Stateless CSRF mitigation (no server-side nonce store). */
export function verifyState(secret: string, state: string, now: number = Date.now()): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, issued, sig] = parts;
  const expected = createHmac("sha256", secret).update(`${nonce}.${issued}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const ts = Number(issued);
  return Number.isFinite(ts) && now >= ts && now - ts <= MAX_AGE_MS;
}
