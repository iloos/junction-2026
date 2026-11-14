import { createHash } from 'node:crypto';

/**
 * A visitor's owner id (D24): a hash of its own sandbox id, so the sandbox id itself never lands in a kitchen doc.
 * Every door that acts for a browser or for a key minted for one sets `CallContext.visitor` to this.
 */
export const visitorKey = (own: string) =>
	createHash('sha256').update(`visitor:${own}`).digest('hex').slice(0, 24);
