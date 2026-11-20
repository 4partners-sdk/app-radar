// `node collector/selftest.ts` — checks of the pure logic, no network.
import type { App } from './model.ts'
import { gained, measureVersions, miss, missIn, recordRatings } from './app.ts'
import { Classifier } from './classify.ts'
import { applyCategory, todaysSearches } from './check.ts'
import { open, seal } from './crypto.ts'
import { type Hit, type Job, type Listing, buildPlan, shareOf } from './plan.ts'
import type { CategoryState, Settings, StoreApp } from './model.ts'
import { parseInApp, period, plan, priceNumber, isTrial } from './prices.ts'
import { parseFeed, reasons } from './reviews.ts'
import { categories } from './store.ts'
import { DAY, HOUR, hasWord } from './util.ts'

let failed = 0
function check(name: string, ok: boolean) {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}`)
}

const blank = (): App => ({ id: 1, name: 'X', developer: 'D', url: 'u', genre: 'Utilities', firstSeen: '', lastSeen: '', countries: ['us', 'gb'], byCountry: {}, ratings: 0, rating: 0, growth: [] })
const watched = new Set(['us', 'gb', 'de'])

// growth ignores storefronts that appear later
{
  const a = blank()
  recordRatings(a, { us: [1000, 4.5] }, watched, 100)
  recordRatings(a, { us: [1010, 4.5] }, watched, 101)
  a.countries.push('de')
  recordRatings(a, { us: [1020, 4.5], de: [50_000, 4] }, watched, 102)
  check('ratings total counts the new storefront', a.ratings === 51_020)
  check('growth does not count a newly found storefront', a.growth.at(-1)![1] === 20)
  recordRatings(a, { us: [1030, 4.5], de: [50_100, 4] }, watched, 103)
  check('…but counts its growth from then on', a.growth.at(-1)![1] === 130)
  check('gained over 2 days', gained(a, 2, 103) === 120)
  check('gained is undefined until the history is long enough', gained(a, 7, 103) === undefined)
  recordRatings(a, { us: [1035, 4.5] }, watched, 103)
  check('same day replaces the point instead of adding one', a.growth.length === 4 && a.growth.at(-1)![1] === 135)
}

// removals need two misses hours apart
{
  const a = blank(), t0 = new Date('2026-11-01T08:00:00Z')
  check('first miss is not a removal', !miss(a, t0) && !a.removedAt)
  check('second miss minutes later is not a removal', !miss(a, new Date(t0.getTime() + 10 * 60_000)) && !a.removedAt)
  check('a miss 3 h after the first confirms it', miss(a, new Date(t0.getTime() + 3 * HOUR)) && !!a.removedAt && a.missingSince === t0.toISOString())
  const p = blank()
  check('storefront miss once: not pulled', missIn(p, ['gb'], ['us'], watched, t0).length === 0)
  check('storefront miss again minutes later: not pulled', missIn(p, ['gb'], ['us'], watched, new Date(t0.getTime() + 60_000)).length === 0)
  const pulled = missIn(p, ['gb'], ['us'], watched, new Date(t0.getTime() + 24 * HOUR))
  check('storefront miss a day later: pulled from GB only', pulled.join() === 'gb' && p.countries.join() === 'us')
}

// update impact on clean growth
{
  const a = blank()
  for (let d = 0; d <= 21; d++) a.growth.push([20000 + d, d <= 7 ? d * 10 : 70 + (d - 7) * 40])
  a.versions = [{ version: '1', date: new Date(20000 * DAY).toISOString(), notes: '', seen: false }, { version: '2', date: new Date(20007 * DAY + 9 * HOUR).toISOString(), notes: 'AI', seen: true }]
  const boosts = measureVersions(a, new Date(20021 * DAY), d => Math.floor(d.getTime() / DAY))
  check('boost 10 → 40 / day detected', boosts.length === 1 && a.versions[1].before === 10 && a.versions[1].after === 40)

  // missed checks: the points used are 6 and 8 days from the release — the pace must use those spans, not 7
  const b = blank()
  for (const d of [20001, 20007, 20015]) b.growth.push([d, d === 20001 ? 0 : d === 20007 ? 60 : 140])
  b.versions = [{ version: '1', date: new Date(19990 * DAY).toISOString(), notes: '', seen: false }, { version: '2', date: new Date(20007 * DAY).toISOString(), notes: '', seen: true }]
  const flat = measureVersions(b, new Date(20020 * DAY), d => Math.floor(d.getTime() / DAY))
  check('uneven gaps: 10/day before and after is not a boost', flat.length === 0 && b.versions[1].before === 10 && b.versions[1].after === 10)
}

// search rotation: every pair once per cycle, every storefront every day
{
  const all = ['us', 'gb', 'de'].flatMap(c => ['a', 'b', 'c', 'd', 'e'].map(t => c + ':' + t))
  const days = [100, 101, 102].map(d => todaysSearches(all, 3, d, false))
  const seen = days.flat()
  check('rotation covers every term × storefront exactly once in 3 days', seen.length === all.length && new Set(seen).size === all.length)
  check('rotation touches every storefront every day', days.every(d => ['us', 'gb', 'de'].every(c => d.some(x => x.startsWith(c)))))
  check('baseline searches everything', todaysSearches(all, 3, 100, true).length === all.length)
  check('rotation 1 searches everything', todaysSearches(all, 1, 100, false).length === all.length)
}

// encryption
{
  const key = Buffer.alloc(32, 7), other = Buffer.alloc(32, 8)
  const box = seal('{"secret":"competitors"}', key)
  check('encrypted file does not contain the text', !box.toString('latin1').includes('competitors'))
  check('decrypts with the right key', open(box, key) === '{"secret":"competitors"}')
  let refused = false
  try { open(box, other) } catch { refused = true }
  check('a wrong key fails instead of returning garbage', refused)
}

// parallel jobs: every request in exactly one share; the plan is the same on every machine
{
  const jobs = Array.from({ length: 23 }, (_, i) => i)
  const shares = [0, 1, 2, 3, 4, 5].map(s => shareOf(jobs, s, 6).map(x => x.i))
  const all = shares.flat()
  check('6 shares cover every request exactly once', all.length === 23 && new Set(all).size === 23)
  const cat = { id: 'x', name: 'X', enabled: true, terms: ['a', 'b'], genres: [], strong: 'x', namePattern: '', descPattern: '', context: '', exclude: '' }
  const app = (id: number, countries: string[]) => ({ id, name: 'A' + id, developer: 'D', url: '', genre: '', firstSeen: '', lastSeen: '', countries, byCountry: {}, ratings: 0, rating: 0, growth: [] })
  const cs: CategoryState = { apps: { 5: app(5, ['us', 'gb']), 3: app(3, ['us']) }, events: [], runs: [] }
  const st = { countries: ['us', 'gb'], pricesTop: 0, pricesEveryDays: 7, searchRotationDays: 1 } as unknown as Settings
  const p1 = buildPlan([{ c: cat, cs }], { seen: {}, reviews: [] }, st, new Date('2026-11-20T08:00:00Z'), 20412)
  const p2 = buildPlan([{ c: cat, cs }], { seen: {}, reviews: [] }, st, new Date('2026-11-20T08:00:00Z'), 20412)
  check('the plan is identical on every machine', JSON.stringify(p1) === JSON.stringify(p2))
  check('plan: 4 searches + a lookup per storefront', p1.filter(j => j.kind === 'search').length === 4 &&
    JSON.stringify(p1.filter(j => j.kind === 'lookup')) === JSON.stringify([{ kind: 'lookup', cat: 'x', country: 'us', ids: [3, 5] }, { kind: 'lookup', cat: 'x', country: 'gb', ids: [5] }]))
}

// a lost parallel job must not turn its apps into removals
{
  const cat = { id: 'x', name: 'X', enabled: true, terms: ['a'], genres: [], strong: 'x', namePattern: '', descPattern: '', context: '', exclude: '' }
  const before = new Date('2026-11-20T04:00:00Z').toISOString()
  const app = (id: number) => ({ id, name: 'A' + id, developer: 'D' + id, url: '', genre: '', firstSeen: before, lastSeen: before, countries: ['us'],
    byCountry: { us: [10, 4] as [number, number] }, ratings: 10, rating: 4, growth: [], missing: 1, missingSince: before })
  const cs: CategoryState = { apps: { 1: app(1), 2: app(2) }, events: [], runs: [] }
  const jobs: Job[] = [{ kind: 'search', cat: 'x', country: 'us', term: 'a' }, { kind: 'lookup', cat: 'x', country: 'us', ids: [1] }, { kind: 'lookup', cat: 'x', country: 'us', ids: [2] }]
  // shard 0 answered (search ok, app 1 not returned by its lookup); shard 1 — the lookup of app 2 — never came back
  const hits = new Map<number, Hit>([[0, { i: 0, ok: true, apps: [] }], [1, { i: 1, ok: true, apps: [] }]])
  const { events } = applyCategory(cat, cs, jobs, hits, new Map<number, Listing>(), ['us'], new Date('2026-11-20T08:00:00Z'), d => Math.floor(d.getTime() / DAY), 1)
  check('app missing from a lookup that answered: removed', !!cs.apps[1].removedAt && events.some(e => e.kind === 'removed' && e.appId === 1))
  check('app whose lookup was lost: untouched, not removed', !cs.apps[2].removedAt && cs.apps[2].missing === 1)
  const found: StoreApp = { trackId: 2, trackName: 'A2', artistName: 'D2', trackViewUrl: 'u', userRatingCount: 12, averageUserRating: 4 }
  const cs2: CategoryState = { apps: { 2: app(2) }, events: [], runs: [] }
  applyCategory(cat, cs2, jobs, new Map<number, Hit>([[0, { i: 0, ok: true, apps: [] }], [2, { i: 2, ok: true, apps: [[2, 12, 4]] }]]),
    new Map<number, Listing>([[2, { country: 'us', app: found }]]), ['us'], new Date('2026-11-20T08:00:00Z'), d => Math.floor(d.getTime() / DAY), 1)
  check('app seen in another shard: missing count cleared', !cs2.apps[2].missing && cs2.apps[2].ratings === 12)
}

// prices
check('prices: $7.99, 7,99 €, 1,299.00, 1.299,00, ₽599', priceNumber('$7.99') === 7.99 && priceNumber('7,99 €') === 7.99 &&
  priceNumber('$1,299.00') === 1299 && priceNumber('1.299,00 ₽') === 1299 && priceNumber('₽599') === 599)
check('periods', period('Premium Monthly') === 'month' && period('12-Month Plan') === 'year' && period('1 Week - 7 Days Free Trial') === 'week' &&
  period('Lifetime') === 'lifetime' && period('Premium') === 'other' && period('3 Months') === 'quarter')
check('trial', isTrial('Weekly + 3 Day Free Trial') && !isTrial('Weekly'))
const html = '{"$kind":"Annotation","title":"In-App Purchases","summary":"Yes","items":[{"$kind":"textPair","leadingText":"Pro 1 Week","trailingText":"$7.99"},{"$kind":"textPair","leadingText":"Pro 1 Week","trailingText":"$7.99"},{"$kind":"textPair","leadingText":"Pro 1 Week","trailingText":"$4.99"},{"$kind":"textPair","leadingText":"Lifetime \\u0026 forever","trailingText":"$49.99"}]},{"$kind":"Annotation","title":"Size"}'
const parsed = parseInApp(html)
check('page block parsed, escapes decoded', parsed?.has === true && parsed.items.length === 4 && parsed.items[3].name === 'Lifetime & forever')
check('usual weekly price = most listed', plan(parsed?.items, 'week')?.price === 7.99)
check('unknown page = undefined', parseInApp('<html></html>') === undefined)

// reviews
const one = parseFeed({ feed: { entry: { id: { label: '9' }, 'im:rating': { label: '1' }, title: { label: 'Bad' }, content: { label: 'charged twice' }, author: { name: { label: 'Ann' } }, 'im:version': { label: '2.0' }, updated: { label: '2026-11-01T10:00:00-07:00' } } } })
check('feed: single review as an object', one.length === 1 && one[0].author === 'Ann')
check('reasons: 1★ + charged', reasons(1, 'Bad', 'charged twice', 2, 'charged, refund').join() === '1★,charged')
check('whole words: AI not in email', !hasWord('Fixed email', 'AI') && hasWord('New AI-powered scan', 'AI'))

// classifier on the real rules
{
  const cats = Object.fromEntries(categories().map(c => [c.id, new Classifier(c)]))
  const app = (trackName: string, primaryGenreName = 'Utilities', description = '') => ({ trackId: 1, trackName, artistName: '', trackViewUrl: '', primaryGenreName, description })
  check('cleaners: storage cleaner matches', cats.cleaners.matches(app('Cleaner Kit - Clean Up Storage')))
  check('cleaners: a game does not (genre)', !cats.cleaners.matches(app('Ocean Clean', 'Games')))
  check('vpn: VPN proxy matches', cats.vpn.matches(app('Turbo VPN Proxy', 'Utilities', 'fast vpn proxy')))
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
