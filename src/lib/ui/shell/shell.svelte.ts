/**
 * The app shell's shared state, per request (context, never module state: SSR would leak it across visitors).
 * Pages publish what the shell shows: the sandbox they read and write, and where their data came from.
 */
import { getContext, setContext, type Snippet } from 'svelte';
import type { KitchenStore } from '$lib/kitchen/kitchen.svelte';
import { PlanEvents } from './plan-events.svelte';

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
	/** The agent rail's width on desktop (px): dragged by its left edge, kept per browser. */
	railWidth = $state<number>(RAIL.default);
	/**
	 * What the page puts at the top of the agent rail while it is open: the Kitchen's Decide panel (the same
	 * cards and command), so decisions show once, in the rail, with the chat under them.
	 */
	railHeader = $state.raw<Snippet | null>(null);
	/** The chef is typing, or a turn is running: the rail's decisions fold to their summary line. */
	railFolded = $state(false);
	setRailWidth(w: number) {
		this.railWidth = Math.round(Math.min(RAIL.max, Math.max(RAIL.min, w)));
		try {
			localStorage.setItem(RAIL.key, String(this.railWidth));
		} catch {
			/* storage blocked: the width lasts for this page */
		}
	}
	/** The width this browser last chose, once in the browser. */
	loadRailWidth() {
		try {
			const w = Number(localStorage.getItem(RAIL.key));
			if (w) this.railWidth = Math.min(RAIL.max, Math.max(RAIL.min, w));
		} catch {
			/* storage blocked: the default width */
		}
	}
	/** One event stream for the page and the dock: what one does, the other shows (opened on first use). */
	events = new PlanEvents();
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
export const RAIL = { min: 320, max: 640, default: 384, key: 'mandate.rail.width' } as const;

export function provideShell(): Shell {
	return setContext(KEY, new Shell());
}

export function useShell(): Shell | undefined {
	return getContext<Shell | undefined>(KEY);
}
