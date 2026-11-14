/**
 * The app shell's shared state, per request (context, never module state: SSR would leak it across visitors).
 * Pages publish what the shell shows: the sandbox they read and write, and where their data came from.
 */
import { getContext, setContext } from 'svelte';

export interface SandboxInfo {
	/** Visitor workspace id (D9), e.g. ws-j-…; `ws-demo` is the shared presenter sandbox. */
	workspace: string;
	/** Scenario run id: changes when the sandbox is started over. */
	run: string;
	/** Simulated scenario clock, already formatted. */
	clock: string;
	busy: boolean;
	onReset: () => void;
}

export interface DataLabels {
	/** Provenance of the Valio offers on screen; null before the first quote. */
	source: { live: boolean; at: string } | null;
	/** The browser stand-in (/offline), not the server's plan. */
	offline: boolean;
}

export class Shell {
	sandbox = $state<SandboxInfo | null>(null);
	labels = $state<DataLabels | null>(null);
	/** System layer: formulas, gates, hashes and op ids. `?system=1` turns it on. */
	system = $state(false);
}

const KEY = Symbol('shell');

export function provideShell(): Shell {
	return setContext(KEY, new Shell());
}

export function useShell(): Shell | undefined {
	return getContext<Shell | undefined>(KEY);
}
