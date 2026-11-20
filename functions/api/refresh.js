// "Refresh now" on the site: starts the collector's daily check in GitHub Actions and reports how it is going.
// It sits behind the same login as the rest of the site (functions/_middleware.js runs first).
// Needs the GITHUB_TOKEN secret with "Actions: Read and write" on the code repository (see server/github.js).
//
// GET  → { configured, latest }  the newest run of the workflow: { status, conclusion, createdAt, updatedAt, url }
// POST → starts a daily check (202), unless a run is already queued or running (409); same body as GET

import { dispatch, failed, fromThisSite, isActive, json, latestRun } from '../../server/github.js'

const NEEDS = '"Actions: Read and write" on the repository'

export async function onRequestGet({ env }) {
  if (!env.GITHUB_TOKEN) return json({ configured: false }, 503)
  try {
    return json({ configured: true, latest: await latestRun(env) })
  } catch (e) {
    return failed(e, NEEDS)
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_TOKEN) return json({ configured: false }, 503)
  if (!fromThisSite(request)) return json({ error: 'cross-site request' }, 403)
  try {
    const latest = await latestRun(env)
    // one check at a time: a second press while one runs changes nothing
    if (isActive(latest)) return json({ configured: true, started: false, latest }, 409)
    await dispatch(env, 'daily')
    return json({ configured: true, started: true, latest }, 202)
  } catch (e) {
    return failed(e, NEEDS)
  }
}
