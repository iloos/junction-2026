/**
 * Voice input (chat-harness §1c): the browser streams speech straight to Soniox's EU real-time endpoint with a
 * short-lived key minted here from SONIOX_API_KEY. The account key never leaves the server; no audio passes through
 * or is stored here. Each visitor may mint a few keys per window, so a page left open can't run up the bill.
 */

export const SONIOX_WS_URL = 'wss://stt-rt.eu.soniox.com/transcribe-websocket';
const MINT_URL = 'https://api.eu.soniox.com/v1/auth/temporary-api-key';
/** Long enough to open the socket; Soniox keeps an open session alive past it. */
const KEY_SECONDS = 60;
/** One dictation at most this long. */
const SESSION_SECONDS = 180;
const WINDOW_MS = 10 * 60_000;
const PER_WINDOW = 20;

const minted = new Map<string, number[]>();

/** Whether this visitor may mint another key now; records the mint when it may. */
export function allowMint(visitor: string, now = Date.now()): boolean {
	const recent = (minted.get(visitor) ?? []).filter((t) => now - t < WINDOW_MS);
	if (recent.length >= PER_WINDOW) {
		minted.set(visitor, recent);
		return false;
	}
	recent.push(now);
	minted.set(visitor, recent);
	if (minted.size > 5000) minted.delete(minted.keys().next().value!);
	return true;
}

export type MintResult =
	| { ok: true; apiKey: string; expiresAt: string; url: string }
	| { ok: false; status: number; message: string };

/** A temporary key for one WebSocket session, bound to the visitor for Soniox's usage logs. */
export async function mintKey(
	accountKey: string,
	visitor: string,
	fetcher: typeof fetch = fetch
): Promise<MintResult> {
	const r = await fetcher(MINT_URL, {
		method: 'POST',
		headers: { authorization: `Bearer ${accountKey}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			usage_type: 'transcribe_websocket',
			expires_in_seconds: KEY_SECONDS,
			max_session_duration_seconds: SESSION_SECONDS,
			single_use: true,
			client_reference_id: visitor.slice(0, 256)
		}),
		signal: AbortSignal.timeout(8000)
	}).catch(() => null);
	if (!r) return { ok: false, status: 502, message: 'Speech service unreachable' };
	const body = (await r.json().catch(() => null)) as {
		api_key?: string;
		expires_at?: string;
	} | null;
	if (!r.ok || !body?.api_key)
		return { ok: false, status: 502, message: `Speech service refused (${r.status})` };
	return { ok: true, apiKey: body.api_key, expiresAt: body.expires_at ?? '', url: SONIOX_WS_URL };
}
