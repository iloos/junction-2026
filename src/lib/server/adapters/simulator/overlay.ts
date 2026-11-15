/**
 * Scenario overlays on top of cached Valio terms (D5: the simulator owns time and scarcity).
 * Every overridden value carries `source: 'simulator'` and the scenario's label, so the UI can say "simulated".
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Offer } from '$lib/core/contracts';

export interface AvailabilityOverride {
	productId: string;
	/** Sales units available; 0 = out. */
	amount: number;
	label: string;
	/** Who set it ('contention', 'shortage'), so a scenario clears only its own and the screen reads its state here. */
	tag?: string;
}
/** One overlay change, as it travels between processes: the workspace it is for (null = the base layer) and what. */
export type OverlayOp = { ws: string | null } & (
	| { op: 'availability'; o: AvailabilityOverride }
	| { op: 'price'; o: PriceOverride }
	| { op: 'noPrice'; productId: string; label: string }
	| { op: 'clearTagged'; tag: string }
	| { op: 'clear' }
);

export interface PriceOverride {
	productId: string;
	unitCents: number;
	label: string;
}

/**
 * Overlays are per workspace (each visitor sandbox simulates its own scarcity), selected by the async scope the
 * caller runs in: `inWorkspace(ws, fn)` is entered by serveTool and the kitchen screen's per-workspace queue.
 * Code outside any scope (evals, tests, scripts) reads and writes one shared base layer, as before.
 */
const scope = new AsyncLocalStorage<string>();

/** The workspace the current call runs for (set by `inWorkspace`), or undefined outside a scope. */
export const scopedWorkspace = (): string | undefined => scope.getStore();

/** Run `fn` with overlay reads and writes scoped to `workspaceId`. */
export function inWorkspace<T>(workspaceId: string, fn: () => T): T {
	return scope.run(workspaceId, fn);
}

class Layer {
	availability = new Map<string, AvailabilityOverride>();
	price = new Map<string, PriceOverride>();
	noPrice = new Map<string, string>();
	get empty() {
		return !this.availability.size && !this.price.size && !this.noPrice.size;
	}
}

export class SimOverlay {
	private base = new Layer();
	private scoped = new Map<string, Layer>();

	/** The layer writes go to: the current workspace's, or the base outside a scope. */
	private target(): Layer {
		const ws = scope.getStore();
		if (!ws) return this.base;
		let l = this.scoped.get(ws);
		if (!l) this.scoped.set(ws, (l = new Layer()));
		return l;
	}

	/** Changes, for other processes on the same database (bus/overlay-sync.ts); remote changes are not re-sent. */
	private listeners: ((op: OverlayOp) => void)[] = [];
	onChange(fn: (op: OverlayOp) => void): () => void {
		this.listeners.push(fn);
		return () => (this.listeners = this.listeners.filter((f) => f !== fn));
	}
	private emit(op: OverlayOp) {
		for (const f of this.listeners) f(op);
	}
	/** Apply a change another process made, to the workspace it names, without sending it on. */
	applyRemote(op: OverlayOp) {
		const run = () => this.change(op);
		if (op.ws) inWorkspace(op.ws, run);
		else run();
	}
	private change(op: OverlayOp) {
		switch (op.op) {
			case 'availability':
				this.target().availability.set(op.o.productId, op.o);
				return;
			case 'price':
				this.target().price.set(op.o.productId, op.o);
				return;
			case 'noPrice':
				this.target().noPrice.set(op.productId, op.label);
				return;
			case 'clearTagged': {
				const ws = scope.getStore();
				const l = ws ? this.scoped.get(ws) : this.base;
				if (l)
					for (const [id, o] of l.availability) if (o.tag === op.tag) l.availability.delete(id);
				return;
			}
			case 'clear': {
				const ws = scope.getStore();
				if (ws) this.scoped.delete(ws);
				else this.base = new Layer();
				return;
			}
		}
	}
	private local(op: OverlayOp) {
		this.change(op);
		this.emit(op);
	}
	private ws = () => scope.getStore() ?? null;

	setAvailability(o: AvailabilityOverride) {
		this.local({ ws: this.ws(), op: 'availability', o });
	}
	setPrice(o: PriceOverride) {
		this.local({ ws: this.ws(), op: 'price', o });
	}
	/** Valio returns no price for this product (a fact gap the gate must not paper over). */
	setPriceMissing(productId: string, label: string) {
		this.local({ ws: this.ws(), op: 'noPrice', productId, label });
	}
	/** The current workspace's availability override for a product, if any (read, not applied). */
	availabilityOf(productId: string): AvailabilityOverride | undefined {
		const ws = scope.getStore();
		return (ws ? this.scoped.get(ws) : this.base)?.availability.get(productId);
	}
	/** Remove the current workspace's availability overrides that carry `tag`; others stay. */
	clearTagged(tag: string) {
		this.local({ ws: this.ws(), op: 'clearTagged', tag });
	}
	/** Clear the current workspace's overrides (or, outside a scope, the base layer). */
	clear() {
		this.local({ ws: this.ws(), op: 'clear' });
	}

	apply(offer: Offer): Offer {
		const ws = scope.getStore();
		const layer = ws ? this.scoped.get(ws) : undefined;
		const out = applyLayer(this.base, offer);
		return layer && !layer.empty ? applyLayer(layer, out) : out;
	}
}

function applyLayer(l: Layer, offer: Offer): Offer {
	let out = offer;
	const a = l.availability.get(offer.productId);
	if (a)
		out = {
			...out,
			availability: {
				...out.availability,
				kind: a.amount > 0 ? 'known' : 'out',
				amount: a.amount,
				// The overlay only models Stock: a simulated amount is a known quantity.
				logisticModel: out.availability.logisticModel ?? 'Stock',
				provenance: { source: 'simulator', note: a.label, ref: 'overlay' }
			}
		};
	const p = l.price.get(offer.productId);
	if (p && out.price)
		out = {
			...out,
			price: {
				...out.price,
				unitCents: p.unitCents,
				provenance: { source: 'simulator', note: p.label, ref: 'overlay' }
			}
		};
	if (l.noPrice.has(offer.productId)) out = { ...out, price: null };
	return out;
}
