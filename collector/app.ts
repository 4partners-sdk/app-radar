// Per-app bookkeeping: listing, ratings growth, versions, misses.
import type { App, GrowthPoint, Meta, StoreApp, Version, WatchEvent, EventKind } from './model.ts'
import { DAY, HOUR } from './util.ts'

/** consecutive misses before an app counts as removed */
export const MISSES_TO_REMOVE = 2
/** …and at least this long between the first miss and the confirming one: two checks minutes apart prove nothing */
export const MIN_MISS_SPAN = 3 * HOUR
/** days since release for an app to count as New, not just Found */
export const FRESH_DAYS = 30
export const IMPACT_DAYS = 7
const MEASURE_GIVE_UP = 30 * DAY

export function metaOf(a: StoreApp): Meta {
  return {
    version: a.version ?? '',
    updatedAt: a.currentVersionReleaseDate ?? a.releaseDate,
    notes: (a.releaseNotes ?? '').slice(0, 1500),
    price: a.price ?? 0,
    formattedPrice: a.formattedPrice ?? 'Free',
    languages: a.languageCodesISO2A ?? [],
    sizeBytes: Number(a.fileSizeBytes ?? 0) || 0,
    minOS: a.minimumOsVersion ?? '',
    iPad: (a.supportedDevices ?? []).some(d => d.startsWith('iPad')),
    ageRating: a.contentAdvisoryRating ?? '',
    genres: a.genres ?? [],
    bundleId: a.bundleId ?? '',
    sellerURL: a.sellerUrl,
    icon: a.artworkUrl512 ?? a.artworkUrl100,
    screenshots: (a.screenshotUrls ?? []).slice(0, 4),
    desc: a.description?.slice(0, 800),
  }
}

/** store link without the `?uo=4` tail */
export const cleanURL = (u: string) => u.split('?')[0]

export function newApp(a: StoreApp, countries: string[], now: string): App {
  return {
    id: a.trackId, name: a.trackName, developer: a.artistName, developerId: a.artistId,
    url: cleanURL(a.trackViewUrl), genre: a.primaryGenreName ?? '', releaseDate: a.releaseDate,
    firstSeen: now, lastSeen: now, countries: [...countries].sort(), byCountry: {}, ratings: 0, rating: 0, growth: [],
  }
}

export function eventOf(kind: EventKind, t: App, date: string, countries: string[] = [], note?: string): WatchEvent {
  const e: WatchEvent = { date, kind, appId: t.id, name: t.name, developer: t.developer, url: t.url }
  if (countries.length) e.countries = [...countries].sort()
  if (note) e.note = note.length > 500 ? note.slice(0, 500) + '…' : note
  return e
}

/** Ratings total over the storefronts the app is live in and that are watched. */
export function total(t: App, watched: Set<string>): [number, number] {
  let n = 0, w = 0
  for (const c of t.countries) {
    const r = t.byCountry[c]
    if (!r || !watched.has(c)) continue
    n += r[0]; w += r[0] * r[1]
  }
  return [n, n ? w / n : 0]
}

/**
 * Merges this check's per-storefront ratings. Growth only counts storefronts that were already known:
 * an app found in a new storefront brings that storefront's whole rating count, which is coverage, not growth.
 */
export function recordRatings(t: App, seen: Record<string, [number, number]>, watched: Set<string>, day: number) {
  let delta = 0
  for (const [c, r] of Object.entries(seen)) {
    const old = t.byCountry[c]
    if (old) delta += r[0] - old[0]
    t.byCountry[c] = r
  }
  ;[t.ratings, t.rating] = total(t, watched)
  const g = t.growth
  const last = g.at(-1)
  if (last && last[0] === day) last[1] += delta
  else g.push([day, (last?.[1] ?? 0) + delta])
}

/** Stores the latest listing; returns the new version when it changed since the last check. */
export function applyMeta(t: App, m: Meta, now: string): Version | undefined {
  t.meta = m
  if (!m.version) return undefined
  const list = (t.versions ??= [])
  const last = list.at(-1)
  if (!last) { list.push({ version: m.version, date: m.updatedAt ?? now, notes: m.notes, seen: false }); return undefined }
  if (last.version === m.version) return undefined
  const v: Version = { version: m.version, date: m.updatedAt ?? now, notes: m.notes, seen: true }
  list.push(v)
  if (list.length > 40) list.splice(0, list.length - 40)
  return v
}

/** One more check without the app anywhere; true when that confirms the removal. */
export function miss(t: App, now: Date): boolean {
  t.missing = (t.missing ?? 0) + 1
  t.missingSince ??= now.toISOString()
  if (t.missing < MISSES_TO_REMOVE || now.getTime() - Date.parse(t.missingSince) < MIN_MISS_SPAN) return false
  t.removedAt = now.toISOString()
  return true
}

export function seenAgain(t: App) {
  delete t.missing
  delete t.missingSince
}

/** Storefront-level misses for an app still live elsewhere; returns the storefronts it was just pulled from. */
export function missIn(t: App, gone: string[], present: string[], watched: Set<string>, now: Date): string[] {
  const m = t.countryMiss ?? {}
  for (const c of present) delete m[c]
  const pulled: string[] = []
  for (const c of gone) {
    const e = (m[c] ??= { n: 0, since: now.toISOString() })
    e.n++
    if (e.n >= MISSES_TO_REMOVE && now.getTime() - Date.parse(e.since) >= MIN_MISS_SPAN) {
      delete m[c]
      t.countries = t.countries.filter(x => x !== c)
      delete t.byCountry[c]
      ;(t.pulledFrom ??= {})[c] = now.toISOString()
      pulled.push(c)
    }
  }
  if (Object.keys(m).length) t.countryMiss = m
  else delete t.countryMiss
  if (pulled.length) [t.ratings, t.rating] = total(t, watched)
  return pulled.sort()
}

/** the growth point nearest to a day, within 1.5 days */
export function pointNear(g: GrowthPoint[], day: number): GrowthPoint | undefined {
  let best: GrowthPoint | undefined
  for (const p of g) if (!best || Math.abs(p[0] - day) < Math.abs(best[0] - day)) best = p
  return best && Math.abs(best[0] - day) <= 1.5 ? best : undefined
}

/** ratings per day between two points, over the days actually between them (checks are not always daily) */
function pace(a: GrowthPoint | undefined, b: GrowthPoint | undefined): number | undefined {
  if (!a || !b || b[0] - a[0] < 4) return undefined
  return (b[1] - a[1]) / (b[0] - a[0])
}

/** ratings gained over the last `days`, or undefined until the history reaches back that far */
export function gained(t: App, days: number, today: number): number | undefined {
  const g = t.growth
  if (!g.length || g[0][0] > today - days + 0.5) return undefined
  const now = g.at(-1)![1]
  const base = [...g].reverse().find(p => p[0] <= today - days)
  return base ? now - base[1] : undefined
}

export function isBoost(v: Version): boolean {
  if (v.before === undefined || v.after === undefined || v.after < 3) return false
  return v.after >= v.before * 1.5 && v.after - v.before >= 2
}

/** Measures every release whose 7-day after-window has closed; returns the ones that boosted the rating pace. */
export function measureVersions(t: App, now: Date, tz: (d: Date) => number): { version: Version; note: string }[] {
  const boosts: { version: Version; note: string }[] = []
  for (const v of t.versions ?? []) {
    if (!v.seen || v.measured) continue
    const released = new Date(v.date)
    if (now.getTime() - released.getTime() < IMPACT_DAYS * DAY) continue
    const d = tz(released)
    const at = pointNear(t.growth, d)
    const after = pace(at, pointNear(t.growth, d + IMPACT_DAYS))
    if (after === undefined) {
      // a hole in the history around the release (missed checks): try again later, give up once it can't fill in
      if (now.getTime() - released.getTime() > MEASURE_GIVE_UP) v.measured = true
      continue
    }
    v.measured = true
    v.after = after
    const before = pace(pointNear(t.growth, d - IMPACT_DAYS), at)
    if (before !== undefined) v.before = before
    if (isBoost(v)) {
      const f = (x: number) => (x < 10 ? x.toFixed(1) : x.toFixed(0))
      const up = v.before ? `×${(v.after / v.before).toFixed(1)}` : 'from zero'
      boosts.push({ version: v, note: `v${v.version}: ${f(v.after)} ratings/day vs ${f(v.before ?? 0)} before (${up})` })
    }
  }
  return boosts
}
