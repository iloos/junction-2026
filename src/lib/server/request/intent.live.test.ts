/**
 * Held-out paraphrases per kind of the D20 shape, English and Finnish, written apart from the prompt's few-shot
 * examples: run on the first-pass parse model and on the escalate model to measure the D12 cascade. Opt-in and live:
 *   INTENT_LIVE=1 LLM_PROVIDER=gemini node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/request/intent.live.test.ts
 * Results are written to scratch/intent-eval.json and printed; nothing is asserted beyond the calls succeeding.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLlmRouter } from '$lib/server/adapters/llm/router';
import type { Env } from '$lib/server/auth';
import { parseRequest, type ParsedRequest } from './parse';

type Want =
	| { intent: 'question' | 'change' }
	| { amount: 'exact' | 'range' | 'max_available' | 'for_people' | 'unknown'; what?: 'dish' };

export const HELD_OUT: Record<string, { text: string; want: Want }[]> = {
	exact: [
		{ text: 'send 12 kg of onions on Wednesday', want: { amount: 'exact' } },
		{ text: 'tarvitsen 6 litraa kermaa torstaiksi', want: { amount: 'exact' } },
		{ text: 'two cases of lemons', want: { amount: 'exact' } },
		{ text: '40 kpl kananmunia', want: { amount: 'exact' } },
		{ text: '1.5 kg unsalted butter', want: { amount: 'exact' } }
	],
	range: [
		{ text: 'somewhere between 10 and 15 kg of potatoes', want: { amount: 'range' } },
		{ text: 'noin 3–4 kiloa juustoa', want: { amount: 'range' } },
		{ text: '20 to 25 litres of milk for Monday', want: { amount: 'range' } },
		{ text: '8-10 kg broileria', want: { amount: 'range' } },
		{ text: 'maybe 2 or 3 cases of apples', want: { amount: 'range' } }
	],
	max_available: [
		{ text: 'whatever salmon you have left', want: { amount: 'max_available' } },
		{ text: 'kaikki mitä teillä on porkkanoita', want: { amount: 'max_available' } },
		{ text: 'as many lemons as you can deliver', want: { amount: 'max_available' } },
		{ text: 'your whole stock of whipping cream please', want: { amount: 'max_available' } },
		{ text: 'niin paljon voita kuin saatte', want: { amount: 'max_available' } }
	],
	for_people: [
		{ text: 'rice for 60 guests', want: { amount: 'for_people' } },
		{ text: 'maitoa 200 hengelle', want: { amount: 'for_people' } },
		{ text: 'enough coffee cream for 45 people', want: { amount: 'for_people' } },
		{ text: 'perunaa 120 henkilölle', want: { amount: 'for_people' } },
		{ text: 'bread rolls for a team of 30', want: { amount: 'for_people' } }
	],
	unknown: [
		{ text: 'some tomatoes for Friday', want: { amount: 'unknown' } },
		{ text: 'we need cucumbers', want: { amount: 'unknown' } },
		{ text: 'lisää sipulia', want: { amount: 'unknown' } },
		{ text: 'carrots please', want: { amount: 'unknown' } },
		{ text: 'juustoa perjantaiksi', want: { amount: 'unknown' } }
	],
	dish: [
		{ text: 'chicken curry for 300', want: { amount: 'for_people', what: 'dish' } },
		{ text: 'lasagne for 40 people on Saturday', want: { amount: 'for_people', what: 'dish' } },
		{ text: '60 annosta makaronilaatikkoa', want: { amount: 'for_people', what: 'dish' } },
		{ text: 'meatballs and mash for 75 kids', want: { amount: 'for_people', what: 'dish' } },
		{ text: 'kalakeittoa 90 hengelle', want: { amount: 'for_people', what: 'dish' } }
	],
	question: [
		{ text: 'do you stock lactose-free cream?', want: { intent: 'question' } },
		{ text: 'mitä maksaa kilo voita?', want: { intent: 'question' } },
		{ text: 'is there Finnish rye flour?', want: { intent: 'question' } },
		{ text: 'when does the salmon usually arrive?', want: { intent: 'question' } },
		{ text: 'onko teillä gluteenitonta pastaa?', want: { intent: 'question' } }
	],
	// The reported inputs of Rounds 9–11 and the user's (regressions, not held out).
	reported: [
		{ text: '250 ml milk Thursday', want: { amount: 'exact' } },
		{
			text: '10000 bolongese pasta; but with half only cow and other half half',
			want: { amount: 'for_people', what: 'dish' }
		},
		{ text: '10 l Arla whole milk', want: { amount: 'exact' } },
		{ text: 'i want all your apples', want: { amount: 'max_available' } },
		{ text: '4 packs lactose-free milk', want: { amount: 'exact' } }
	],
	change: [
		{ text: "change the cream on tomorrow's order to 6 litres", want: { intent: 'change' } },
		{ text: 'peru maitotilaus', want: { intent: 'change' } },
		{ text: 'make the potatoes 30 kg instead of 20', want: { intent: 'change' } },
		{ text: 'move my Thursday delivery to Friday', want: { intent: 'change' } },
		{ text: 'lisää huomiseen tilaukseen 2 kiloa voita', want: { intent: 'change' } }
	]
};

/** Whether a reading has the wanted kind. */
export function hits(r: ParsedRequest, want: Want): boolean {
	if ('intent' in want) return r.intent === want.intent;
	const i = r.items[0];
	if (!i || (r.intent && r.intent !== 'order')) return false;
	const kind = i.amount?.kind ?? (i.qty !== null ? 'exact' : 'unknown');
	return kind === want.amount && (!want.what || i.what === want.what);
}

describe.skipIf(!process.env.INTENT_LIVE)('D20 shape on held-out paraphrases, both models', () => {
	it('measures the first-pass and escalate models per kind', { timeout: 600_000 }, async () => {
		const env = process.env as unknown as Env;
		const router = createLlmRouter(env);
		const models = {
			first: router.for('request.parse'),
			escalate: router.for('request.parse.escalate')
		};
		const rows: Record<string, unknown>[] = [];
		const score: Record<string, Record<string, number>> = { first: {}, escalate: {} };
		const ms: Record<string, number[]> = { first: [], escalate: [] };
		for (const [kind, cases] of Object.entries(HELD_OUT))
			for (const c of cases)
				for (const [name, llm] of Object.entries(models)) {
					const r = await parseRequest(c.text, { today: '2026-12-07', llm, llmKind: 'gemini' });
					const ok = r.parser.kind !== 'rules' && hits(r, c.want);
					score[name][kind] = (score[name][kind] ?? 0) + (ok ? 1 : 0);
					ms[name].push(r.parser.latencyMs);
					rows.push({
						kind,
						text: c.text,
						model: name,
						modelId: r.parser.model,
						ok,
						intent: r.intent,
						amount: r.items[0]?.amount,
						what: r.items[0]?.what,
						fallback: r.parser.fallback,
						latencyMs: r.parser.latencyMs
					});
				}
		const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
		const summary = {
			score,
			total: Object.fromEntries(
				Object.entries(score).map(([k, v]) => [k, Object.values(v).reduce((s, x) => s + x, 0)])
			),
			medianMs: { first: median(ms.first), escalate: median(ms.escalate) },
			cases: Object.values(HELD_OUT).flat().length
		};
		expect(summary.cases).toBe(45);
		writeFileSync('scratch/intent-eval.json', JSON.stringify({ summary, rows }, null, 1));
		console.log(JSON.stringify(summary, null, 1));
	});
});
