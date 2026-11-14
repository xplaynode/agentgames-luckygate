// HMAC-SHA256 signing/verification for the x-agent-games-signature header.
//
// The platform signs every request over the RAW body bytes; we must verify
// BEFORE parsing JSON, with a constant-time comparison. The docs do not state
// the header's exact encoding, so verification accepts the two sane forms —
// bare hex (either case) and a "sha256=" prefix — while our own responses
// always use bare lowercase hex (the overwhelmingly standard form).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-agent-games-signature';

/** Compute the lowercase-hex HMAC-SHA256 of a Buffer/string body. */
export function signBody(body, secret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function candidateDigests(headerValue) {
  if (typeof headerValue !== 'string') return [];
  let v = headerValue.trim();
  if (v.toLowerCase().startsWith('sha256=')) v = v.slice('sha256='.length).trim();
  const out = [];
  if (/^[0-9a-fA-F]{64}$/.test(v)) out.push(Buffer.from(v, 'hex'));
  // Tolerate base64 as a last resort (not documented; harmless to accept).
  try {
    const b = Buffer.from(v, 'base64');
    if (b.length === 32) out.push(b);
  } catch { /* ignore */ }
  return out;
}

/** Constant-time verification of a signature header against the raw body. */
export function verifyBody(body, headerValue, secret) {
  const expected = createHmac('sha256', secret).update(body).digest();
  for (const cand of candidateDigests(headerValue)) {
    if (cand.length === expected.length && timingSafeEqual(cand, expected)) return true;
  }
  return false;
}
