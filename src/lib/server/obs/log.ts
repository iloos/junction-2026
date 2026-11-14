/**
 * Structured logs: one JSON line per event on stdout, `{at, level, requestId, workspaceId, runId, event, …}`, with
 * the request and workspace read from the async context (obs/context.ts, external/scope.ts). Fields pass through
 * `redact`, so no secret, prompt or request body reaches the line. A dev server (and the tests) print a short
 * readable line instead; LOG_FORMAT=json|pretty and LOG_LEVEL=debug|info|warn|error override.
 */
import { currentScope } from '../external/scope';
import { currentRequest } from './context';
import { redact } from './redact';

export type Level = 'debug' | 'info' | 'warn' | 'error';
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry {
	at: string;
	level: Level;
	event: string;
	requestId?: string;
	workspaceId?: string;
	runId?: string;
	route?: string;
	[k: string]: unknown;
}

type Sink = (e: LogEntry) => void;

const isTest = () => !!process.env.VITEST;
const isDev = () => process.env.NODE_ENV === 'development' || isTest();

function minLevel(): Level {
	const l = process.env.LOG_LEVEL as Level | undefined;
	if (l && l in RANK) return l;
	return isTest() ? 'warn' : 'info';
}

function pretty(): boolean {
	const f = process.env.LOG_FORMAT;
	if (f === 'json') return false;
	if (f === 'pretty') return true;
	return isDev();
}

const fmtValue = (v: unknown) =>
	typeof v === 'string' ? (/\s/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v);

/** `12:01:02 warn  tool.call tool=quote_lines ok=false · req-1a2b ws-demo` */
export function prettyLine(e: LogEntry): string {
	const { at, level, event, requestId, workspaceId, runId, ...all } = e;
	// The route is on the request.in/out lines already; elsewhere it is noise in a dev console.
	const rest = event.startsWith('request.')
		? all
		: Object.fromEntries(Object.entries(all).filter(([k]) => k !== 'route'));
	const kv = Object.entries(rest)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `${k}=${fmtValue(v)}`)
		.join(' ');
	const where = [requestId, workspaceId, runId].filter(Boolean).join(' ');
	return `${new Date(at).toTimeString().slice(0, 8)} ${level.padEnd(5)} ${event}${kv ? ` ${kv}` : ''}${where ? ` · ${where}` : ''}`;
}

const defaultSink: Sink = (e) => {
	if (pretty()) {
		const line = prettyLine(e);
		if (e.level === 'error') console.error(line);
		else if (e.level === 'warn') console.warn(line);
		else console.log(line);
	} else process.stdout.write(`${jsonLine(e)}\n`);
};

/** Envelope keys every shipped line carries first, in this order, so a log index maps them once. */
const ENVELOPE = ['at', 'level', 'event', 'requestId', 'workspaceId', 'runId', 'route'] as const;
const KEEP_ON_CUT = [...ENVELOPE, 'status', 'ms', 'source', 'model', 'tool', 'ok', 'code', 'error'];
export const MAX_LINE = 8_192;

/**
 * One line for the log shipper (stdout → OpenSearch): a single JSON object, nested objects flattened to dotted keys
 * (`actor.kind`), arrays and deeper objects as short JSON strings, and the whole line under MAX_LINE. JSON escapes
 * newlines, so a message with line breaks still makes one line.
 */
export function jsonLine(e: LogEntry): string {
	const flat: Record<string, unknown> = {};
	for (const k of ENVELOPE) if (e[k] !== undefined) flat[k] = e[k];
	const put = (key: string, v: unknown, depth: number) => {
		if (v === undefined) return;
		if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) {
			for (const [k, x] of Object.entries(v)) put(`${key}.${k}`, x, depth + 1);
			return;
		}
		if (v && typeof v === 'object') {
			const text = JSON.stringify(v);
			flat[key] = text.length <= 512 ? text : `${text.slice(0, 512)}…`;
			return;
		}
		flat[key] = v;
	};
	for (const [k, v] of Object.entries(e))
		if (!(ENVELOPE as readonly string[]).includes(k)) put(k, v, 0);
	const line = JSON.stringify(flat);
	if (line.length <= MAX_LINE) return line;
	const kept: Record<string, unknown> = { truncated: true };
	for (const k of KEEP_ON_CUT)
		if (flat[k] !== undefined)
			kept[k] = typeof flat[k] === 'string' ? (flat[k] as string).slice(0, 1000) : flat[k];
	return JSON.stringify(kept);
}

let sink: Sink = defaultSink;

/** Test hook: capture entries instead of printing them; no argument restores stdout. */
export function setLogSink(s?: Sink): void {
	sink = s ?? defaultSink;
}

/** The entry `log` would write, with context and redaction applied (exported for tests). */
export function entry(level: Level, event: string, fields: Record<string, unknown> = {}): LogEntry {
	const req = currentRequest();
	const scope = currentScope();
	const clean = redact(fields) as Record<string, unknown>;
	// The envelope keys are ours; a field of the same name never overwrites them.
	for (const k of ['at', 'level', 'event', 'requestId']) delete clean[k];
	return {
		at: new Date().toISOString(),
		level,
		requestId: req?.requestId,
		...clean,
		workspaceId: (clean.workspaceId as string) ?? scope?.workspaceId ?? req?.workspaceId,
		runId: (clean.runId as string) ?? scope?.runId ?? req?.runId,
		route: (clean.route as string) ?? req?.route,
		event
	};
}

function write(level: Level, event: string, fields?: Record<string, unknown>) {
	if (RANK[level] < RANK[minLevel()] && sink === defaultSink) return;
	try {
		sink(entry(level, event, fields));
	} catch {
		// A log line never fails the work it describes.
	}
}

/** `err` for a caught error: its message (scrubbed), never its stack in JSON lines. */
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const log = {
	debug: (event: string, fields?: Record<string, unknown>) => write('debug', event, fields),
	info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
	warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
	error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields)
};
