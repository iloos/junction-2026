/**
 * A per-process promise built once, whoever asks first, that is forgotten when it rejects: one transient init
 * failure (a database blip at boot) fails that caller, and the next caller builds again instead of inheriting the
 * rejection until a restart.
 */
export function retryingOnce<T>(
	slot: { current?: Promise<T> },
	make: () => Promise<T>
): Promise<T> {
	if (!slot.current) {
		const p = make();
		slot.current = p;
		p.catch(() => {
			if (slot.current === p) slot.current = undefined;
		});
	}
	return slot.current;
}
