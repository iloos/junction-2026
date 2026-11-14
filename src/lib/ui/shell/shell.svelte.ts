/**
 * The app shell's shared state, per request (context, never module state: SSR would leak it across visitors).
 * Pages publish what the shell shows: the sandbox they read and write, and where their data came from.
 */
import { getContext, setContext } from 'svelte';
import type { KitchenStore } from '$lib/kitchen/kitchen.svelte';

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
	/** The agent dock, on every page; `?chat=1` opens it. */
	chatOpen = $state(false);
	/** What the agent is scoped to on this page: the kitchen and the plan on screen (Kitchen, Request, Ops). */
	chat = $state<{ kitchenId?: string; planId?: string }>({});
	/** The Kitchen screen's own state while it is open: the dock defers to it for the plan on screen. */
	kitchen = $state.raw<KitchenStore | null>(null);
	/** A request to show a plan's decisions in place (the dock's decision card on the plan already on screen). */
	locate = $state<{
		planId: string;
		at: number;
		/** One decision to bring into view (Decision.key); the panel when absent. */
		decision?: string;
		/** Which part of the page: the decisions (default) or the order panel. */
		zone?: 'decide' | 'order';
	} | null>(null);
}

const KEY = Symbol('shell');

export function provideShell(): Shell {
	return setContext(KEY, new Shell());
}

export function useShell(): Shell | undefined {
	return getContext<Shell | undefined>(KEY);
}
