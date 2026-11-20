#!/usr/bin/env bash
# The database lives in a separate private repository (DATA_REPO, branch `data`), so this repository can be public:
# the data and its history stay private. The way in is a deploy key of that repository with write access
# (DATA_REPO_KEY secret); it is written to a temporary file for the git commands below and deleted right after.
#
#   tools/data-repo.sh restore — clones the branch into ./data (an empty repository on the very first run)
#   tools/data-repo.sh save    — commits ./data/state as the branch's only commit and force-pushes it
set -euo pipefail
cmd=${1:?usage: tools/data-repo.sh restore|save}

if [ "$cmd" = save ] && [ ! -d data/state ]; then echo "nothing to save"; exit 0; fi

: "${DATA_REPO:?DATA_REPO is not set (owner/name of the private data repository)}"
: "${DATA_REPO_KEY:?the DATA_REPO_KEY secret is not set (a deploy key of the data repository with write access)}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(umask 077; printf '%s\n' "$DATA_REPO_KEY" > "$tmp/key")
# GitHub's SSH host keys come from its API over HTTPS instead of trusting whatever answers first
curl -fsS --retry 3 https://api.github.com/meta | jq -r '.ssh_keys[] | "github.com " + .' > "$tmp/known_hosts"
export GIT_SSH_COMMAND="ssh -i $tmp/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$tmp/known_hosts"
# DATA_REPO_URL: another remote for tests
url=${DATA_REPO_URL:-git@github.com:${DATA_REPO}.git}

case $cmd in
  restore)
    set +e
    git ls-remote --exit-code --heads "$url" data >/dev/null
    rc=$?
    set -e
    case $rc in
      0) git clone -q --depth=1 --branch data --single-branch "$url" data ;;
      # the repository answers but has no `data` branch: the very first run starts an empty database
      2) git init -q data && git -C data remote add origin "$url" && echo "no data branch yet — starting empty" ;;
      # anything else (wrong key, no access, network) must stop the run: an empty start would overwrite the database
      *) echo "cannot reach $DATA_REPO (git exit $rc) — check the DATA_REPO_KEY secret and the deploy key" >&2; exit 1 ;;
    esac ;;
  save)
    cd data
    git config user.name "app-radar"
    git config user.email "app-radar@users.noreply.github.com"
    git checkout -q --orphan "snap-${GITHUB_RUN_ID:-local}"
    git rm -rq --cached . 2>/dev/null || true
    git add state
    git commit -qm "data $(date -u +%FT%TZ)"
    git push -qf origin HEAD:data ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
