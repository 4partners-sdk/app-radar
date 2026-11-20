// One-off import from the Mac app's state.json, so the dashboard starts with its history instead of empty.
import { readFileSync } from 'node:fs'
import type { App, CategoryState, GlobalState, GrowthPoint, Run, Settings, Version, WatchEvent } from './model.ts'
import { DAY } from './util.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Old = any

/**
 * The Mac app kept one total per day, summed over storefronts — a storefront found later shows up as a jump.
 * Steps that look like coverage (a sudden +25% and +200, or a drop) are neutralised; the rest is kept as growth.
 */
function growthFrom(history: { date: string; count: number }[] | undefined, day: (d: Date) => number, fromDay: number): GrowthPoint[] {
  const h = (history ?? []).map(p => ({ day: day(new Date(p.date)), count: p.count }))
  const out: GrowthPoint[] = []
  let cum = 0
  for (let i = 0; i < h.length; i++) {
    if (i > 0) {
      const d = h[i].count - h[i - 1].count
      const coverage = d > Math.max(200, 0.25 * h[i - 1].count) || d < -0.05 * h[i - 1].count
      if (!coverage) cum += d
    }
    if (h[i].day >= fromDay - 1) {
      if (out.at(-1)?.[0] === h[i].day) out.at(-1)![1] = cum
      else out.push([h[i].day, cum])
    }
  }
  return out
}

export function seed(file: string, s: Settings, day: (d: Date) => number, now: Date) {
  const old: Old = JSON.parse(readFileSync(file, 'utf8'))
  const from = new Date(now.getTime() - s.retentionDays * DAY).toISOString()
  const fromDay = day(now) - s.retentionDays
  const cats: Record<string, CategoryState> = {}
  for (const [id, oc] of Object.entries<Old>(old.categories ?? {})) {
    const cs: CategoryState = { apps: {}, events: [], runs: [] }
    for (const [key, a] of Object.entries<Old>(oc.apps ?? {})) {
      if (a.removedAt && a.removedAt < from) continue
      const m = a.meta
      const byCountry: Record<string, [number, number]> = {}
      for (const [c, n] of Object.entries<number>(a.ratingsByCountry ?? {})) byCountry[c] = [n, a.rating ?? 0]
      const t: App = {
        id: Number(key), name: a.name, developer: a.developer, developerId: m?.developerId, url: a.url, genre: a.genre,
        releaseDate: a.releaseDate, firstSeen: a.firstSeen, lastSeen: a.lastSeen,
        countries: [...(a.countries ?? [])].sort(), byCountry, ratings: a.ratingCount ?? 0, rating: a.rating ?? 0,
        growth: growthFrom(a.history, day, fromDay),
      }
      if (m) {
        t.meta = {
          version: m.version, updatedAt: m.updatedAt, notes: (m.notes ?? '').slice(0, 1500), price: m.price ?? 0,
          formattedPrice: m.formattedPrice ?? 'Free', languages: m.languages ?? [], sizeBytes: m.sizeBytes ?? 0, minOS: m.minOS ?? '',
          iPad: !!m.iPad, ageRating: m.ageRating ?? '', genres: m.genres ?? [], bundleId: m.bundleId ?? '', sellerURL: m.sellerURL,
          icon: m.icon, screenshots: (m.screenshots ?? []).slice(0, 4), desc: m.desc?.slice(0, 800),
        }
      }
      // old measurements were taken on the coverage-polluted totals: measure again on the cleaned growth
      t.versions = (a.updates ?? []).slice(-40).map((u: Old): Version => ({ version: u.version, date: u.date, notes: (u.notes ?? '').slice(0, 1500), seen: u.seenRelease !== false }))
      if (a.missingStreak) t.missing = a.missingStreak
      if (a.missingSince) t.missingSince = a.missingSince
      if (a.removedAt) t.removedAt = a.removedAt
      if (a.removalTags) t.removalTags = a.removalTags
      if (a.pulledFrom) t.pulledFrom = a.pulledFrom
      if (a.countryMisses) t.countryMiss = Object.fromEntries(Object.entries<number>(a.countryMisses).map(([c, n]) => [c, { n, since: a.lastSeen }]))
      if (a.inApp) { t.inApp = a.inApp; t.hasInApp = a.hasInApp; t.inAppAt = a.inAppCheckedAt; t.inAppCountry = a.inAppCountry }
      else if (a.hasInApp !== undefined) { t.hasInApp = a.hasInApp; t.inAppAt = a.inAppCheckedAt; t.inAppCountry = a.inAppCountry }
      cs.apps[key] = t
    }
    cs.events = (oc.events ?? []).filter((e: Old) => e.date >= from).map((e: Old): WatchEvent => {
      const x: WatchEvent = { date: e.date, kind: e.kind, appId: e.appId, name: e.name, developer: e.developer, url: e.url }
      if (e.countries?.length) x.countries = e.countries
      if (e.note) x.note = e.note
      return x
    })
    cs.runs = (oc.runs ?? []).filter((r: Old) => r.date >= from).map((r: Old): Run => {
      const counts: Run['counts'] = {}
      for (const k of ['released', 'discovered', 'removed', 'returned', 'pulled', 'updated', 'boosted'] as const) if (r[k]) counts[k] = r[k]
      return { date: r.date, mode: 'daily', duration: r.duration, active: r.active, counts, baseline: r.baseline || undefined, failed: r.failed || undefined, error: r.error }
    })
    cats[id] = cs
  }
  const g: GlobalState = {
    lastDaily: [...(old.runs ?? [])].reverse().find((r: Old) => !r.failed)?.date,
    lastPrices: old.lastPrices,
    seen: Object.fromEntries(Object.entries<Old>(old.favorites ?? {}).map(([id, f]) => [id, f.seen ?? {}])),
    reviews: (old.reviews ?? []).filter((r: Old) => r.date >= from).map((r: Old) => ({
      id: r.id, appId: r.appId, country: r.country, rating: r.rating, title: r.title, text: r.text, version: r.version,
      author: r.author, date: r.date, reasons: r.reasons ?? [],
    })),
  }
  return { cats, g }
}
