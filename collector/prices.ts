// In-app purchases from the "In-App Purchases" block of apps.apple.com pages (embedded JSON annotation).
import type { App, Category, CategoryState, InAppItem } from './model.ts'
import { page, pageGate } from './api.ts'
import { listingRank } from './check.ts'
import { DAY, HOUR, log } from './util.ts'

export type Period = 'week' | 'month' | 'quarter' | 'halfYear' | 'year' | 'twoYears' | 'lifetime' | 'other'

const STR = String.raw`((?:[^"\\]|\\.)*)`

/** undefined when the page has no such block (format changed, or the app is gone) */
export function parseInApp(html: string): { has: boolean; items: InAppItem[] } | undefined {
  const start = html.indexOf('"title":"In-App Purchases"')
  if (start < 0) return html.includes('"$kind":"Annotation"') ? { has: false, items: [] } : undefined
  const rest = html.slice(start + 26)
  const endAt = rest.indexOf('"$kind":"Annotation"')
  const block = rest.slice(0, endAt < 0 ? 20_000 : endAt)
  const summary = new RegExp(`"summary":"${STR}"`).exec(block)?.[1] ?? ''
  const items: InAppItem[] = []
  for (const m of block.matchAll(new RegExp(String.raw`\{"\$kind":"textPair","leadingText":"${STR}","trailingText":"${STR}"\}`, 'g'))) {
    const name = unescape(m[1]), priceText = unescape(m[2])
    items.push({ name, priceText, price: priceNumber(priceText) })
  }
  return { has: summary.toLowerCase() === 'yes' || items.length > 0, items }
}

function unescape(s: string): string {
  try { return JSON.parse(`"${s}"`) } catch { return s }
}

const TRIAL = /(\d+)[\s-]*days?[\s-]*(free[\s-]*)?trial|get\s+\d+\s+days?\s+free|\d+\s*[-\s]?days?\s+free|free\s+trial|trial/gi

export const isTrial = (name: string) => { TRIAL.lastIndex = 0; return TRIAL.test(name) }

export function period(name: string): Period {
  // drop trial phrases first: "1 Week - 7 Days Free Trial" is a weekly plan, not 7 days
  const s = name.replace(TRIAL, ' ').toLowerCase()
  const has = (p: RegExp) => p.test(s)
  if (has(/life\s*time|forever|one[\s-]*time|permanent/)) return 'lifetime'
  if (has(/\b(24[\s-]*months?|2[\s-]*years?|two\s+years?)\b/)) return 'twoYears'
  if (has(/\b(12[\s-]*months?|1[\s-]*years?|one\s+year)\b/)) return 'year'
  if (has(/\b(6[\s-]*months?|half[\s-]*year)\b/)) return 'halfYear'
  if (has(/\b(3[\s-]*months?|quarter|quarterly)\b/)) return 'quarter'
  if (has(/\b(1[\s-]*months?|one\s+month)\b/)) return 'month'
  if (has(/\b(1[\s-]*weeks?|one\s+week|7[\s-]*days?|1w)\b/)) return 'week'
  if (has(/\b(year|yearly|annual|annually|1y)\b/)) return 'year'
  if (has(/\b(month|monthly|1m)\b/)) return 'month'
  if (has(/\b(week|weekly)\b/)) return 'week'
  return 'other'
}

/** "$7.99" / "7,99 €" / "1,299.00" / "1.299,00" / "₽599" → number */
export function priceNumber(text: string): number | undefined {
  const raw = /(\d[\d\s., ]*)/.exec(text)?.[1]
  if (!raw) return undefined
  let s = raw.replace(/[\s ]/g, '').replace(/[.,]+$/, '')
  const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
  else if (comma >= 0) s = s.length - comma === 3 ? s.replace(',', '.') : s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** the usual price of a period's plan: the one listed most often; a tie takes the lower median */
export function plan(items: InAppItem[] | undefined, p: Period): InAppItem | undefined {
  const list = (items ?? []).filter(i => i.price !== undefined && period(i.name) === p)
  if (!list.length) return undefined
  const counts = new Map<number, InAppItem[]>()
  for (const i of list) counts.set(i.price!, [...(counts.get(i.price!) ?? []), i])
  const top = Math.max(...[...counts.values()].map(v => v.length))
  const tied = [...counts.keys()].filter(k => counts.get(k)!.length === top).sort((a, b) => a - b)
  return counts.get(tied[Math.floor((tied.length - 1) / 2)])![0]
}

/**
 * Reads the in-app purchases of each category's most-rated apps, one page at a time — at most once a week per app.
 * The same app in two categories is fetched once.
 */
export async function scanPrices(cats: { c: Category; cs: CategoryState }[], top: number, countries: string[], everyDays: number, now: Date) {
  const stale = new Date(now.getTime() - everyDays * DAY + 2 * HOUR).toISOString()
  const jobs: { app: App; country: string }[] = []
  const queued = new Set<number>()
  for (const { cs } of cats) {
    const list = Object.values(cs.apps).filter(a => !a.removedAt).sort((a, b) => b.ratings - a.ratings).slice(0, top)
    for (const t of list) {
      if ((t.inAppAt ?? '') >= stale || queued.has(t.id)) continue
      // US prices make apps comparable; otherwise the app's own main storefront
      const country = t.countries.includes('us') ? 'us'
        : t.countries.filter(c => countries.includes(c)).sort((a, b) => listingRank(a) - listingRank(b) || a.localeCompare(b))[0] ?? 'us'
      jobs.push({ app: t, country })
      queued.add(t.id)
    }
  }
  log(`prices: ${jobs.length} pages to read`)
  const read = new Map<number, { has: boolean; items: InAppItem[]; country: string }>()
  let failures = 0
  for (const [i, j] of jobs.entries()) {
    try {
      const r = parseInApp(await page(j.app.id, j.country))
      if (r) { read.set(j.app.id, { ...r, country: j.country }); failures = 0 }
      else failures++
    } catch (e) {
      failures++
      log(`prices: ${(e as Error).message}`)
    }
    if (failures >= 8) { log('prices: too many failures in a row, stopping'); break }
    if ((i + 1) % 50 === 0) log(`prices ${i + 1}/${jobs.length}${pageGate.slowed ? ' (slowed)' : ''}`)
  }
  // write the result into every category that tracks the app
  const at = now.toISOString()
  for (const { cs } of cats) {
    for (const [id, r] of read) {
      const t = cs.apps[id]
      if (!t) continue
      t.hasInApp = r.has; t.inApp = r.items.slice(0, 12); t.inAppAt = at; t.inAppCountry = r.country
    }
  }
  return { read: read.size, total: jobs.length }
}
