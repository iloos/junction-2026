/**
 * Product photos for rows, batched: every thumb that mounts in the same tick asks once (/kitchen-api/thumbs), and
 * each product is read once per page. Offline there is no server: every thumb shows its placeholder.
 */
/** S4's ProductPhoto, the fields a thumb draws. */
export interface Thumb {
	/** 'gtin' is this exact product; 'family' the same product in another pack; 'brand' its logo; 'category' an icon. */
	match: 'gtin' | 'family' | 'brand' | 'category' | string;
	/** Absent for a category icon. */
	imageUrl?: string;
	icon?: string;
	/** Said on the image when not the product's own photo. */
	label?: 'Pack may differ' | 'Brand image' | 'No photo' | null;
	host?: string;
}

const known = new Map<string, Promise<Thumb | null>>();
let queue: { id: string; resolve: (t: Thumb | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
	const batch = queue;
	queue = [];
	timer = null;
	try {
		const r = await fetch(`/kitchen-api/thumbs?ids=${batch.map((b) => b.id).join(',')}`);
		const body = r.ok ? ((await r.json()) as Record<string, Thumb | null>) : {};
		for (const b of batch) b.resolve(body[b.id] ?? null);
	} catch {
		for (const b of batch) b.resolve(null);
	}
}

export function thumbFor(productId: string): Promise<Thumb | null> {
	let p = known.get(productId);
	if (!p) {
		p = new Promise((resolve) => queue.push({ id: productId, resolve }));
		known.set(productId, p);
		timer ??= setTimeout(flush, 30);
	}
	return p;
}

/** Read the photos for a plan's products in one batch as soon as its snapshot arrives: every row then reads the cache. */
export function prefetchThumbs(productIds: Iterable<string>): void {
	for (const id of new Set(productIds)) void thumbFor(id);
}

/** A photo already read (or null when known to have none); undefined while unknown. Lets a row paint it at once. */
export function knownThumb(productId: string): Promise<Thumb | null> | undefined {
	return known.get(productId);
}
