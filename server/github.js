// Shared by the site's Pages Functions (functions/api/*): GitHub API calls with the GITHUB_TOKEN secret, the
// same-site check for requests that change something, and JSON answers. Lives outside functions/ so it isn't a route.
//
// Pages project → Settings → Variables and Secrets — two tokens, so neither can do the other's job:
//   GITHUB_TOKEN    (secret) — fine-grained, "Actions: Read and write" on the code repository only (Refresh button)
//   DATA_REPO_TOKEN (secret) — fine-grained, "Contents: Read and write" on the data repository only (watch list).
//                              Never give the site write access to the code repository: the workflow runs that code
//                              with every secret.
//   GITHUB_REPO, DATA_REPO (text, optional) — owner/name, default 4partners-sdk/app-radar and 4partners-sdk/app_reviewer

export const WORKFLOW = 'collect.yml'
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested'])

export const codeRepo = env => env.GITHUB_REPO || '4partners-sdk/app-radar'
export const dataRepo = env => env.DATA_REPO || '4partners-sdk/app_reviewer'

export class GitHubError extends Error {
  constructor(status, what = 'GitHub') {
    super(`${what} answered ${status}`)
    this.status = status
  }
}

/** A GitHub API request: `path` starts with /repos/…; GITHUB_TOKEN unless another token is given */
export function gh(env, path, init = {}, token = env.GITHUB_TOKEN) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'app-radar',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
}

const workflow = (env, path, init) => gh(env, `/repos/${codeRepo(env)}/actions/workflows/${WORKFLOW}${path}`, init)

/** The newest run of the collector: { status, conclusion, createdAt, updatedAt, url } or null. */
export async function latestRun(env) {
  const r = await workflow(env, '/runs?per_page=1')
  if (!r.ok) throw new GitHubError(r.status)
  const run = (await r.json()).workflow_runs?.[0]
  if (!run) return null
  return { status: run.status, conclusion: run.conclusion, createdAt: run.created_at, updatedAt: run.updated_at, url: run.html_url }
}

export const isActive = run => !!run && ACTIVE.has(run.status)

/** Starts the collector in `mode` (workflow_dispatch). */
export async function dispatch(env, mode) {
  const r = await workflow(env, '/dispatches', {
    method: 'POST',
    body: JSON.stringify({ ref: env.GITHUB_REF || 'main', inputs: { mode } }),
  })
  if (r.status !== 204) throw new GitHubError(r.status)
}

/** The browser sends the saved login with requests from any site, so a request that changes something must prove
 *  it came from this page: a custom header (other sites can't add one without a CORS preflight, which these
 *  endpoints never allow) and, where the browser says, the same origin. */
export function fromThisSite(request) {
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

/** The site login of whoever sent the request (the middleware has already checked the password). */
export function login(request) {
  const [scheme, encoded] = String(request.headers.get('Authorization') ?? '').split(' ')
  if (scheme !== 'Basic' || !encoded) return undefined
  try {
    const pair = new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)))
    return pair.slice(0, pair.indexOf(':')) || undefined
  } catch {
    return undefined
  }
}

/** A 502 that says what to fix: `secret` is the token this endpoint uses, `needs` the permission it relies on. */
export function failed(e, needs, secret = 'GITHUB_TOKEN') {
  const status = e instanceof GitHubError ? e.status : 0
  const hint = status === 401 ? ` — the ${secret} secret is wrong or expired`
    : status === 403 || status === 404 ? ` — the token needs ${needs}`
    : ''
  return json({ configured: true, error: (e?.message ?? String(e)) + hint }, 502)
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

// base64 of UTF-8 text (app names aren't ASCII-only), for the contents API
export function toBase64(text) {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function fromBase64(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, '')), c => c.charCodeAt(0)))
}
