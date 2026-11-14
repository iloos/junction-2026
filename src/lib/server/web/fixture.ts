/**
 * Fixture adapters: real Context.dev and Exa responses recorded from the live APIs (fixtures/*.json), served
 * through the same interfaces as the live adapters. Offline demo and tests run on these.
 */
import { RecallListItem, RecallNotice, noticeKey } from './recall';
import type { RecallSource } from './contextdev';
import { shapeStructured, type FactSearch, type Structured, type StructuredQuery } from './exa';
import listFx from './fixtures/recall-list.json';
import noticesFx from './fixtures/recall-notices.json';
import exaFx from './fixtures/exa.json';

const notices = new Map(
	noticesFx.notices.map((n) => {
		const parsed = RecallNotice.parse(n);
		return [noticeKey(parsed.url), parsed];
	})
);

/** The recorded notices, for replay and tests. */
export function recordedNotice(urlOrKey: string): RecallNotice | undefined {
	const key = urlOrKey.startsWith('http') ? noticeKey(urlOrKey) : urlOrKey;
	return notices.get(key);
}

/** The real 9 Oct 2026 egg recall (salmonella, Munax Oy, packing station 1FI15493). */
export const EGG_RECALL_URL =
	'https://www.ruokavirasto.fi/elintarvikkeet/ohjeita-kuluttajille/takaisinvedot-2023-/kananmunien-takaisinveto2/';

export function createFixtureRecallSource(): RecallSource {
	return {
		mode: 'fixture',
		async readList() {
			return listFx.recalls.map((r) => RecallListItem.parse(r));
		},
		async readNotice(url) {
			const n = recordedNotice(url);
			if (!n)
				throw new Error(`no recorded notice for ${url} (fixture mode reads recorded pages only)`);
			return n;
		}
	};
}

type Answers = Record<string, Omit<Structured<unknown>, 'cached' | 'latencyMs'>>;
const answers = exaFx.answers as unknown as Answers;

export function createFixtureFactSearch(): FactSearch {
	return {
		mode: 'fixture',
		async search(query) {
			const a = Object.values(answers).find((x) =>
				x.results.some((r) => r.title.toLowerCase().includes(query.toLowerCase()))
			);
			return (a?.results ?? []).map((r) => ({
				url: r.url,
				title: r.title,
				text: r.highlights?.join('\n…\n')
			}));
		},
		async structured<T>(q: StructuredQuery<T>): Promise<Structured<T>> {
			const a = answers[q.key];
			if (!a)
				return {
					content: null,
					grounding: [],
					results: [],
					at: new Date().toISOString(),
					cached: true,
					latencyMs: 0
				};
			// Recorded answers go through the same runtime schema as live ones.
			const shaped = shapeStructured(
				{ output: { content: a.content, grounding: a.grounding }, results: a.results },
				q.parse
			);
			return { ...shaped, at: a.at, costUsd: a.costUsd, cached: true, latencyMs: 0 };
		}
	};
}
