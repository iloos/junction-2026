/** Visitor workspace ids: `ws-j-` + 16 base64url chars (96 random bits), so an id is unguessable. */
export const VISITOR_PREFIX = 'ws-j-';
const VISITOR_RE = /^ws-j-[A-Za-z0-9_-]{16}$/;

export const isVisitorWorkspace = (ws: string | null | undefined): ws is string =>
	!!ws && VISITOR_RE.test(ws);

export function newVisitorWorkspace(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return VISITOR_PREFIX + Buffer.from(bytes).toString('base64url');
}
