// The watch list: apps whose bad reviews and removals go to Slack. People edit it on the site
// (functions/api/watchers.js), which keeps it as watchers.json on the `watchers` branch of the private data
// repository — outside the database that every run rewrites, so an edit never waits for or races a run.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GlobalState, StoreApp, WatchedApp, WatchState } from './model.ts'
import { LOOKUP_BATCH, lookup } from './api.ts'
import { DATA } from './store.ts'
import { log } from './util.ts'

export const WATCH_BRANCH = 'watchers'
export const WATCH_FILE = 'watchers.json'

export function parseList(text: string): WatchedApp[] {
  const d = JSON.parse(text) as { apps?: unknown }
  return (Array.isArray(d.apps) ? d.apps : []).filter((a): a is WatchedApp =>
    !!a && typeof (a as WatchedApp).id === 'number' && typeof (a as WatchedApp).name === 'string')
}

/** The list as it is now: from the data repository in CI (DATA_REPO + DATA_REPO_TOKEN), else data/watchers.json. */
export async function loadWatchList(): Promise<WatchedApp[]> {
  const repo = process.env.DATA_REPO, token = process.env.DATA_REPO_TOKEN
  if (!repo || !token) {
    const file = process.env.WATCHERS_FILE ?? join(DATA, WATCH_FILE)
    return existsSync(file) ? parseList(readFileSync(file, 'utf8')) : []
  }
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${WATCH_FILE}?ref=${WATCH_BRANCH}`, {
    headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${token}`, 'User-Agent': 'app-radar', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(20_000),
  })
  // no branch or file yet: nobody has added an app
  if (r.status === 404) return []
  if (!r.ok) throw new Error(`GitHub answered ${r.status} for the watch list`)
  return parseList(await r.text())
}

export type WatchNoticeKind = 'removed' | 'pulled' | 'back'
/** countries: where it was removed from (pulled), was live (removed) or is back (back); live: where it still is (pulled) */
export interface WatchNotice { kind: WatchNoticeKind; app: WatchedApp; countries?: string[]; live?: string[]; since?: string; lastSeen?: string }

/** One check's lookups: storefront → the watched ids it lists. A storefront whose lookup failed is left out. */
export type Presence = Map<string, Set<number>>

/**
 * Updates each watched app's state from one check and returns what changed. Like the category checks, a
 * removal needs two misses in a row (checks hours apart), so one empty answer from Apple is not a ban.
 */
export function updateWatch(list: WatchedApp[], watch: Record<string, WatchState>, presence: Presence, now: string): WatchNotice[] {
  const out: WatchNotice[] = []
  for (const app of list) {
    const found = [...presence].filter(([, ids]) => ids.has(app.id)).map(([c]) => c)
    const st = watch[app.id]
    if (!st?.checkedAt) {
      // first check: only learn where the app is live
      watch[app.id] = { ...st, countries: found.sort(), checkedAt: now, ...(found.length ? { lastSeen: now } : {}) }
      continue
    }
    st.checkedAt = now
    const live = new Set(st.countries)
    // only storefronts that answered this time can tell the app is gone from them
    const checkedLive = [...live].filter(c => presence.has(c))
    if (found.length) {
      const back = st.removedAt ? found : found.filter(c => st.pulled?.[c])
      if (back.length) out.push({ kind: 'back', app, countries: back })
      delete st.removedAt
      delete st.missing
      delete st.missingSince
      st.lastSeen = now
      for (const c of found) {
        live.add(c)
        if (st.countryMiss) delete st.countryMiss[c]
        if (st.pulled) delete st.pulled[c]
      }
      const gone: string[] = []
      for (const c of checkedLive) {
        if (found.includes(c)) continue
        const m = ((st.countryMiss ??= {})[c] ??= { n: 0, since: now })
        m.n++
        if (m.n >= 2) {
          ;(st.pulled ??= {})[c] = m.since
          delete st.countryMiss[c]
          live.delete(c)
          gone.push(c)
        }
      }
      st.countries = [...live].sort()
      if (gone.length) out.push({ kind: 'pulled', app, countries: gone, live: st.countries })
    } else if (checkedLive.length && !st.removedAt) {
      st.missing = (st.missing ?? 0) + 1
      st.missingSince ??= now
      if (st.missing >= 2) {
        st.removedAt = now
        out.push({ kind: 'removed', app, countries: st.countries, since: st.missingSince, lastSeen: st.lastSeen })
      }
    }
  }
  return out
}

/** Looks the watched apps up in every storefront (one request per storefront) and updates their state. */
export async function checkWatched(list: WatchedApp[], g: GlobalState, countries: string[], now: Date): Promise<WatchNotice[]> {
  const watch = (g.watch ??= {})
  const ids = list.map(a => a.id)
  // apps taken off the list start over if they are added again
  for (const id of Object.keys(watch)) if (!ids.includes(Number(id))) delete watch[id]
  if (!list.length) return []
  const presence: Presence = new Map()
  const info = new Map<number, StoreApp>()
  for (const c of countries) {
    try {
      const found = new Set<number>()
      for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
        for (const a of await lookup(ids.slice(i, i + LOOKUP_BATCH), c)) {
          found.add(a.trackId)
          if (!info.has(a.trackId) || c === 'us') info.set(a.trackId, a)
        }
      }
      presence.set(c, found)
    } catch (e) {
      log(`watch lookup ${c}: ${(e as Error).message}`)
    }
  }
  const notices = updateWatch(list, watch, presence, now.toISOString())
  for (const [id, a] of info) {
    const st = watch[id]
    if (!st) continue
    st.name = a.trackName
    st.developer = a.artistName
    st.icon = a.artworkUrl100 ?? st.icon
  }
  log(`watchers: ${list.length} apps, ${presence.size} of ${countries.length} storefronts answered, ${notices.length} changes`)
  return notices
}
