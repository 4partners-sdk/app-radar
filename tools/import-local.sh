#!/usr/bin/env bash
# Run on your Mac, once: replaces the database in the data repository with a plain local copy (a folder of
# state/*.json, e.g. an earlier import of the Mac app's history), encrypted with DATA_KEY.
# It asks for the key — the same value as this repository's DATA_KEY secret — and doesn't show what you paste,
# so the key never lands in a file, the screen or the shell history:
#
#   tools/import-local.sh <folder with global.json, cleaners.json, ...>
#
# It pushes over your own git access (SSH), not the workflow's token. Don't run it while the workflow runs.
set -euo pipefail
src=${1:?usage: tools/import-local.sh <folder with the plain state/*.json>}
repo=${DATA_REPO:-4partners-sdk/app_reviewer}
# DATA_REPO_URL: another remote for tests
url=${DATA_REPO_URL:-git@github.com:$repo.git}
tools=$(cd "$(dirname "$0")" && pwd)
[ -f "$src/global.json" ] || { echo "$src has no global.json — is it a state folder?" >&2; exit 1; }
# DATA_KEY in the environment: for tests
key=${DATA_KEY:-}
if [ -z "$key" ]; then
  read -rsp "Paste the DATA_KEY value (it won't show) and press Enter: " key
  echo
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/state"
DATA_KEY="$key" node "$tools/seal-dir.ts" "$src" "$tmp/state"

cd "$tmp"
git init -q
git checkout -q -b data
git add state
git -c user.name=app-radar -c user.email=app-radar@users.noreply.github.com commit -qm "data: imported from a local copy"
git push -qf "$url" data:data
echo "done: $repo, branch data — the next run reads it with DATA_KEY"
