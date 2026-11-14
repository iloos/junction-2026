// Prints the checked-out commit from .git without needing git installed (the image build has only Node).
// The Dockerfile stamps it into COMMIT for /healthz; prints "unknown" when there's no .git.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(p, 'utf8').trim();

function commit() {
	if (!existsSync('.git')) return 'unknown';
	// A worktree's .git is a file pointing at its git dir; refs live in the shared (common) dir.
	let gitDir = '.git';
	if (statSync('.git').isFile()) gitDir = read('.git').replace(/^gitdir: /, '');
	const common = existsSync(join(gitDir, 'commondir'))
		? join(gitDir, read(join(gitDir, 'commondir')))
		: gitDir;
	if (!existsSync(join(gitDir, 'HEAD'))) return 'unknown';
	const head = read(join(gitDir, 'HEAD'));
	if (/^[0-9a-f]{40}$/.test(head)) return head;
	const ref = head.replace(/^ref: /, '');
	for (const dir of [gitDir, common]) if (existsSync(join(dir, ref))) return read(join(dir, ref));
	const packed = join(common, 'packed-refs');
	if (existsSync(packed))
		for (const line of read(packed).split('\n')) {
			const [sha, name] = line.split(' ');
			if (name === ref) return sha;
		}
	return 'unknown';
}
console.log(commit());
