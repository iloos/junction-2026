import { z } from 'zod';

/** Closed error codes (D6). Returned by calls; a line's state is explained by `LineReason` instead. */
export const ErrorCode = z.enum([
	'INVALID_INPUT',
	'NOT_FOUND',
	'FORBIDDEN',
	'STALE_VERSION',
	'TERMS_CHANGED',
	'UNKNOWN_REQUIRED',
	'INSUFFICIENT_STOCK',
	'BELOW_LOT',
	'CAP_EXCEEDED',
	'DUPLICATE',
	'PROVIDER_UNAVAILABLE',
	/** A bug on our side; not retryable. */
	'INTERNAL'
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Whether the same call can succeed later without the caller changing anything. */
export const RETRYABLE: Record<ErrorCode, boolean> = {
	INVALID_INPUT: false,
	NOT_FOUND: false,
	FORBIDDEN: false,
	STALE_VERSION: true,
	TERMS_CHANGED: false,
	UNKNOWN_REQUIRED: false,
	INSUFFICIENT_STOCK: false,
	BELOW_LOT: false,
	CAP_EXCEEDED: false,
	DUPLICATE: false,
	PROVIDER_UNAVAILABLE: true,
	INTERNAL: false
};

export const DomainError = z.object({
	code: ErrorCode,
	message: z.string(),
	retryable: z.boolean(),
	/**
	 * Sub-code, e.g. CAP_EXCEEDED → "weekly" (eval vocabulary: "CAP_EXCEEDED.weekly").
	 * FORBIDDEN uses "scope" (never allowed for this caller) vs "approval_required" (wait for a human).
	 */
	sub: z.string().optional(),
	detail: z.record(z.string(), z.unknown()).optional()
});
export type DomainError = z.infer<typeof DomainError>;

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export function err(
	code: ErrorCode,
	message: string,
	extra: { sub?: string; detail?: Record<string, unknown> } = {}
): { ok: false; error: DomainError } {
	return { ok: false, error: { code, message, retryable: RETRYABLE[code], ...extra } };
}
