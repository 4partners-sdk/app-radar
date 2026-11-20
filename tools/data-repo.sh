#!/usr/bin/env bash
# The database lives in a separate private repository (DATA_REPO, branch `data`), so this repository can be public:
# the data and its history stay private. The way in is a fine-grained token with "Contents: Read and write" on that
# one repository (DATA_REPO_TOKEN secret). git gets it as an HTTP header through the environment, so it is never in
# a URL, a log line or data/.git/config.
#
#   tools/data-repo.sh restore — clones the branch into ./data (an empty repository on the very first run)
#   tools/data-repo.sh save    — commits ./data/state as the branch's only commit and force-pushes it
set -euo pipefail
cmd=${1:?usage: tools/data-repo.sh restore|save}

if [ "$cmd" = save ] && [ ! -d data/state ]; then echo "nothing to save"; exit 0; fi

: "${DATA_REPO:?DATA_REPO is not set (owner/name of the private data repository)}"
: "${DATA_REPO_TOKEN:?the DATA_REPO_TOKEN secret is not set (a fine-grained token with Contents: Read and write on the data repository)}"
auth=$(printf 'x-access-token:%s' "$DATA_REPO_TOKEN" | base64 | tr -d '\n')
# Actions hides the secret itself in logs, not its base64 form
[ "${GITHUB_ACTIONS:-}" = true ] && echo "::add-mask::$auth"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0="Authorization: Basic $auth"
export GIT_TERMINAL_PROMPT=0
# DATA_REPO_URL: another remote for tests
url=${DATA_REPO_URL:-https://github.com/${DATA_REPO}.git}

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
      # anything else (wrong or expired token, no access, network) must stop the run: an empty start would overwrite the database
      *) echo "cannot reach $DATA_REPO (git exit $rc) — check the DATA_REPO_TOKEN secret: wrong, expired, or without Contents: Read and write on that repository" >&2; exit 1 ;;
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
