import { createHmac, timingSafeEqual } from 'node:crypto';

const MAGIC_VERSION = 1;

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

/**
 * C3: time-limited HMAC link for “recover booking view” — does not replace `publicViewToken`,
 * but proves control of the email + reservation id (same as stored on the quote).
 */
export function signPublicBookingMagicLink(secret: string, reservationId: string, ttlSec: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${MAGIC_VERSION}:${reservationId}:${exp}`;
  const sig = createHmac('sha256', secret).update(payload, 'utf8').digest();
  return `${b64url(Buffer.from(payload, 'utf8'))}.${b64url(sig)}`;
}

export function verifyPublicBookingMagicLink(
  secret: string,
  token: string,
): { reservationId: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot < 1 || dot === token.length - 1) {
    return null;
  }
  const enc = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let payload: string;
  try {
    payload = fromB64url(enc).toString('utf8');
  } catch {
    return null;
  }
  const expectedSig = createHmac('sha256', secret).update(payload, 'utf8').digest();
  let sigBuf: Buffer;
  try {
    sigBuf = fromB64url(sigB64);
  } catch {
    return null;
  }
  if (sigBuf.length !== expectedSig.length || !timingSafeEqual(sigBuf, expectedSig)) {
    return null;
  }
  const parts = payload.split(':');
  if (parts.length !== 3) {
    return null;
  }
  const ver = Number(parts[0]);
  const rid = parts[1];
  const exp = Number(parts[2]);
  if (ver !== MAGIC_VERSION || !rid || !Number.isFinite(exp)) {
    return null;
  }
  if (exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return { reservationId: rid };
}
