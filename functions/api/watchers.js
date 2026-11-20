// The watch list on the site: apps whose bad reviews and removals go to Slack. It sits behind the site login.
// Kept as watchers.json on the `watchers` branch of the private data repository — not in the public code, and not
// in the database every run rewrites — so an edit shows at once and never waits for or races a run.
// Needs the DATA_REPO_TOKEN secret: "Contents: Read and write" on the data repository only (see server/github.js).
// GITHUB_TOKEN, if set, only starts an app's first check right away.
//
// GET  → { configured, apps }
// POST { op: 'add', app: '<App Store link or id>', countries?: ['us', …] } → { configured, apps, started }
// POST { op: 'remove', id } → { configured, apps }

import { GitHubError, dataRepo, dispatch, failed, fromBase64, fromThisSite, gh, isActive, json, latestRun, login, toBase64 } from '../../server/github.js'

const BRANCH = 'watchers'
const FILE = 'watchers.json'
const NEEDS = '"Contents: Read and write" on the data repository'
/** every app costs one review-feed request per storefront on each check */
export const MAX_APPS = 25

const fail = e => failed(e, NEEDS, 'DATA_REPO_TOKEN')
/** the data repository's contents, with its own token */
const data = (env, path, init) => gh(env, path, init, env.DATA_REPO_TOKEN)

export async function onRequestGet({ env }) {
  if (!env.DATA_REPO_TOKEN) return json({ configured: false }, 503)
  try {
    return json({ configured: true, apps: (await read(env)).apps })
  } catch (e) {
    return fail(e)
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DATA_REPO_TOKEN) return json({ configured: false }, 503)
  if (!fromThisSite(request)) return json({ error: 'cross-site request' }, 403)
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'expected JSON' }, 400)
  }
  try {
    if (body?.op === 'add') {
      const id = appId(body.app)
      if (!id) return json({ configured: true, error: 'Paste an App Store link (…/id1234567890) or an app id' }, 400)
      const countries = storefronts(body.countries)
      const found = await findApp(id, countries)
      if (!found) return json({ configured: true, error: `No app with id ${id} in the App Store (${countries.map(c => c.toUpperCase()).join(' ')})` }, 404)
      const entry = { id, name: found.trackName, developer: found.artistName, icon: found.artworkUrl100, addedAt: new Date().toISOString(), addedBy: login(request) }
      let full = false
      const apps = await change(env, list => {
        if (list.some(a => a.id === id)) return null
        if (list.length >= MAX_APPS) { full = true; return null }
        return [...list, entry]
      }, () => `Watch ${found.trackName}`)
      if (full) return json({ configured: true, apps, error: `The list holds up to ${MAX_APPS} apps — remove one first` }, 409)
      // its first check right away when the collector is idle; otherwise the next hourly run does it
      const started = await startCheck(env)
      return json({ configured: true, apps, started })
    }
    if (body?.op === 'remove') {
      const id = Number(body.id)
      if (!Number.isSafeInteger(id) || id <= 0) return json({ configured: true, error: 'bad app id' }, 400)
      const apps = await change(env, list => (list.some(a => a.id === id) ? list.filter(a => a.id !== id) : null),
        list => `Stop watching ${list.find(a => a.id === id)?.name ?? id}`)
      return json({ configured: true, apps })
    }
    return json({ error: 'unknown op' }, 400)
  } catch (e) {
    return fail(e)
  }
}

/** "https://apps.apple.com/us/app/name/id1234567890?l=ru", "id1234567890" or "1234567890" → 1234567890 */
export function appId(input) {
  const s = String(input ?? '').trim()
  const m = /\bid=?(\d{6,12})\b/.exec(s) ?? /^(\d{6,12})$/.exec(s)
  return m ? Number(m[1]) : undefined
}

/** the storefronts the site watches, US first: an app is looked for there until one lists it */
function storefronts(list) {
  const cs = [...new Set((Array.isArray(list) ? list : []).map(c => String(c).toLowerCase()).filter(c => /^[a-z]{2}$/.test(c)))].slice(0, 30)
  if (!cs.length) return ['us']
  return cs.includes('us') ? ['us', ...cs.filter(c => c !== 'us')] : cs
}

async function findApp(id, countries) {
  for (const c of countries) {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${c}&entity=software`)
    if (!r.ok) throw new Error(`The App Store answered ${r.status}, try again in a minute`)
    const app = (await r.json()).results?.find(x => x.trackId === id && x.trackName)
    if (app) return app
  }
  return undefined
}

async function startCheck(env) {
  if (!env.GITHUB_TOKEN) return false
  try {
    if (isActive(await latestRun(env))) return false
    await dispatch(env, 'reviews')
    return true
  } catch {
    // the list is saved either way; the next hourly run checks the new app
    return false
  }
}

class Conflict extends Error {}

const contents = env => `/repos/${dataRepo(env)}/contents/${FILE}`

/** the list and the file's version (sha); no file or branch yet = an empty list */
async function read(env) {
  const r = await data(env, `${contents(env)}?ref=${BRANCH}`)
  if (r.ok) {
    const file = await r.json()
    const apps = JSON.parse(fromBase64(file.content)).apps
    return { apps: Array.isArray(apps) ? apps : [], sha: file.sha }
  }
  if (r.status !== 404) throw new GitHubError(r.status)
  // a token without access to the repository gets 404 too: tell the two apart
  const repo = await data(env, `/repos/${dataRepo(env)}`)
  if (!repo.ok) throw new GitHubError(repo.status)
  return { apps: [], sha: undefined }
}

/** Reads the list, applies `edit` (null = nothing to change) and writes it back unless someone wrote in between. */
async function change(env, edit, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { apps, sha } = await read(env)
    const next = edit(apps)
    if (!next) return apps
    try {
      await write(env, next, sha, message(apps))
      return next
    } catch (e) {
      if (!(e instanceof Conflict)) throw e
    }
  }
  throw new Error('the watch list kept changing while saving — try again')
}

async function write(env, apps, sha, message) {
  const text = JSON.stringify({ apps }, null, 2) + '\n'
  const r = await data(env, contents(env), {
    method: 'PUT',
    body: JSON.stringify({ message, content: toBase64(text), branch: BRANCH, ...(sha ? { sha } : {}) }),
  })
  if (r.ok) return
  if (sha && (r.status === 409 || r.status === 422)) throw new Conflict()
  // the very first save: the branch doesn't exist yet
  if (!sha && (r.status === 404 || r.status === 422)) return createBranch(env, text, message)
  throw new GitHubError(r.status)
}

/** A `watchers` branch whose only commit holds the file (nothing else of the repository). */
async function createBranch(env, text, message) {
  const repo = `/repos/${dataRepo(env)}/git`
  const post = async (path, body) => {
    const r = await data(env, `${repo}/${path}`, { method: 'POST', body: JSON.stringify(body) })
    if (r.status === 422 && path === 'refs') throw new Conflict() // created by someone else just now
    if (!r.ok) throw new GitHubError(r.status)
    return r.json()
  }
  const tree = await post('trees', { tree: [{ path: FILE, mode: '100644', type: 'blob', content: text }] })
  const commit = await post('commits', { message, tree: tree.sha, parents: [] })
  await post('refs', { ref: `refs/heads/${BRANCH}`, sha: commit.sha })
}
