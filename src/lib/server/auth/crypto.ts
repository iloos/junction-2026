/**
 * The one constant-time comparison and HMAC helper for every secret the server checks: bearer keys, judge keys,
 * visitor cookies, presenter sessions and webhook signatures.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time equality of two byte strings (false when the lengths differ). */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time equality of two strings, compared as UTF-8 bytes. */
export function sameText(a: string, b: string): boolean {
	return sameBytes(Buffer.from(a), Buffer.from(b));
}

/** HMAC-SHA256 of `text` under `secret`, base64url by default. */
export function hmac(
	secret: string,
	text: string,
	encoding: 'base64url' | 'hex' = 'base64url'
): string {
	return createHmac('sha256', secret).update(text).digest(encoding);
}
