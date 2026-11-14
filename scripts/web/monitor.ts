/**
 * Context.dev monitor admin for the recall watch. Run with tsx so the server modules resolve:
 *   pnpm tsx --env-file=.env scripts/web/monitor.ts create <appBaseUrl> [everyMinutes]
 *   pnpm tsx --env-file=.env scripts/web/monitor.ts list
 *   pnpm tsx --env-file=.env scripts/web/monitor.ts ping <appBaseUrl>   (signed test change, needs CONTEXT_DEV_WEBHOOK_SECRET)
 * `create` writes the monitor id and its webhook signing secret to scratch/web/monitor.json (gitignored)
 * and prints only the id; set the secret as CONTEXT_DEV_WEBHOOK_SECRET where the app runs.
 */
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createContextDev } from '../../src/lib/server/web/contextdev';
import { createWebHttp } from '../../src/lib/server/web/http';
import { RECALL_LIST_URL } from '../../src/lib/server/web/recall';

const [cmd, base, every] = process.argv.slice(2);
const key = process.env.CONTEXT_DEV_API_KEY;
if (!key) throw new Error('CONTEXT_DEV_API_KEY is not set');
const cd = createContextDev(createWebHttp({ api: 'context.dev', apiKey: key }));

if (cmd === 'create') {
	if (!base) throw new Error('give the app base URL, e.g. https://<app>.aiven.app');
	const m = await cd.createMonitor({
		name: 'Mandate: Ruokavirasto food recalls',
		url: RECALL_LIST_URL,
		instructions:
			'A new food recall notice (takaisinveto) is added to the list. Ignore layout, navigation and date-format changes.',
		everyMinutes: Number(every ?? 60),
		webhookUrl: `${base.replace(/\/$/, '')}/api/web/contextdev`
	});
	mkdirSync('scratch/web', { recursive: true });
	writeFileSync(
		'scratch/web/monitor.json',
		JSON.stringify(
			{ id: m.id, webhookSecret: m.webhookSecret, createdAt: new Date().toISOString(), base },
			null,
			1
		)
	);
	console.log(
		`monitor ${m.id} created; webhook secret ${m.webhookSecret ? 'saved to scratch/web/monitor.json' : 'not returned'}`
	);
} else if (cmd === 'list') {
	const r = (await cd.listMonitors()) as { data?: unknown[]; monitors?: unknown[] };
	const rows = (r.data ?? r.monitors ?? []) as {
		id: string;
		name: string;
		status?: string;
		last_run_at?: string;
		next_run_at?: string;
	}[];
	for (const x of rows)
		console.log(
			x.id,
			x.status ?? '',
			x.name,
			'last',
			x.last_run_at ?? '-',
			'next',
			x.next_run_at ?? '-'
		);
	if (!rows.length) console.log(JSON.stringify(r).slice(0, 500));
} else if (cmd === 'ping') {
	const secret = process.env.CONTEXT_DEV_WEBHOOK_SECRET;
	if (!base || !secret) throw new Error('give the app base URL and set CONTEXT_DEV_WEBHOOK_SECRET');
	const now = new Date().toISOString();
	const body = JSON.stringify({
		event: 'change.detected',
		id: `evt_ping_${Date.now()}`,
		created_at: now,
		data: {
			change: {
				mode: 'web',
				id: `chg_ping_${Date.now()}`,
				monitor_id: 'ping',
				run_id: 'ping',
				target_type: 'page',
				change_detection_type: 'semantic',
				title: 'Recall list changed (ping)',
				summary: 'Signed test delivery from scripts/web/monitor.ts',
				detected_at: now,
				url: RECALL_LIST_URL,
				tags: []
			}
		}
	});
	const t = Math.floor(Date.now() / 1000);
	const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
	const res = await fetch(`${base.replace(/\/$/, '')}/api/web/contextdev`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-context-signature': `t=${t},v1=${sig}` },
		body
	});
	console.log(res.status, await res.text());
} else {
	console.log('usage: monitor.ts create <appBaseUrl> [everyMinutes] | list | ping <appBaseUrl>');
}
