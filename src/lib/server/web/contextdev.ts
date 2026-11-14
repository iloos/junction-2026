/**
 * Context.dev adapter: structured extraction of recall pages (`POST /web/scrape` with `formats.json`),
 * page monitors with webhooks (`/monitors`), and webhook signature checks. Plain fetch, no SDK.
 * The fixture twin (fixture.ts) serves recorded real responses through the same interface.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebCall } from './http';
import {
	RECALL_INSTRUCTIONS,
	RECALL_JSON_SCHEMA,
	RECALL_LIST_SCHEMA,
	RECALL_LIST_URL,
	RecallListItem,
	RecallNotice
} from './recall';

export interface RecallSource {
	readonly mode: 'live' | 'fixture';
	/** Newest notices on the authority's recall list. `maxAgeMs: 0` reads the page fresh. */
	readList(o?: { maxAgeMs?: number }): Promise<RecallListItem[]>;
	/** One notice page as structured fields. */
	readNotice(url: string, o?: { maxAgeMs?: number }): Promise<RecallNotice>;
}

interface ScrapeJson<T> {
	json?: { success: boolean | null; data: T | null; message?: string; error_code?: string };
	cache_metadata?: { status?: string; age_ms?: number };
}

export function createContextDev(call: WebCall): RecallSource & {
	createMonitor(m: MonitorSpec): Promise<{ id: string; webhookSecret?: string; raw: unknown }>;
	listMonitors(): Promise<unknown>;
} {
	async function scrapeJson<T>(
		url: string,
		schema: unknown,
		instructions: string,
		maxAgeMs: number | undefined,
		purpose: string
	) {
		const body = {
			url,
			formats: { json: true },
			sharedParams: { mainContentOnly: true },
			jsonParams: { schema, instructions },
			// Context.dev's own cache: 0 forces a fresh read of the page.
			...(maxAgeMs === 0 ? { maxAgeMs: 0 } : {})
		};
		const r = await call<ScrapeJson<T>>('/web/scrape', body, { maxAgeMs, purpose });
		const out = r.body.json;
		if (!out?.success || !out.data)
			throw new Error(
				`Context.dev could not extract ${url}: ${out?.error_code ?? 'no data'} ${out?.message ?? ''}`.trim()
			);
		return { data: out.data, at: r.at };
	}

	return {
		mode: 'live',
		async readList(o = {}) {
			const { data } = await scrapeJson<{ recalls: unknown[] }>(
				RECALL_LIST_URL,
				RECALL_LIST_SCHEMA,
				'List every food recall notice on the page, newest first, with its date and link.',
				o.maxAgeMs,
				'recall list'
			);
			return (data.recalls ?? []).flatMap((x) => {
				const p = RecallListItem.safeParse(x);
				return p.success ? [p.data] : [];
			});
		},
		async readNotice(url, o = {}) {
			const { data, at } = await scrapeJson<Record<string, unknown>>(
				url,
				RECALL_JSON_SCHEMA,
				RECALL_INSTRUCTIONS,
				o.maxAgeMs,
				'recall notice'
			);
			return RecallNotice.parse({ ...data, url, fetchedAt: at });
		},
		async createMonitor(m) {
			const r = await call<{ id: string; webhook?: { secret?: string } }>(
				'/monitors',
				{
					name: m.name,
					tags: ['mandate', 'recall'],
					target: { type: 'page', url: m.url, instructions: m.instructions },
					change_detection: { type: 'semantic', confidence_threshold: 0.6 },
					schedule: { type: 'interval', frequency: m.everyMinutes, unit: 'minutes' },
					webhook: m.webhookUrl
						? { url: m.webhookUrl, events: ['change.detected'], retry: {} }
						: null
				},
				{ maxAgeMs: 0, purpose: 'create monitor' }
			);
			return { id: r.body.id, webhookSecret: r.body.webhook?.secret, raw: r.body };
		},
		async listMonitors() {
			return (await call('/monitors', undefined, { maxAgeMs: 0, purpose: 'list monitors' })).body;
		}
	};
}

export interface MonitorSpec {
	name: string;
	url: string;
	instructions: string;
	everyMinutes: number;
	webhookUrl?: string;
}

/** Context.dev `change.detected` webhook body (the fields we use). */
export interface ChangeDetected {
	event: 'change.detected' | string;
	id: string;
	created_at: string;
	data: {
		change: {
			id: string;
			monitor_id: string;
			title: string;
			summary: string;
			detected_at: string;
			url: string;
			importance?: string;
			confidence?: number;
			diff?: string;
			after_text_excerpt?: string;
			matched_urls?: string[];
			added_urls?: string[];
		};
	};
}

/** Webhook timestamps older than this are refused (replay protection). */
export const SIGNATURE_TOLERANCE_S = 300;

/**
 * Checks `X-Context-Signature: t=<unix>,v1=<hex>`: HMAC-SHA256 of `${t}.${rawBody}` keyed with the
 * monitor's webhook secret, compared in constant time, timestamp within tolerance.
 */
export function verifyContextSignature(
	rawBody: string,
	header: string | null,
	secret: string,
	nowS = Math.floor(Date.now() / 1000)
): boolean {
	if (!header || !secret) return false;
	const parts = Object.fromEntries(
		header.split(',').map((kv) => {
			const i = kv.indexOf('=');
			return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
		})
	);
	const t = Number(parts.t);
	if (!Number.isFinite(t) || Math.abs(nowS - t) > SIGNATURE_TOLERANCE_S || !parts.v1) return false;
	const want = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
	const a = Buffer.from(want, 'hex');
	const b = Buffer.from(String(parts.v1), 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time compare for the shared-secret header used by our own scripts and replays. */
export function sameSecret(given: string | null, secret: string | undefined): boolean {
	if (!given || !secret || secret.length < 16) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}
