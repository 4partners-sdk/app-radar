// Writes what the dashboard reads: compact per-category files plus lazily loaded per-app details.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { App, Category, CategoryState, GlobalState, Settings, WatchState, WatchedApp } from './model.ts'
import { gained, isBoost } from './app.ts'
import { isTrial, plan } from './prices.ts'
import { ROOT, writeJSON } from './store.ts'
import { wordsIn } from './util.ts'

export const SITE_DATA = process.env.SITE_DATA_DIR ?? join(ROOT, 'site', 'public', 'data')
export const SHARDS = 32

const date = (s?: string) => s?.slice(0, 10)

function row(a: App, s: Settings, today: number) {
  const m = a.meta
  const week = plan(a.inApp, 'week'), month = plan(a.inApp, 'month'), year = plan(a.inApp, 'year'), life = plan(a.inApp, 'lifetime')
  const plans = ([['1W', week], ['1M', month], ['3M', plan(a.inApp, 'quarter')], ['6M', plan(a.inApp, 'halfYear')], ['1Y', year], ['∞', life]] as const)
    .filter(([, p]) => p).map(([k, p]) => `${k} ${p!.priceText}`).join(' · ')
  return {
    id: a.id, name: a.name, dev: a.developer, devId: a.developerId, genre: a.genre,
    rating: Math.round(a.rating * 100) / 100, ratings: a.ratings,
    released: date(a.releaseDate), updated: date(m?.updatedAt), version: m?.version,
    price: m?.price ?? 0, priceLabel: !m || m.price === 0 ? 'Free' : m.formattedPrice,
    countries: a.countries, langs: m?.languages.length ?? 0, iPad: m?.iPad ?? false,
    sizeMB: m ? Math.round(m.sizeBytes / 104857.6) / 10 : undefined,
    age: m?.ageRating, minOS: m?.minOS, bundle: m?.bundleId,
    firstSeen: date(a.firstSeen), removedAt: a.removedAt, missingSince: a.missingSince, lastSeen: a.lastSeen,
    tags: a.removalTags, pulled: a.pulledFrom ? Object.keys(a.pulledFrom) : undefined,
    g7: gained(a, 7, today), g30: gained(a, 30, today),
    hasIAP: a.hasInApp, iapCountry: a.inAppCountry, iapAt: date(a.inAppAt),
    week: week?.price, month: month?.price, year: year?.price, lifetime: life?.price, plans: plans || undefined,
    trial: a.inApp?.some(i => isTrial(i.name)) || undefined,
    claims: wordsIn(a.name + '\n' + (m?.desc ?? ''), s.riskyWords),
    icon: m?.icon, url: a.url,
  }
}

export type AppRow = ReturnType<typeof row>

/** A watched app as the dashboard shows it: the list entry, with names as the App Store lists them now. */
function watchRow(a: WatchedApp, st: WatchState | undefined) {
  return {
    id: a.id, name: st?.name ?? a.name, developer: st?.developer ?? a.developer, icon: st?.icon ?? a.icon,
    addedAt: a.addedAt, addedBy: a.addedBy,
    checkedAt: st?.checkedAt, countries: st?.countries ?? [], lastSeen: st?.lastSeen,
    removedAt: st?.removedAt, missingSince: st?.missingSince,
    pulled: st?.pulled && Object.keys(st.pulled).length ? st.pulled : undefined,
  }
}

export type WatchRow = ReturnType<typeof watchRow>

export function publish(cats: { c: Category; cs: CategoryState }[], g: GlobalState, s: Settings, today: number) {
  rmSync(SITE_DATA, { recursive: true, force: true })
  const index = {
    generatedAt: new Date().toISOString(), lastDaily: g.lastDaily, lastRecheck: g.lastRecheck, lastPrices: g.lastPrices,
    timezone: s.timezone, dailyHour: s.dailyHour, retentionDays: s.retentionDays, countries: s.countries,
    featureWords: s.featureWords, riskyWords: s.riskyWords, pricesTop: s.pricesTop,
    watchers: (g.watchers ?? []).map(a => watchRow(a, g.watch?.[a.id])), lastReviews: g.lastReviews,
    watchEveryHours: s.watchEveryHours ?? 3,
    categories: cats.map(({ c, cs }) => {
      const apps = Object.values(cs.apps)
      return { id: c.id, name: c.name, enabled: c.enabled, active: apps.filter(a => !a.removedAt).length, removed: apps.filter(a => a.removedAt).length }
    }),
  }
  writeJSON(join(SITE_DATA, 'index.json'), index)
  for (const { c, cs } of cats) {
    const dir = join(SITE_DATA, c.id)
    const apps = Object.values(cs.apps)
    writeJSON(join(dir, 'apps.json'), apps.map(a => row(a, s, today)))
    writeJSON(join(dir, 'events.json'), [...cs.events].reverse())
    writeJSON(join(dir, 'runs.json'), cs.runs)
    const versions = apps.flatMap(a => (a.versions ?? []).filter(v => v.seen).map(v => ({
      id: a.id, version: v.version, date: v.date, notes: v.notes.slice(0, 400),
      before: v.before, after: v.after, boost: isBoost(v) || undefined,
    })))
    writeJSON(join(dir, 'versions.json'), versions)
    const shards: Record<string, unknown>[] = Array.from({ length: SHARDS }, () => ({}))
    for (const a of apps) {
      shards[a.id % SHARDS][a.id] = {
        growth: a.growth, byCountry: a.byCountry, versions: a.versions, inApp: a.inApp,
        notes: a.meta?.notes, languages: a.meta?.languages, screenshots: a.meta?.screenshots, desc: a.meta?.desc,
        genres: a.meta?.genres, sellerURL: a.meta?.sellerURL, pulledFrom: a.pulledFrom, countryMiss: a.countryMiss,
      }
    }
    shards.forEach((sh, i) => writeJSON(join(dir, 'd', `${i}.json`), sh))
  }
  writeJSON(join(SITE_DATA, 'reviews.json'), g.reviews)
}
