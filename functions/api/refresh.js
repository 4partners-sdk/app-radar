// "Refresh now" on the site: starts the collector's daily check in GitHub Actions and reports how it is going.
// It sits behind the same login as the rest of the site (functions/_middleware.js runs first).
//
// Pages project → Settings → Variables and Secrets:
//   GITHUB_TOKEN (secret) — fine-grained token for this repository only, permission "Actions: Read and write"
//   GITHUB_REPO  (text, optional) — owner/name of the code repository, default 4partners-sdk/app-radar
//
// GET  → { configured, latest }  the newest run of the workflow: { status, conclusion, createdAt, updatedAt, url }
// POST → starts a daily check (202), unless a run is already queued or running (409); same body as GET

const WORKFLOW = 'collect.yml'
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested'])

export async function onRequestGet({ env }) {
  if (!env.GITHUB_TOKEN) return json({ configured: false }, 503)
  try {
    return json({ configured: true, latest: await latestRun(env) })
  } catch (e) {
    return failed(e)
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_TOKEN) return json({ configured: false }, 503)
  if (!fromThisSite(request)) return json({ error: 'cross-site request' }, 403)
  try {
    const latest = await latestRun(env)
    // one check at a time: a second press while one runs changes nothing
    if (latest && ACTIVE.has(latest.status)) return json({ configured: true, started: false, latest }, 409)
    const r = await github(env, '/dispatches', {
      method: 'POST',
      body: JSON.stringify({ ref: env.GITHUB_REF || 'main', inputs: { mode: 'daily' } }),
    })
    if (r.status !== 204) throw new GitHubError(r.status)
    return json({ configured: true, started: true, latest }, 202)
  } catch (e) {
    return failed(e)
  }
}

class GitHubError extends Error {
  constructor(status) {
    super(`GitHub answered ${status}`)
    this.status = status
  }
}

function github(env, path, init = {}) {
  const repo = env.GITHUB_REPO || '4partners-sdk/app-radar'
  return fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'app-radar',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
}

async function latestRun(env) {
  const r = await github(env, '/runs?per_page=1')
  if (!r.ok) throw new GitHubError(r.status)
  const run = (await r.json()).workflow_runs?.[0]
  if (!run) return null
  return { status: run.status, conclusion: run.conclusion, createdAt: run.created_at, updatedAt: run.updated_at, url: run.html_url }
}

/** The browser sends the saved login with requests from any site, so a POST must prove it came from this page:
 *  a custom header (other sites can't add one without a CORS preflight, which this endpoint never allows)
 *  and, where the browser says, the same origin. */
function fromThisSite(request) {
  if (request.headers.get('X-App-Radar') !== '1') return false
  const site = request.headers.get('Sec-Fetch-Site')
  if (site && site !== 'same-origin') return false
  const origin = request.headers.get('Origin')
  try {
    return !origin || new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

function failed(e) {
  const status = e instanceof GitHubError ? e.status : 0
  const hint = status === 401 ? ' — the GITHUB_TOKEN secret is wrong or expired'
    : status === 403 || status === 404 ? ' — the token needs "Actions: Read and write" on the repository'
    : ''
  return json({ configured: true, error: (e?.message ?? String(e)) + hint }, 502)
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
