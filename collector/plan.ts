// The network half of a daily check, split so it can run on several machines at once.
//
// buildPlan  — every request today's check needs, in a fixed order (same state + same date ⇒ same list), so each
//              parallel job can take its own share: job i belongs to shard i % shards.
// runJobs    — one shard's share: App Store searches (filtered by the category rules), lookups of known apps and
//              App Store pages for subscription prices. Apple limits the Search API per IP, so N machines ≈ N× faster.
// The other half (diff → events) is applyCategory in check.ts; it reads these results instead of the network.
import type { Category, CategoryState, GlobalState, InAppItem, Settings, StoreApp } from './model.ts'
import { LOOKUP_BATCH, apiGate, lookup, page, search } from './api.ts'
import { Classifier } from './classify.ts'
import { listingRank, todaysSearches } from './check.ts'
import { parseInApp } from './prices.ts'
import { DAY, HOUR, chunks, log, pool } from './util.ts'

export type Job =
  | { kind: 'search'; cat: string; country: string; term: string }
  | { kind: 'lookup'; cat: string; country: string; ids: number[] }
  | { kind: 'page'; id: number; country: string }

/** apps: [id, ratings, average] for every app the request returned (searches: only those matching the category) */
export interface Hit {
  i: number
  ok: boolean
  err?: string
  apps?: [number, number, number][]
  page?: { has: boolean; items: InAppItem[] } | null
}

/** the listing kept for an app: from the most English storefront any of its requests saw */
export interface Listing { country: string; app: StoreApp }

export interface ShardResult {
  shard: number
  shards: number
  /** length of the plan this shard worked from — the merge checks it matches its own */
  jobs: number
  hits: Hit[]
  listings: Record<string, Listing>
}

export function pricesDue(g: GlobalState, s: Settings, now: Date): boolean {
  return s.pricesTop > 0 && (!g.lastPrices || now.getTime() - Date.parse(g.lastPrices) > s.pricesEveryDays * DAY - 2 * HOUR)
}

export const rotationDays = (s: Settings) => Number(process.env.SEARCH_ROTATION_DAYS) || s.searchRotationDays || 1

export function buildPlan(cats: { c: Category; cs: CategoryState }[], g: GlobalState, s: Settings, now: Date, today: number): Job[] {
  const watched = new Set(s.countries)
  const jobs: Job[] = []
  for (const { c, cs } of cats) {
    if (!c.enabled) continue
    const baseline = Object.keys(cs.apps).length === 0
    const all = s.countries.flatMap(country => c.terms.map(term => ({ country, term })))
    for (const x of todaysSearches(all, rotationDays(s), today, baseline)) jobs.push({ kind: 'search', cat: c.id, ...x })
    // every tracked app (live or removed) in every storefront it lives in: bans, returns, versions, ratings
    const known = Object.values(cs.apps).filter(a => a.countries.some(x => watched.has(x)))
    for (const country of s.countries) {
      const ids = known.filter(a => a.countries.includes(country)).map(a => a.id).sort((a, b) => a - b)
      for (const batch of chunks(ids, LOOKUP_BATCH)) jobs.push({ kind: 'lookup', cat: c.id, country, ids: batch })
    }
  }
  if (pricesDue(g, s, now)) {
    // the most-rated apps of each category whose prices are a week old; the same app in two categories once
    const stale = new Date(now.getTime() - s.pricesEveryDays * DAY + 2 * HOUR).toISOString()
    const queued = new Set<number>()
    for (const { c, cs } of cats) {
      if (!c.enabled) continue
      const top = Object.values(cs.apps).filter(a => !a.removedAt).sort((a, b) => b.ratings - a.ratings || a.id - b.id).slice(0, s.pricesTop)
      for (const t of top) {
        if ((t.inAppAt ?? '') >= stale || queued.has(t.id)) continue
        // US prices make apps comparable; otherwise the app's own main storefront
        const country = t.countries.includes('us') ? 'us'
          : t.countries.filter(x => watched.has(x)).sort((a, b) => listingRank(a) - listingRank(b) || a.localeCompare(b))[0] ?? 'us'
        jobs.push({ kind: 'page', id: t.id, country })
        queued.add(t.id)
      }
    }
  }
  return jobs
}

/** Only what the diff and the dashboard use — results travel between machines, so they stay small. */
export function slim(a: StoreApp): StoreApp {
  return {
    trackId: a.trackId, trackName: a.trackName, artistName: a.artistName, artistId: a.artistId, trackViewUrl: a.trackViewUrl,
    primaryGenreName: a.primaryGenreName, description: a.description?.slice(0, 800),
    averageUserRating: a.averageUserRating, userRatingCount: a.userRatingCount, releaseDate: a.releaseDate,
    version: a.version, currentVersionReleaseDate: a.currentVersionReleaseDate, releaseNotes: a.releaseNotes?.slice(0, 1500),
    price: a.price, formattedPrice: a.formattedPrice, languageCodesISO2A: a.languageCodesISO2A, fileSizeBytes: a.fileSizeBytes,
    minimumOsVersion: a.minimumOsVersion, supportedDevices: a.supportedDevices?.some(d => d.startsWith('iPad')) ? ['iPad'] : [],
    contentAdvisoryRating: a.contentAdvisoryRating, genres: a.genres, bundleId: a.bundleId, sellerUrl: a.sellerUrl,
    artworkUrl512: a.artworkUrl512 ?? a.artworkUrl100, screenshotUrls: a.screenshotUrls?.slice(0, 4),
  }
}

/** this shard's share of the plan: request i belongs to shard i % shards */
export const shareOf = <T>(jobs: T[], shard: number, shards: number) => jobs.map((job, i) => ({ job, i })).filter(x => x.i % shards === shard)

/** Runs this shard's share of the plan. Searches and lookups go through the API gate; pages, a separate host, run alongside. */
export async function runJobs(jobs: Job[], shard: number, shards: number, cats: Category[]): Promise<ShardResult> {
  const classifiers = new Map(cats.map(c => [c.id, new Classifier(c)]))
  const mine = shareOf(jobs, shard, shards)
  const listings: Record<string, Listing> = {}
  const keep = (a: StoreApp, country: string) => {
    const old = listings[a.trackId]
    if (!old || listingRank(country) < listingRank(old.country)) listings[a.trackId] = { country, app: slim(a) }
  }
  const api = mine.filter(x => x.job.kind !== 'page')
  const pages = mine.filter(x => x.job.kind === 'page')
  log(`shard ${shard}/${shards}: ${api.length} API requests, ${pages.length} pages of ${jobs.length} in the plan`)

  let done = 0
  const apiRun = pool(api, 4, async ({ job, i }): Promise<Hit> => {
    if (job.kind === 'search') {
      const apps = (await search(job.term, job.country)).filter(a => classifiers.get(job.cat)!.matches(a))
      apps.forEach(a => keep(a, job.country))
      return { i, ok: true, apps: apps.map(a => [a.trackId, a.userRatingCount ?? 0, a.averageUserRating ?? 0]) }
    }
    if (job.kind === 'lookup') {
      const apps = await lookup(job.ids, job.country)
      apps.forEach(a => keep(a, job.country))
      return { i, ok: true, apps: apps.map(a => [a.trackId, a.userRatingCount ?? 0, a.averageUserRating ?? 0]) }
    }
    throw new Error('pages run separately')
  }, () => {
    if (++done % 50 === 0) log(`shard ${shard}: ${done}/${api.length}${apiGate.slowed ? ' (slowed)' : ''}`)
  })

  const pageRun = (async () => {
    const out: Hit[] = []
    let failsInRow = 0
    for (const { job, i } of pages) {
      if (job.kind !== 'page') continue
      // a changed page format fails every page: stop after a run of failures instead of reading them all
      if (failsInRow >= 8) { out.push({ i, ok: false, err: 'skipped after repeated failures' }); continue }
      try {
        const parsed = parseInApp(await page(job.id, job.country))
        out.push({ i, ok: true, page: parsed ?? null })
        failsInRow = parsed ? 0 : failsInRow + 1
      } catch (e) {
        failsInRow++
        out.push({ i, ok: false, err: (e as Error).message })
      }
    }
    return out
  })()

  const [apiResults, pageHits] = await Promise.all([apiRun, pageRun])
  const hits: Hit[] = apiResults.map(({ input, result }) =>
    result.ok ? result.value : { i: input.i, ok: false, err: String((result.error as Error)?.message ?? result.error) })
  hits.push(...pageHits)
  const failed = hits.filter(h => !h.ok).length
  log(`shard ${shard}: ${hits.length - failed} ok, ${failed} failed, ${Object.keys(listings).length} apps`)
  return { shard, shards, jobs: jobs.length, hits, listings }
}

/** Joins the shards' results; a listing from a more English storefront wins. Missing shards simply leave no hits. */
export function mergeResults(results: ShardResult[]): { hits: Map<number, Hit>; listings: Map<number, Listing> } {
  const hits = new Map<number, Hit>()
  const listings = new Map<number, Listing>()
  for (const r of results) {
    for (const h of r.hits) hits.set(h.i, h)
    for (const [id, l] of Object.entries(r.listings)) {
      const old = listings.get(Number(id))
      if (!old || listingRank(l.country) < listingRank(old.country)) listings.set(Number(id), l)
    }
  }
  return { hits, listings }
}

/** Writes the prices that came back into every category tracking the app. */
export function applyPrices(cats: { cs: CategoryState }[], jobs: Job[], hits: Map<number, Hit>, now: Date): { read: number; total: number } {
  let read = 0, total = 0
  const at = now.toISOString()
  jobs.forEach((job, i) => {
    if (job.kind !== 'page') return
    total++
    const h = hits.get(i)
    if (!h?.ok || !h.page) return
    read++
    for (const { cs } of cats) {
      const t = cs.apps[job.id]
      if (!t) continue
      t.hasInApp = h.page.has; t.inApp = h.page.items.slice(0, 12); t.inAppAt = at; t.inAppCountry = job.country
    }
  })
  return { read, total }
}
