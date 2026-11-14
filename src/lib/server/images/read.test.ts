import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR } from '$lib/core/contracts';
import type { CallContext, Llm } from '$lib/core/ports';
import { RateLimited } from '../external/call';
import { verdaLlm } from '../adapters/llm/verda';
import { MAX_IMAGE_BYTES, parseReading, readImage } from './read';
import { readImageHandler } from './tool';

const sample = (f: string) => readFileSync(`fixtures/images/${f}`).toString('base64');
const png = (f: string) => ({ imageBase64: sample(f), mimeType: 'image/png' });

describe('read_image service (no network)', () => {
	it('fixture mode answers the three sample pictures from their expected readings', async () => {
		const kinds: Record<string, string> = {
			'prep-list.png': 'list',
			'delivery-note.png': 'delivery_note',
			'label.png': 'label'
		};
		for (const [f, kind] of Object.entries(kinds)) {
			const r = await readImage(png(f), { llm: null });
			expect(r.ok && r.value).toMatchObject({ source: 'fixture', reading: { kind } });
		}
		const note = await readImage(png('delivery-note.png'), { llm: null });
		expect(note.ok && note.value.reading.lines.find((l) => /Kirjolohi/.test(l.text))?.qty).toBe(7);
	});

	it('refuses a wrong type, bytes that are not the declared type, a picture over 4 MB, and an unknown picture offline', async () => {
		expect(
			await readImage({ ...png('label.png'), mimeType: 'image/gif' }, { llm: null })
		).toMatchObject({
			ok: false,
			error: { code: 'INVALID_INPUT' }
		});
		const asJpeg = await readImage({ ...png('label.png'), mimeType: 'image/jpeg' }, { llm: null });
		expect(asJpeg.ok ? '' : asJpeg.error.message).toMatch(/bytes are image\/png/);
		const big = Buffer.alloc(MAX_IMAGE_BYTES + 10);
		big.set([0x89, 0x50, 0x4e, 0x47]);
		const tooBig = await readImage(
			{ imageBase64: big.toString('base64'), mimeType: 'image/png' },
			{ llm: null }
		);
		expect(tooBig.ok ? '' : tooBig.error.message).toMatch(/limit is 4 MB/);
		const other = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const unknown = await readImage(
			{ imageBase64: other.toString('base64'), mimeType: 'image/png' },
			{ llm: null }
		);
		expect(unknown).toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' } });
	});

	it('sends the picture to the model once, parses its JSON (nulls dropped) and keeps nothing else', async () => {
		const seen: Parameters<Llm['generate']>[0][] = [];
		const llm: Llm = {
			async generate(req) {
				seen.push(req);
				return {
					text: '```json\n{"kind":"list","lines":[{"text":"Voi 4 kg","qty":4,"unit":"kg","productHint":null}],"notes":null,"confidence":0.8}\n```',
					model: 'nemotron-3.5-super-vl',
					tokens: { in: 900, out: 60 },
					latencyMs: 1200
				};
			}
		};
		const r = await readImage({ ...png('prep-list.png'), purpose: 'Saturday order' }, { llm });
		expect(seen).toHaveLength(1);
		expect(seen[0].images?.[0].mimeType).toBe('image/png');
		expect(seen[0].prompt).toMatch(/Saturday order/);
		expect(r.ok && r.value).toMatchObject({
			source: 'live',
			reading: { kind: 'list', lines: [{ text: 'Voi 4 kg', qty: 4, unit: 'kg' }] }
		});
		expect(parseReading('{"kind":"poem","lines":[]}')).toBeNull();
	});

	it('the tool needs the read scope and labels its summary', async () => {
		const ctx: CallContext = {
			workspaceId: 'ws-x',
			runId: 'run-1',
			actor: { kind: 'chef', id: 'c' },
			scopes: SCOPES_BY_ACTOR.chef,
			via: 'test'
		};
		const tool = readImageHandler({ llm: () => null });
		const r = await tool(ctx, png('label.png'));
		expect(r.ok && r.value.meta?.summary).toMatch(/^\[fixture\] Read a label: 1 line/);
		expect(await tool({ ...ctx, scopes: [] }, png('label.png'))).toMatchObject({
			ok: false,
			error: { code: 'FORBIDDEN' }
		});
	});
});

describe('Verda adapter (fake fetch)', () => {
	it('sends an OpenAI-style image message with thinking off and max_tokens', async () => {
		let body: Record<string, unknown> = {};
		const f = (async (_u: string, init: RequestInit) => {
			body = JSON.parse(String(init.body));
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: '{}', reasoning_content: 'ignored' } }],
					usage: { prompt_tokens: 10, completion_tokens: 2 }
				})
			);
		}) as unknown as typeof fetch;
		const llm = verdaLlm({ apiKey: 'k', fetch: f });
		const r = await llm.generate({
			prompt: 'p',
			maxTokens: 1500,
			images: [{ mimeType: 'image/png', base64: 'AAAA' }]
		});
		expect(body).toMatchObject({
			model: 'nemotron-3.5-super-vl',
			max_tokens: 1500,
			chat_template_kwargs: { enable_thinking: false }
		});
		const content = (body.messages as { content: { type: string }[] }[])[0].content;
		expect(content.map((c) => c.type)).toEqual(['text', 'image_url']);
		expect(r).toMatchObject({ text: '{}', tokens: { in: 10, out: 2 } });
	});

	it('a 429 becomes RateLimited with its Retry-After', async () => {
		const f = (async () =>
			new Response('{}', {
				status: 429,
				headers: { 'retry-after': '12' }
			})) as unknown as typeof fetch;
		await expect(
			verdaLlm({ apiKey: 'k', fetch: f }).generate({ prompt: 'p', maxTokens: 5 })
		).rejects.toMatchObject({ retryAfterS: 12 });
		await expect(
			verdaLlm({ apiKey: 'k', fetch: f }).generate({ prompt: 'p', maxTokens: 5 })
		).rejects.toBeInstanceOf(RateLimited);
	});
});
