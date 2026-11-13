#!/usr/bin/env bash
# Create (or refresh) a lane worktree: branch lane/<name> from main, local data copied in, deps installed, dev port assigned.
# Same behaviour as lane-setup.ps1 (see there). Idempotent.
#   scripts/lane-setup.sh kitchen [--port 5173] [--base main] [--skip-install]
set -euo pipefail

name="${1:-}"; shift || true
[[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "usage: lane-setup.sh <name> [--port N] [--base main] [--skip-install]" >&2; exit 2; }
port=0; base=main; install=1
while [[ $# -gt 0 ]]; do
	case "$1" in
		--port) port="$2"; shift 2 ;;
		--base) base="$2"; shift 2 ;;
		--skip-install) install=0; shift ;;
		*) echo "unknown option $1" >&2; exit 2 ;;
	esac
done

main_root="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
lanes_root="$(dirname "$main_root")/junc26-lanes"
wt="$lanes_root/$name"
branch="lane/$name"

# 1. Worktree and branch (reuse when present).
git -C "$main_root" worktree prune
if git -C "$main_root" worktree list --porcelain | grep -qxF "worktree $wt"; then
	echo "worktree  exists: $wt"
else
	mkdir -p "$lanes_root"
	if git -C "$main_root" show-ref --verify --quiet "refs/heads/$branch"; then
		git -C "$main_root" worktree add "$wt" "$branch"
	else
		git -C "$main_root" worktree add -b "$branch" "$wt" "$base"
	fi
	echo "worktree  created: $wt ($branch from $base)"
fi

# 2. Local-only files (never committed). cp -u copies new and newer files only.
if [[ -f "$main_root/.env" ]]; then cp "$main_root/.env" "$wt/.env"; echo "copied    .env"
else echo "warning: no .env in the main checkout; fixture mode only" >&2; fi
for d in data/valio data/venues; do
	if [[ -d "$main_root/$d" ]]; then mkdir -p "$wt/$d"; cp -ru "$main_root/$d/." "$wt/$d/"; echo "copied    $d"; fi
done

# 3. Dependencies, installed inside the worktree (never symlink node_modules).
if [[ $install -eq 1 ]]; then (cd "$wt" && pnpm i); fi

# 4. Dev port: keep the recorded one; otherwise the first in 5171-5179 not taken by another lane or a listener.
port_file="$wt/scratch/lane-port"
mkdir -p "$wt/scratch"
if [[ "$port" == 0 && -f "$port_file" ]]; then port="$(cat "$port_file")"; fi
if [[ "$port" == 0 ]]; then
	taken=" "
	for f in "$lanes_root"/*/scratch/lane-port; do
		[[ -f "$f" && "$f" != "$port_file" ]] && taken+="$(cat "$f") "
	done
	for p in 5171 5172 5173 5174 5175 5176 5177 5178 5179; do
		[[ "$taken" == *" $p "* ]] && continue
		(exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && continue
		port="$p"; break
	done
	[[ "$port" != 0 ]] || { echo "no free port in 5171-5179; remove an idle lane or pass --port" >&2; exit 1; }
fi
printf '%s' "$port" > "$port_file"

echo
echo "lane      $name"
echo "branch    $branch"
echo "path      $wt"
echo "port      $port"
echo "run       cd \"$wt\" && pnpm dev --port $port --strictPort"
