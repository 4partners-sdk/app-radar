// `node tests/watchers.test.mjs` — checks of the watch list endpoint (functions/api/watchers.js) against fake GitHub
// and App Store APIs.
import { appId, nameFromLink, onRequestGet, onRequestPost, storefrontOf } from '../functions/api/watchers.js'
let failed = 0
const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}`) }

const SITE = 'https://app-radar.example'
const env = { GITHUB_TOKEN: 'actions-token', DATA_REPO_TOKEN: 'data-token' }
const b64 = s => Buffer.from(s, 'utf8').toString('base64')
const CONTENTS = 'https://api.github.com/repos/4partners-sdk/app_reviewer/contents/watchers.json'

/** fake APIs: `file` is the stored list (undefined = no branch yet); records every call */
function fake({ file, store = { 42424242: 'Cleaner Ü' }, putStatus = [], repoStatus = 200, contentsStatus, run = 'completed', apple = 200 } = {}) {
  const state = { file, sha: file ? 'v1' : undefined, branch: !!file }
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    url = String(url)
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url, method: init.method ?? 'GET', body, headers: init.headers })
    const res = (status, data) => new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('https://itunes.apple.com/lookup')) {
      if (apple !== 200) return res(apple, {})
      const id = Number(new URL(url).searchParams.get('id'))
      return res(200, { results: store[id] ? [{ trackId: id, trackName: store[id], artistName: 'Dev', artworkUrl100: 'https://icon' }] : [] })
    }
    if (url === `${CONTENTS}?ref=watchers`) {
      if (contentsStatus) return res(contentsStatus, {})
      return state.file ? res(200, { sha: state.sha, content: b64(JSON.stringify({ apps: state.file })) }) : res(404, {})
    }
    if (url === CONTENTS && init.method === 'PUT') {
      const forced = putStatus.shift()
      if (forced) return res(forced, {})
      if (!state.branch) return res(404, { message: 'Branch watchers not found' })
      if (body.sha !== state.sha) return res(409, {})
      state.file = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')).apps
      state.sha = 'v' + (Number(state.sha?.slice(1) ?? 0) + 1)
      return res(200, {})
    }
    if (url === 'https://api.github.com/repos/4partners-sdk/app_reviewer') return res(repoStatus, {})
    if (url.endsWith('/git/trees')) return res(201, { sha: 'tree1', _content: body.tree[0].content })
    if (url.endsWith('/git/commits')) return res(201, { sha: 'commit1' })
    if (url.endsWith('/git/refs')) {
      const tree = calls.find(c => c.url.endsWith('/git/trees')).body.tree[0]
      state.branch = true; state.file = JSON.parse(tree.content).apps; state.sha = 'v1'
      return res(201, {})
    }
    if (url.includes('/actions/workflows/collect.yml/runs')) return res(200, { workflow_runs: [{ status: run, conclusion: null, created_at: '', updated_at: '', html_url: '' }] })
    if (url.endsWith('/dispatches')) return res(204)
    return res(500, { unexpected: url })
  }
  return { calls, state }
}

const post = (body, headers = {}) => new Request(`${SITE}/api/watchers`, {
  method: 'POST',
  headers: { 'X-App-Radar': '1', 'Sec-Fetch-Site': 'same-origin', Origin: SITE, Authorization: 'Basic ' + b64('anna:secret'), ...headers },
  body: JSON.stringify(body),
})
const call = async (p, b) => { const r = await p; return { status: r.status, body: await r.json() } }

// ids from links
check('id from a store link', appId('https://apps.apple.com/us/app/some-cleaner/id1234567890?l=ru') === 1234567890)
check('id from "id…" and digits', appId('id9876543210') === 9876543210 && appId(' 9876543210 ') === 9876543210)
check('no id in junk', appId('cleanup') === undefined && appId('https://example.com/12') === undefined)
check('storefront from a link', storefrontOf('https://apps.apple.com/pl/app/x/id1234567') === 'pl' && storefrontOf('1234567') === undefined)
check('placeholder name from the link', nameFromLink('https://apps.apple.com/pl/app/flixclean-app/id1234567', 1234567) === 'Flixclean App'
  && nameFromLink('1234567', 1234567) === 'App 1234567')

let r = await call(onRequestGet({ env: { GITHUB_TOKEN: 'actions-token' } }))
check('no DATA_REPO_TOKEN → 503, read-only on the site', r.status === 503 && r.body.configured === false)

let f = fake({ file: [{ id: 1, name: 'A' }] })
r = await call(onRequestGet({ env }))
check('GET reads the list from the watchers branch with the token', r.status === 200 && r.body.apps[0].name === 'A'
  && f.calls[0].url === `${CONTENTS}?ref=watchers` && f.calls[0].headers.Authorization === 'Bearer data-token')

f = fake()
r = await call(onRequestGet({ env }))
check('no branch yet → empty list', r.status === 200 && r.body.apps.length === 0)

fake({ repoStatus: 404 })
r = await call(onRequestGet({ env }))
check('no access to the data repository → 502 that says which permission', r.status === 502 && r.body.error.includes('Contents: Read and write'))

f = fake()
r = await call(onRequestPost({ request: post({ op: 'add', app: 'https://apps.apple.com/us/app/x/id42424242', countries: ['gb', 'us'] }), env }))
check('first add creates the branch with only the file', r.status === 200 && f.state.branch && f.calls.some(c => c.url.endsWith('/git/refs'))
  && f.calls.find(c => c.url.endsWith('/git/commits')).body.parents.length === 0)
check('…stores name, developer, icon, who and when', f.state.file.length === 1 && f.state.file[0].name === 'Cleaner Ü'
  && f.state.file[0].developer === 'Dev' && f.state.file[0].addedBy === 'anna' && !!f.state.file[0].addedAt)
check('…looks the app up in the US first', f.calls.find(c => c.url.startsWith('https://itunes')).url.includes('country=us'))
check('…and starts its first check (mode reviews) when idle', r.body.started === true
  && f.calls.find(c => c.url.endsWith('/dispatches')).body.inputs.mode === 'reviews')
const isData = c => c.url.includes('/repos/4partners-sdk/app_reviewer')
check('data repository calls use only DATA_REPO_TOKEN, workflow calls only GITHUB_TOKEN',
  f.calls.filter(isData).every(c => c.headers.Authorization === 'Bearer data-token')
  && f.calls.filter(c => c.url.includes('/actions/')).every(c => c.headers.Authorization === 'Bearer actions-token'))

f = fake({ file: [] })
r = await call(onRequestPost({ request: post({ op: 'add', app: '42424242' }), env: { DATA_REPO_TOKEN: 'data-token' } }))
check('without GITHUB_TOKEN the app is still added, its check waits for the next run', r.status === 200 && f.state.file.length === 1
  && r.body.started === false && !f.calls.some(c => c.url.includes('/actions/')))

f = fake({ file: [{ id: 42424242, name: 'Cleaner Ü' }] })
r = await call(onRequestPost({ request: post({ op: 'add', app: '42424242' }), env }))
check('adding an app already on the list changes nothing', r.status === 200 && !f.calls.some(c => c.method === 'PUT') && r.body.apps.length === 1)

f = fake({ file: [{ id: 1, name: 'A' }], run: 'in_progress' })
r = await call(onRequestPost({ request: post({ op: 'add', app: '42424242' }), env }))
check('add while a run is going: saved, no second run', r.status === 200 && f.state.file.length === 2 && r.body.started === false
  && !f.calls.some(c => c.url.endsWith('/dispatches')))

f = fake({ file: [] })
r = await call(onRequestPost({ request: post({ op: 'add', app: '99999999' }), env }))
check('unknown app → 404 with a message, nothing saved', r.status === 404 && r.body.error.includes('No app with id 99999999') && !f.calls.some(c => c.method === 'PUT'))

f = fake({ file: [] })
r = await call(onRequestPost({ request: post({ op: 'add', app: 'https://apps.apple.com/pl/app/x/id42424242' }), env }))
const looked = f.calls.filter(c => c.url.startsWith('https://itunes')).map(c => new URL(c.url).searchParams.get('country'))
check("looks in the link's storefront first, at most two lookups", looked[0] === 'pl' && looked.length === 1)

f = fake({ file: [], apple: 403 })
r = await call(onRequestPost({ request: post({ op: 'add', app: 'https://apps.apple.com/pl/app/flixclean-app/id42424242' }), env }))
check('Apple refuses (403): added anyway with the name from the link, marked unverified', r.status === 200 && r.body.unverified === true
  && f.state.file[0].name === 'Flixclean App' && f.state.file[0].id === 42424242
  && f.calls.filter(c => c.url.startsWith('https://itunes')).length === 2)
r = await call(onRequestPost({ request: post({ op: 'add', app: 'cleaner' }), env }))
check('not a link or id → 400', r.status === 400 && r.body.error.includes('App Store link'))

f = fake({ file: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] })
r = await call(onRequestPost({ request: post({ op: 'remove', id: 1 }), env }))
check('remove takes the app off the list', r.status === 200 && f.state.file.length === 1 && f.state.file[0].id === 2
  && f.calls.find(c => c.method === 'PUT').body.message === 'Stop watching A')

f = fake({ file: [{ id: 1, name: 'A' }], putStatus: [409] })
r = await call(onRequestPost({ request: post({ op: 'add', app: '42424242' }), env }))
check('someone saved in between → read again and retry', r.status === 200 && f.calls.filter(c => c.method === 'PUT').length === 2 && f.state.file.length === 2)

f = fake({ file: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `A${i}` })) })
r = await call(onRequestPost({ request: post({ op: 'add', app: '42424242' }), env }))
check('a full list → 409 that says so', r.status === 409 && r.body.error.includes('up to 25'))

f = fake({ file: [] })
r = await call(onRequestPost({ request: post({ op: 'add', app: '42424242' }, { 'X-App-Radar': '' }), env }))
check('no custom header → 403', r.status === 403 && f.calls.length === 0)
r = await call(onRequestPost({ request: post({ op: 'add', app: '42424242' }, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }), env }))
check('from another site → 403', r.status === 403 && f.calls.length === 0)

fake({ file: [], contentsStatus: 401 })
r = await call(onRequestGet({ env }))
check('expired token → 502 that names DATA_REPO_TOKEN', r.status === 502 && r.body.error.includes('DATA_REPO_TOKEN secret is wrong or expired'))

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
