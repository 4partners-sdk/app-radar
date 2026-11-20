// The daily check's diff (results → events), the removal recheck, and the context tags for removals.
import type { App, Category, CategoryState, Run, StoreApp, WatchEvent } from './model.ts'
import type { Hit, Job, Listing } from './plan.ts'
import { LOOKUP_BATCH, lookup } from './api.ts'
import {
  FRESH_DAYS, applyMeta, eventOf, measureVersions, metaOf, miss, missIn, newApp, recordRatings, seenAgain, total,
} from './app.ts'
import { DAY, chunks, log, pool } from './util.ts'

/** English storefronts first, so release notes read the same for every app */
export const listingRank = (c: string) => { const i = ['us', 'gb', 'ca', 'au'].indexOf(c); return i < 0 ? 9 : i }

/**
 * Which searches run today. Every known app is looked up daily anyway (bans, updates, ratings), so search is only
 * for finding apps we don't track yet — that part is spread over `rotation` days: pair i runs when i % rotation equals
 * the day. Every storefront gets some of its terms every day, and every term × storefront at least once per cycle.
 * The first check of a category searches everything to build its baseline.
 */
export function todaysSearches<T>(all: T[], rotation: number, today: number, baseline: boolean): T[] {
  if (baseline || rotation <= 1) return all
  return all.filter((_, i) => i % rotation === today % rotation)
}

export function countRun(run: Run, events: WatchEvent[]) {
  for (const e of events) run.counts[e.kind] = (run.counts[e.kind] ?? 0) + 1
}

/**
 * The diff half of the daily check: turns the plan's results (from one machine or several) into state changes
 * and events. A request that has no result — failed, or its parallel job died — counts as "not checked":
 * its apps are left alone rather than counted as missing, so a lost job can't produce false removals.
 */
export function applyCategory(
  c: Category, cs: CategoryState, jobs: Job[], hits: Map<number, Hit>, listings: Map<number, Listing>,
  countries: string[], now: Date, day: (d: Date) => number, duration: number,
): { run: Run; events: WatchEvent[] } {
  const nowISO = now.toISOString()
  const today = day(now)
  const baseline = Object.keys(cs.apps).length === 0
  const watched = new Set(countries)
  const run: Run = { date: nowISO, mode: 'daily', duration, active: 0, counts: {}, baseline: baseline || undefined }

  const foundIn = new Map<number, Set<string>>()
  const seenRatings = new Map<number, Record<string, [number, number]>>()
  const failedCountries = new Set<string>()
  const unverified = new Set<number>()
  let searches = 0, searchesOk = 0, lookups = 0, lookupsOk = 0
  let firstError: string | undefined
  jobs.forEach((job, i) => {
    if (job.kind === 'page' || job.cat !== c.id) return
    if (job.kind === 'search') searches++
    else lookups++
    const hit = hits.get(i)
    if (!hit?.ok) {
      firstError ??= hit?.err ?? 'no result — a parallel job failed'
      if (job.kind === 'search') failedCountries.add(job.country)
      else job.ids.forEach(id => unverified.add(id))
      return
    }
    if (job.kind === 'search') searchesOk++
    else lookupsOk++
    for (const [id, count, avg] of hit.apps ?? []) {
      let f = foundIn.get(id)
      if (!f) foundIn.set(id, (f = new Set()))
      f.add(job.country)
      let r = seenRatings.get(id)
      if (!r) seenRatings.set(id, (r = {}))
      r[job.country] = [count, avg]
    }
  })
  if (searches > 0 && searchesOk === 0) {
    run.failed = true
    run.error = firstError ?? 'No response from the App Store'
    run.active = Object.values(cs.apps).filter(a => !a.removedAt).length
    cs.runs.push(run)
    return { run, events: [] }
  }
  const found = new Map<number, StoreApp>()
  for (const id of foundIn.keys()) {
    const l = listings.get(id)
    if (l) found.set(id, l.app)
  }
  const known = Object.values(cs.apps).filter(a => a.countries.some(x => watched.has(x)))
  log(`${c.name}: ${searchesOk}/${searches} searches, ${lookupsOk}/${lookups} lookups, ${found.size} apps found`)

  const events: WatchEvent[] = []
  for (const [id, a] of found) {
    const here = [...(foundIn.get(id) ?? [])]
    let t: App | undefined = cs.apps[id]
    if (t) {
      if (t.removedAt) {
        delete t.removedAt
        delete t.removalTags
        events.push(eventOf('returned', t, nowISO, here))
      }
      t.name = a.trackName; t.developer = a.artistName; t.developerId ??= a.artistId
      t.countries = [...new Set([...t.countries, ...here])].sort()
      t.lastSeen = nowISO
      seenAgain(t)
      recordRatings(t, seenRatings.get(id) ?? {}, watched, today)
      const v = applyMeta(t, metaOf(a), nowISO)
      if (v) events.push(eventOf('updated', t, nowISO, [], `v${v.version}` + (v.notes ? ' — ' + v.notes : '')))
    } else {
      // lookups only ask for tracked ids, so a new app always comes from (filtered) search
      t = newApp(a, here, nowISO)
      recordRatings(t, seenRatings.get(id) ?? {}, watched, today)
      applyMeta(t, metaOf(a), nowISO)
      cs.apps[id] = t
      if (!baseline) {
        const fresh = a.releaseDate ? now.getTime() - Date.parse(a.releaseDate) < FRESH_DAYS * DAY : false
        events.push(eventOf(fresh ? 'released' : 'discovered', t, nowISO, here))
      }
    }
  }
  for (const t of known) {
    if (t.removedAt || found.has(t.id) || unverified.has(t.id)) continue
    if (miss(t, now)) events.push(eventOf('removed', t, nowISO, t.countries.filter(x => watched.has(x))))
  }
  // live somewhere, but gone from some of its storefronts — two misses, hours apart
  for (const [id, here] of foundIn) {
    const t = cs.apps[id]
    if (!t || t.removedAt || unverified.has(id)) continue
    const gone = t.countries.filter(x => watched.has(x) && !here.has(x) && !failedCountries.has(x))
    const pulled = missIn(t, gone, [...here], watched, now)
    if (pulled.length) events.push(eventOf('pulled', t, nowISO, pulled))
  }
  tagRemovals(events, cs, now)

  // releases whose 7-day after-window just closed: did the rating pace jump?
  for (const t of Object.values(cs.apps)) {
    if (t.removedAt) continue
    for (const b of measureVersions(t, now, day)) events.push(eventOf('boosted', t, nowISO, [], b.note))
  }

  countRun(run, events)
  if (failedCountries.size || unverified.size) {
    run.error = `Some requests failed: ${[...failedCountries].sort().join(', ') || `${unverified.size} apps not checked`}`
  }
  run.active = Object.values(cs.apps).filter(a => !a.removedAt).length
  cs.events.push(...events)
  cs.runs.push(run)
  return { run, events }
}

/** Lookups for apps that missed the last check only: confirms (or clears) removals a few hours later. */
export async function recheckCategory(c: Category, cs: CategoryState, countries: string[], now: Date): Promise<{ run: Run; events: WatchEvent[] }> {
  const started = Date.now()
  const watched = new Set(countries)
  const nowISO = now.toISOString()
  const run: Run = { date: nowISO, mode: 'recheck', duration: 0, active: 0, counts: {} }
  const pending = Object.values(cs.apps).filter(a => !a.removedAt && (a.missing ?? 0) > 0)
  const events: WatchEvent[] = []
  if (pending.length) {
    const byCountry = new Map<string, number[]>()
    for (const t of pending) for (const x of t.countries) if (watched.has(x)) byCountry.set(x, [...(byCountry.get(x) ?? []), t.id])
    const jobs = [...byCountry].flatMap(([country, ids]) => chunks(ids, LOOKUP_BATCH).map(ids => ({ country, ids })))
    const present = new Set<number>(), unverified = new Set<number>()
    for (const { input, result } of await pool(jobs, 3, j => lookup(j.ids, j.country))) {
      if (!result.ok) { input.ids.forEach(id => unverified.add(id)); continue }
      result.value.forEach(a => present.add(a.trackId))
    }
    for (const t of pending) {
      if (unverified.has(t.id)) continue
      if (present.has(t.id)) { seenAgain(t); continue }
      if (miss(t, now)) events.push(eventOf('removed', t, nowISO, t.countries.filter(x => watched.has(x))))
    }
    tagRemovals(events, cs, now)
    log(`${c.name} recheck: ${pending.length} missing apps, ${events.length} removed`)
  }
  countRun(run, events)
  run.active = Object.values(cs.apps).filter(a => !a.removedAt).length
  run.duration = (Date.now() - started) / 1000
  cs.events.push(...events)
  cs.runs.push(run)
  return { run, events }
}

/** Context for this check's removals: a developer losing every app at once, or far more removals than usual. */
export function tagRemovals(events: WatchEvent[], cs: CategoryState, now: Date) {
  const removed = events.filter(e => e.kind === 'removed')
  if (!removed.length) return
  const dayAgo = new Date(now.getTime() - DAY).toISOString()
  const devKey = (a: App) => (a.developerId ? String(a.developerId) : a.developer)
  const byDev = new Map<string, App[]>()
  for (const a of Object.values(cs.apps)) byDev.set(devKey(a), [...(byDev.get(devKey(a)) ?? []), a])
  const tags = new Map<number, string[]>()
  const tag = (id: number, s: string) => tags.set(id, [...(tags.get(id) ?? []), s])
  for (const e of removed) {
    const apps = byDev.get(devKey(cs.apps[e.appId])) ?? []
    if (apps.length >= 2 && apps.every(a => (a.removedAt ?? '') >= dayAgo)) tag(e.appId, `developer wiped (${apps.length} apps)`)
  }
  // sweep: today's removal rate far above the usual one. Rates are per day of observation, so removals that
  // piled up while checks were missed don't look like a wave.
  const daily = cs.runs.filter(r => r.mode === 'daily' && !r.failed)
  const prev = daily.at(-1)
  const gapDays = prev ? Math.max(1, (now.getTime() - Date.parse(prev.date)) / DAY) : 1
  const monthAgo = new Date(now.getTime() - 30 * DAY).toISOString()
  const history = cs.events.filter(e => e.kind === 'removed' && e.date >= monthAgo && e.date < dayAgo).length
  const first = daily.find(r => r.date >= monthAgo)
  const span = first ? (now.getTime() - DAY - Date.parse(first.date)) / DAY : 0
  const recent = cs.events.filter(e => e.kind === 'removed' && e.date >= dayAgo).length + removed.length
  const rate = recent / gapDays, usual = span >= 7 ? history / span : Infinity
  if (recent >= 5 && rate >= Math.max(3 * usual, 5)) for (const e of removed) tag(e.appId, `sweep (${recent} removed in 24h)`)
  for (const e of removed) {
    const t = tags.get(e.appId)
    if (!t) continue
    e.note = t.join(' · ')
    cs.apps[e.appId].removalTags = t
  }
}

export { total }
