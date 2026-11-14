/**
 * Small JSON files for outside-call state (response cache entries, the spend ledger). Read whole, written
 * whole. A missing or corrupt file reads as the fallback; a failed write is logged and the process keeps
 * its memory copy.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { errMsg, log } from '$lib/server/obs/log';

export function readJson<T>(file: string | undefined, fallback: T): T {
	if (!file || !existsSync(file)) return fallback;
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as T;
	} catch {
		return fallback;
	}
}

export function writeJson(file: string | undefined, value: unknown): void {
	if (!file) return;
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(value));
	} catch (e) {
		log.error('external.write_failed', { file, error: errMsg(e) });
	}
}
