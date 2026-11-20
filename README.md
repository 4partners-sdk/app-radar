# App Radar

The web version of AppResearch. Every day around 09:00 Warsaw time a collector checks the App Store by category (Cleaners, VPN, Security), and a login-protected site shows the analytics for the last 90 days. Slack gets:

- bans (apps removed from the App Store);
- bad reviews and removals of the apps on the watch list, which people edit on the site (Watchers tab);
- a message when the collector fails.

Everything runs on free tiers. This repository is public (unlimited Actions minutes) and holds only code; the database is in a private repository.

```
GitHub Actions in this repo (cron)                   private repo, `data` branch     Cloudflare Pages (login)
decide → 12 parallel fetch jobs → apply   ──token────►  state/*.json.enc   ──►   static site behind a password
          (each its own IP)     (diff, save)             (encrypted, 1 commit)
12:00 — removal recheck · weekly — subscription prices
──► Slack: bans, watched apps' removals and bad reviews, failures
```

## How it works

| What | Where |
|---|---|
| Collector (TypeScript, run by Node 24 directly — no build, no dependencies) | `collector/` |
| Category rules: search terms, regexes, genres | `config/categories.json` |
| Countries, review words, retention, run time | `config/settings.json` |
| Watch list | the site's Watchers tab — kept as `watchers.json` on the `watchers` branch of the data repository |
| Site (Vite + Preact) | `site/` |
| Site login (Pages Function, HTTP Basic Auth) | `functions/_middleware.js` |
| Schedule and deploy | `.github/workflows/collect.yml` |
| Database | the `data` branch of a private repository (`state/<category>.json.enc`, `state/global.json.enc`, AES-256-GCM with the `DATA_KEY` secret), read and written by `tools/data-repo.sh` |

**Schedule.** The workflow runs every hour at :05, and the collector decides what is due:
- **full check** — if there hasn't been one today and it is 09:00 or later in Warsaw;
- **removal recheck** — 3 hours after the last full check;
- **watched apps** — every 3 hours (`watchEveryHours`), and at the next run after an app is added: where it is live, removals, new reviews (~1 min);
- **nothing** — in every other hour; such a run takes seconds.

**Watchers.** The Watchers tab on the site holds the apps whose bad reviews and removals go to Slack — your own apps, or anyone's. Paste an App Store link or id and press Add; the first check starts right away when the collector is idle. Its first read of an app only learns where the app is live and remembers its current reviews, so adding an app doesn't flood Slack with old ones. Removals work like the categories' (two misses in a row, hours apart): gone from the App Store, gone from some storefronts while live in others, and back again. The list is edited through `functions/api/watchers.js` and kept in the private data repository — not in this public one, and not in the database every run rewrites, so an edit shows at once. Try it locally with `MOCK_REFRESH=1 npm run dev`.

**Refresh now.** The button in the site's header starts a full check right away (~7 min) through `functions/api/refresh.js`, behind the same login. Everyone with the site open sees it running, a second press while one runs does nothing, and open pages reload when the new data is published. The removal recheck follows 3 hours later as usual. Try the button locally with `MOCK_REFRESH=1 npm run dev`.

**Guide.** The site's Guide tab explains every tab, the Slack alerts and the terms for the team, in plain words (`site/src/views/Guide.tsx`) — update it along with the features.

**Test alerts.** Actions → `slack-test` → Run workflow sends one sample of each alert to Slack, marked TEST: a bad review, a removal wave, a watched app removed. Made-up apps, same formatting code as the real alerts (`collector/slacktest.ts`).

**What counts as a removal.** An app is removed when it is missing from all of its storefronts on two checks in a row, at least 3 hours apart. So a ban reaches Slack on the day it happens, around 12:00.

**Ratings growth** (Trending, "Updates that worked") only counts storefronts the app was already in. An app found in a new storefront doesn't look like a jump in ratings. Release impact uses the actual number of days between checks, since checks aren't always daily.

**Review alerts.** Apple's review feed publishes some reviews days after their date. Those are stored and shown on the site, but only reviews from the last 3 days go to Slack.

**Retention.** Everything older than `retentionDays` (90 days) is dropped: events, history, removed apps, reviews.

**Rate limits.** Apple documents the Search API as limited to [~20 calls per minute](https://performance-partners.apple.com/search-api), and from GitHub's shared runner IPs that is enforced: 429s at 2.25 s between requests, none at 3.4 s. So CI runs at one request per 3.4 s (`API_INTERVAL_MS`); after a 429 everything pauses for a minute and the pace drops further for the rest of the run.

**Parallel jobs.** Apple's limit is per IP (measured: three runners at 3.4 s each, ~53 calls a minute together, no throttling). So the daily check is split: `decide` fixes what is due and the moment of the run; `parallelJobs` (12) fetch jobs each send their share of the requests (job i takes requests i, i+12, …) and upload their results; `apply` joins them, turns them into events, saves, deploys and posts to Slack. If a fetch job fails, its apps count as "not checked", never as removed. The plan is deterministic, so every job and the merge see the same list (the merge checks this).

**Encryption.** The database and the fetch jobs' results (Actions artifacts, downloadable by anyone in a public repository) are encrypted with AES-256-GCM using the `DATA_KEY` secret (`openssl rand -base64 32`). In CI (`REQUIRE_ENCRYPTION`) nothing is ever written in the clear: without the key the run fails instead. Locally, without `DATA_KEY`, files stay plain JSON. Keep the key in a password manager: without it the database can't be read (the collector would have to start over).

**Full search every day.** A daily check is every term in every storefront (~860 searches) plus every known app (~260 lookups, 150 apps each): ~1,100 requests, ~63 min on one runner, ~6 min on 12. Public repositories get unlimited Actions minutes, so nothing has to be cut. In a private repository (2,000 free minutes a month) set `searchRotationDays` to 3: known apps are still looked up daily, and the search for new ones is spread over 3 days.

**Public repository, private data.** What anyone can see here: the code, `config/` (categories, search terms) and run logs, which only show counts — no app ids or names. The watch list is in the private data repository. The fetch jobs' artifacts are encrypted. The database and its history live in a private repository: the workflow reaches it with a fine-grained token that has access to that one repository only (`DATA_REPO_TOKEN` secret; deploy keys are turned off in our organization). The repository variable `DATA_REPO` names it (default: `<owner>/app_reviewer`). GitHub turns schedules off in a public repository after 60 days without a commit, so the workflow adds an empty commit when the last one is 45 days old.

## Commands

```bash
npm install                      # only needed for the site and the typecheck
node collector/main.ts daily     # whole daily check on this machine (~10 min from a Mac)
node collector/main.ts fetch 0 12 # one parallel job's share of the requests → out/shard-0.bin
node collector/main.ts merge out # the rest of the daily check from all shards' results
node collector/main.ts recheck   # recheck apps that went missing
node collector/main.ts prices force   # re-read subscription prices
node collector/main.ts reviews   # watched apps: removals and bad reviews
node collector/main.ts publish   # rebuild the site's data files from the current db
node collector/main.ts remeasure # measure every release again (after changing how impact is measured)
node collector/selftest.ts       # logic checks, no network
npm run dev                      # the site locally, on the data in ./data
npm run typecheck
npm test                         # collector logic + site login checks
```

- Without `SLACK_WEBHOOK_URL`, messages aren't sent but printed to the log (with `--verbose`).
- `DATA_DIR` points the collector at another database folder.

## Setup (once)

All secrets and variables below go to this repository: Settings → Secrets and variables → Actions.

0. **Encryption key.** `openssl rand -base64 32 | pbcopy` → secret `DATA_KEY` (and a copy in the password manager).
1. **Data repository.** A private repository for the database (the variable `DATA_REPO`, default `<owner>/app_reviewer`). The first run creates its `data` branch; ours started from an import of the Mac app's data. To put a plain local copy of the database there (a folder with `global.json`, `cleaners.json`, …), run `tools/import-local.sh <folder>` on your Mac and paste the `DATA_KEY` value when asked: it encrypts the files with that key and replaces the branch.
   - A fine-grained GitHub token: github.com/settings/personal-access-tokens/new → Resource owner: the organization → Only select repositories: the data repository → Repository permissions → **Contents: Read and write**.
   - Save it as the secret `DATA_REPO_TOKEN` in this repository.
   - When it expires, runs fail with "cannot reach … check the DATA_REPO_TOKEN secret" (and a Slack message): make a new one and replace the secret.
2. **Slack.** You need an incoming webhook: api.slack.com/apps → Create App → Incoming Webhooks → Add to channel. Save the URL as the secret `SLACK_WEBHOOK_URL`.
3. **Cloudflare Pages:**
   - The `app-radar` project is created on the first deploy from Actions.
   - Create an API token (My Profile → API Tokens) with the **Cloudflare Pages: Edit** permission and save it as the secret `CLOUDFLARE_API_TOKEN`.
   - Save the account ID as the secret `CLOUDFLARE_ACCOUNT_ID`.
4. **Login.** Every request to the site (pages, data files, preview deployments) goes through `functions/_middleware.js`, which asks for a login and password — the browser shows its standard sign-in box and remembers it. Credentials are a secret of the Pages project, not of the repo:
   - Workers & Pages → `app-radar` → Settings → Variables and Secrets → Add → type **Secret**, name `BASIC_AUTH`, value `login:password`. For several people: `anna:pass1, oleg:pass2` (no commas inside passwords). Add it for both Production and Preview.
   - Then redeploy: Actions → collect → Run workflow → mode `publish` (~2 min).
   - Without the secret the site answers 503 — closed, not open.
5. **Refresh button and watch list** — two fine-grained tokens (github.com/settings/personal-access-tokens/new → Resource owner: the organization), saved in the Pages project next to `BASIC_AUTH` as secrets, for Production and Preview:
   - `GITHUB_TOKEN`: only this repository → **Actions: Read and write**. The Refresh button, and starting a newly added app's first check.
   - `DATA_REPO_TOKEN`: only the data repository → **Contents: Read and write**. The watch list.
   - Keep them apart: a token that could write to this repository could change the code the workflow runs with every secret.
   - If the repositories aren't `4partners-sdk/app-radar` and `4partners-sdk/app_reviewer`, add text variables `GITHUB_REPO` and `DATA_REPO` = `owner/name`.
   - Without them the button is hidden and the watch list is read-only; when one expires, the site says which — make a new one.
6. **`SITE_URL` variable.** The site address (`https://<project>.pages.dev`), so Slack messages link to the dashboard.
7. **First run.** Actions → collect → Run workflow → mode `daily`. This also shows whether Apple answers requests from GitHub's servers.

## Changing things

- **Categories and search terms:** edit `config/categories.json`. The Cyrillic and CJK parts of the patterns match apps with Russian, Japanese and Korean names — keep them. After a big rule change, delete `state/<id>.json.enc` in the data repository's `data` branch: the next check builds a fresh baseline instead of a flood of false "new" apps.
- **Watch list:** the Watchers tab on the site.
- **Countries, time, retention:** edit `config/settings.json`.
