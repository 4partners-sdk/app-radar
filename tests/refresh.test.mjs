// `node tests/refresh.test.mjs` — checks of the "Refresh now" endpoint (functions/api/refresh.js) against a fake GitHub API.
import { onRequestGet, onRequestPost } from '../functions/api/refresh.js'
let failed = 0
const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}`) }

const URL_ = 'https://app-radar.example/api/refresh'
const env = { GITHUB_TOKEN: 'test-token' }
const run = (status, conclusion = null) => ({ status, conclusion, created_at: '2026-11-20T09:05:00Z', updated_at: '2026-11-20T09:12:00Z', html_url: 'https://github.com/x/y/actions/runs/1' })

/** fake GitHub: answers the runs list with `runs`, records every call */
function github({ runs = [], listStatus = 200, dispatchStatus = 204 } = {}) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers: init.headers })
    if (String(url).endsWith('/dispatches')) return new Response(null, { status: dispatchStatus })
    return new Response(JSON.stringify({ workflow_runs: runs }), { status: listStatus, headers: { 'Content-Type': 'application/json' } })
  }
  return calls
}
const post = (headers = { 'X-App-Radar': '1', 'Sec-Fetch-Site': 'same-origin', Origin: 'https://app-radar.example' }) =>
  new Request(URL_, { method: 'POST', headers })
const body = r => r.json()

github()
let r = await onRequestGet({ env: {} })
check('no token → 503, button hidden', r.status === 503 && (await body(r)).configured === false)

let calls = github({ runs: [run('in_progress')] })
r = await onRequestGet({ env })
let b = await body(r)
check('status → latest run', r.status === 200 && b.latest.status === 'in_progress' && b.latest.createdAt === '2026-11-20T09:05:00Z')
check('asks the right workflow with the token', calls[0].url === 'https://api.github.com/repos/4partners-sdk/app-radar/actions/workflows/collect.yml/runs?per_page=1'
  && calls[0].headers.Authorization === 'Bearer test-token' && calls[0].headers['User-Agent'])

calls = github({ runs: [run('completed', 'success')] })
r = await onRequestPost({ request: post(), env })
b = await body(r)
const dispatch = calls.find(c => c.url.endsWith('/dispatches'))
check('press when idle → daily check started', r.status === 202 && b.started === true && dispatch?.method === 'POST')
check('dispatch: main, mode daily', JSON.parse(dispatch?.body ?? '{}').ref === 'main' && JSON.parse(dispatch.body).inputs.mode === 'daily')

calls = github({ runs: [run('queued')] })
r = await onRequestPost({ request: post(), env })
check('press while one is queued → 409, nothing started', r.status === 409 && !calls.some(c => c.url.endsWith('/dispatches')))

calls = github({ runs: [run('completed', 'success')] })
r = await onRequestPost({ request: post({}), env })
check('no custom header → 403', r.status === 403 && calls.length === 0)
r = await onRequestPost({ request: post({ 'X-App-Radar': '1', 'Sec-Fetch-Site': 'cross-site' }), env })
check('cross-site → 403', r.status === 403)
r = await onRequestPost({ request: post({ 'X-App-Radar': '1', Origin: 'https://evil.example' }), env })
check('other origin → 403', r.status === 403 && calls.length === 0)

github({ listStatus: 401 })
r = await onRequestGet({ env })
b = await body(r)
check('expired token → 502 that says so', r.status === 502 && b.error.includes('expired'))

github({ runs: [], dispatchStatus: 403 })
r = await onRequestPost({ request: post(), env })
b = await body(r)
check('token without Actions write → 502 that says so', r.status === 502 && b.error.includes('Actions: Read and write'))

calls = github({ runs: [] })
r = await onRequestPost({ request: post(), env: { ...env, GITHUB_REPO: 'acme/radar' } })
check('first run ever (no runs yet) → started', r.status === 202)
check('GITHUB_REPO overrides the repository', calls.length === 2 && calls.every(c => c.url.includes('/repos/acme/radar/')))

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
