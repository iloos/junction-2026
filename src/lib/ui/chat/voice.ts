/**
 * Voice input (chat-harness §1c): the microphone streams to Soniox's EU real-time endpoint with a short-lived key from
 * /api/stt/token; the words come back as final and partial text for the chat input. Nothing is sent to the agent on
 * voice alone, and no audio is kept: the recorder's chunks go to the socket and are dropped.
 */

let enabled: Promise<boolean> | null = null;

/** Whether voice input can run here: the server has a key, and the browser can record. */
export function voiceAvailable(): Promise<boolean> {
	if (
		typeof window === 'undefined' ||
		!navigator.mediaDevices?.getUserMedia ||
		typeof MediaRecorder === 'undefined' ||
		typeof WebSocket === 'undefined'
	)
		return Promise.resolve(false);
	enabled ??= fetch('/api/stt/token')
		.then((r) => (r.ok ? r.json() : { enabled: false }))
		.then((j: { enabled?: boolean }) => !!j.enabled)
		.catch(() => false);
	return enabled;
}

export interface Dictation {
	/** Stop listening; the last words still arrive, then `ondone`. */
	stop(): void;
}

export interface DictationEvents {
	/** Everything heard so far: `final` is settled, `partial` may still change. */
	ontext(final: string, partial: string): void;
	/** Recording ended (stopped, finished or failed). */
	ondone(error?: string): void;
}

const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** Ask for the microphone, open the socket, and stream until `stop()`. Rejects with words a chef can read. */
export async function startDictation(ev: DictationEvents): Promise<Dictation> {
	const r = await fetch('/api/stt/token', { method: 'POST' });
	const tok = (await r.json().catch(() => null)) as {
		apiKey?: string;
		url?: string;
		error?: { message?: string };
	} | null;
	if (!r.ok || !tok?.apiKey || !tok.url)
		throw new Error(tok?.error?.message ?? 'Voice input is not available right now');

	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
		});
	} catch {
		throw new Error('The microphone is blocked: allow it in the browser to dictate');
	}

	const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m));
	const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
	const ws = new WebSocket(tok.url, ['soniox-api-key', tok.apiKey]);
	let final = '';
	let ended = false;
	const release = () => stream.getTracks().forEach((t) => t.stop());
	const end = (error?: string) => {
		if (ended) return;
		ended = true;
		if (rec.state !== 'inactive') rec.stop();
		release();
		if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
		ev.ondone(error);
	};

	ws.onopen = () => {
		ws.send(
			JSON.stringify({
				model: 'stt-rt-v6',
				audio_format: 'auto',
				language_hints: ['fi', 'en'],
				context: {
					general: [
						{ key: 'domain', value: 'Professional kitchen purchasing' },
						{ key: 'supplier', value: 'Valio Aimo' }
					]
				}
			})
		);
		// What was said while the socket opened goes first, so the first word isn't lost.
		for (const c of early.splice(0)) ws.send(c);
		if (rec.state === 'inactive') ws.send('');
	};
	// Recording starts at once; chunks wait in memory until the socket is open, then stream and are dropped.
	const early: Blob[] = [];
	rec.ondataavailable = (e) => {
		if (!e.data.size) return;
		if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
		else early.push(e.data);
	};
	rec.onstop = () => {
		if (ws.readyState === WebSocket.OPEN) ws.send('');
	};
	rec.start(250);
	ws.onmessage = (e) => {
		const m = JSON.parse(String(e.data)) as {
			tokens?: { text: string; is_final: boolean }[];
			finished?: boolean;
			error_code?: number;
			error_message?: string;
		};
		if (m.error_code) return end(m.error_message ?? 'The speech service stopped');
		let partial = '';
		for (const t of m.tokens ?? []) {
			if (t.text === '<end>') continue;
			if (t.is_final) final += t.text;
			else partial += t.text;
		}
		ev.ontext(final, partial);
		if (m.finished) end();
	};
	ws.onerror = () => end('The speech service could not be reached');
	ws.onclose = () => end();

	return {
		stop() {
			if (rec.state !== 'inactive') rec.stop();
			else end();
			// The last words arrive within a moment; never hang on a silent socket.
			setTimeout(() => end(), 4000);
		}
	};
}
