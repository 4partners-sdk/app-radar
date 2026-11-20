// Entry point. `node collector/main.ts <mode>`:
//   auto      run what is due now (locally): the daily check after 09:00 local, the recheck a few hours later
//   due [mode]  decide what is due and only report it (GitHub Actions output `mode`, `run_at`, `shards`)
//   daily     full check of every enabled category on this machine (+ weekly prices, reviews, Slack)
//   fetch <shard> <shards>   one parallel job's share of the daily check's requests → out/shard-<n>.bin
//   merge <dir>              the rest of the daily check from all shards' results: diff, save, Slack
//   recheck   lookups for apps that missed the last check (+ reviews, Slack)
//   prices    read subscription prices now
//   reviews   read the watched apps now: removals and bad reviews (also due every few hours on its own)
//   publish   rebuild the dashboard files from the current state
//   remeasure forget release measurements and boost events, measure every release again
//   seed <state.json>   import the Mac app's data (only into an empty data folder)
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Category, CategoryState, GlobalState, Settings, WatchEvent, WatchedApp } from './model.ts'
import { IMPACT_DAYS, eventOf, measureVersions } from './app.ts'
import { applyCategory, recheckCategory } from './check.ts'
import { dataKey, isSealed, open, seal } from './crypto.ts'
import { type Job, type ShardResult, applyPrices, buildPlan, mergeResults, runJobs } from './plan.ts'
import { scanPrices } from './prices.ts'
import { publish } from './publish.ts'
import { readReviews } from './reviews.ts'
import { seed } from './seed.ts'
import { post, removalsText, reviewsText, watchText } from './slack.ts'
import { DATA, categories, loadCategory, loadGlobal, prune, pruneGlobal, saveCategory, saveGlobal, settings } from './store.ts'
import { DAY, HOUR, dayNumber, localHour, log } from './util.ts'
import { checkWatched, loadWatchList } from './watchers.ts'
import { due } from './schedule.ts'

const s: Settings = settings()
const day = (d: Date) => dayNumber(d, s.timezone)
const site = process.env.SITE_URL

function output(key: string, value: string) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
}

async function notify(texts: (string | undefined)[]) {
  for (const t of texts) {
    if (!t) continue
    try { await post(t) } catch (e) { console.error('slack:', (e as Error).message); process.exitCode = 1 }
  }
}

function loadAll(): { c: Category; cs: CategoryState }[] {
  return categories().map(c => ({ c, cs: loadCategory(c.id) }))
}

function saveAll(cats: { c: Category; cs: CategoryState }[], g: GlobalState, now: Date) {
  for (const { c, cs } of cats) { prune(cs, s.retentionDays, now, day(now)); saveCategory(c.id, cs) }
  pruneGlobal(g, s.retentionDays, now)
  saveGlobal(g)
  publish(cats, g, s, day(now))
}

/** The watch list, or undefined when it can't be read (the run goes on without it). */
async function watchList(): Promise<WatchedApp[] | undefined> {
  try {
    return await loadWatchList()
  } catch (e) {
    log(`watch list: ${(e as Error).message}`)
    return undefined
  }
}

/** The watched apps: removals and new bad reviews, as Slack messages. */
async function watchersStep(g: GlobalState, now: Date): Promise<string[]> {
  const list = await watchList()
  if (!list) return ['⚠️ *App Radar: couldn\'t read the watch list* — removals and reviews of the watched apps were not checked this time.']
  g.watchers = list
  g.lastReviews = now.toISOString()
  const notices = await checkWatched(list, g, s.countries, now)
  // names as the App Store lists them: an app added while Apple didn't answer the site has a placeholder
  const named = (a: WatchedApp) => ({ ...a, name: g.watch?.[a.id]?.name ?? a.name })
  for (const x of notices) x.app = named(x.app)
  const texts = [watchText(notices, s.timezone, site), ...reviewsText(await readReviews(g, s, list.map(named)))]
  return texts.filter((t): t is string => !!t)
}

/** RUN_AT: the moment the run started — every parallel job and the merge plan and date things from it */
const runAt = () => (process.env.RUN_AT ? new Date(process.env.RUN_AT) : new Date())

/** Turns the plan's results into events and saves them; the part of the daily check after the network. */
async function finishDaily(cats: { c: Category; cs: CategoryState }[], g: GlobalState, jobs: Job[], results: ShardResult[], now: Date) {
  const { hits, listings } = mergeResults(results)
  const duration = (Date.now() - now.getTime()) / 1000
  const alerts: (string | undefined)[] = []
  const failures: string[] = []
  let ok = 0
  for (const x of cats) {
    if (!x.c.enabled) continue
    const { run, events } = applyCategory(x.c, x.cs, jobs, hits, listings, s.countries, now, day, duration)
    if (run.failed) { failures.push(`${x.c.name}: ${run.error}`); continue }
    ok++
    log(`${x.c.name}: ${run.active} active`, run.counts, run.error ?? '')
    if (!run.baseline) alerts.push(removalsText(x.c.name, events, x.cs.apps, s.timezone, site))
  }
  if (ok) g.lastDaily = now.toISOString()
  const prices = applyPrices(cats, jobs, hits, now)
  if (prices.total) log(`prices: ${prices.read} of ${prices.total} pages read`)
  if (prices.read) g.lastPrices = now.toISOString()
  // state first: a crash in the slower steps below must not lose the check
  saveAll(cats, g, now)
  alerts.push(...(await watchersStep(g, now)))
  saveAll(cats, g, now)
  if (failures.length) alerts.push(`⚠️ *App Radar: the check failed*\n${failures.join('\n')}`)
  await notify(alerts)
}

async function daily() {
  const now = runAt()
  const cats = loadAll()
  const g = loadGlobal()
  const jobs = buildPlan(cats, g, s, now, day(now))
  const result = await runJobs(jobs, 0, 1, cats.map(x => x.c))
  await finishDaily(cats, g, jobs, [result], now)
}

async function fetchShard(shard: number, shards: number) {
  // check the key before spending minutes on requests whose results couldn't be stored
  const key = dataKey()
  const now = runAt()
  const cats = loadAll()
  const jobs = buildPlan(cats, loadGlobal(), s, now, day(now))
  const result = await runJobs(jobs, shard, shards, cats.map(x => x.c))
  mkdirSync('out', { recursive: true })
  // results go through Actions artifacts, which anyone can download from a public repository
  const text = JSON.stringify(result)
  writeFileSync(join('out', `shard-${shard}.bin`), key ? seal(text, key) : Buffer.from(text))
}

async function merge(dir: string) {
  const key = dataKey()
  const now = runAt()
  const cats = loadAll()
  const g = loadGlobal()
  const jobs = buildPlan(cats, g, s, now, day(now))
  const results: ShardResult[] = []
  for (const f of existsSync(dir) ? readdirSync(dir).filter(f => /^shard-\d+\.bin$/.test(f)) : []) {
    const raw = readFileSync(join(dir, f))
    const r = JSON.parse(isSealed(raw) ? open(raw, key ?? Buffer.alloc(0)) : raw.toString('utf8')) as ShardResult
    // the shards planned from the same data and moment; a different plan means their results don't line up
    if (r.jobs !== jobs.length) throw new Error(`${f} was planned with ${r.jobs} requests, this merge has ${jobs.length}`)
    results.push(r)
  }
  const shards = results[0]?.shards ?? 0
  const missing = Array.from({ length: shards }, (_, i) => i).filter(i => !results.some(r => r.shard === i))
  log(`merge: ${results.length} of ${shards || '?'} shards${missing.length ? `, missing ${missing.join(', ')} (their apps count as not checked)` : ''}`)
  await finishDaily(cats, g, jobs, results, now)
}

async function recheck() {
  const now = new Date()
  const cats = loadAll()
  const g = loadGlobal()
  const alerts: (string | undefined)[] = []
  for (const x of cats) {
    if (!x.c.enabled) continue
    const { events } = await recheckCategory(x.c, x.cs, s.countries, now)
    alerts.push(removalsText(x.c.name, events, x.cs.apps, s.timezone, site))
  }
  g.lastRecheck = now.toISOString()
  alerts.push(...(await watchersStep(g, now)))
  saveAll(cats, g, now)
  await notify(alerts)
}

async function reviews() {
  const now = new Date()
  const cats = loadAll()
  const g = loadGlobal()
  const alerts = await watchersStep(g, now)
  // state first: a Slack hiccup must not make the next run report the same things again
  saveAll(cats, g, now)
  await notify(alerts)
}

const [mode = 'auto', arg, arg2] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const started = Date.now()
switch (mode) {
  case 'auto': {
    const what = due(new Date(), loadGlobal(), s, await watchList())
    output('ran', what ?? 'none')
    if (what === 'daily') await daily()
    else if (what === 'recheck') await recheck()
    else if (what === 'reviews') await reviews()
    else log('nothing due')
    break
  }
  case 'due': {
    // GitHub Actions: decide once, then the fetch jobs and the merge all work from the same moment
    const asked = arg ?? 'auto'
    const what = asked === 'auto' ? due(new Date(), loadGlobal(), s, await watchList()) ?? 'none' : asked
    const n = Math.max(1, s.parallelJobs ?? 1)
    output('mode', what)
    output('run_at', new Date().toISOString())
    output('shards', JSON.stringify(Array.from({ length: n }, (_, i) => i)))
    output('shard_count', String(n))
    console.log(`due: ${what}${what === 'daily' ? ` on ${n} parallel jobs` : ''}`)
    break
  }
  case 'daily': output('ran', 'daily'); await daily(); break
  case 'fetch': await fetchShard(Number(arg), Number(arg2)); break
  case 'merge': await merge(arg ?? 'out'); break
  case 'recheck': output('ran', 'recheck'); await recheck(); break
  case 'prices': {
    const now = new Date(), cats = loadAll(), g = loadGlobal()
    const r = await scanPrices(cats.filter(x => x.c.enabled), s.pricesTop, s.countries, arg === 'force' ? 0 : s.pricesEveryDays, now)
    console.log(`prices: ${r.read} of ${r.total} pages read`)
    if (r.read) g.lastPrices = now.toISOString()
    saveAll(cats, g, now)
    break
  }
  case 'reviews': output('ran', 'reviews'); await reviews(); break
  case 'publish': {
    const now = new Date(), cats = loadAll(), g = loadGlobal()
    publish(cats, g, s, day(now))
    break
  }
  case 'remeasure': {
    // after a change to how releases are measured: forget every measurement and boost event, measure again
    const now = new Date(), cats = loadAll(), g = loadGlobal()
    for (const { c, cs } of cats) {
      cs.events = cs.events.filter(e => e.kind !== 'boosted')
      const added: WatchEvent[] = []
      for (const t of Object.values(cs.apps)) {
        for (const v of t.versions ?? []) { delete v.before; delete v.after; delete v.measured }
        if (t.removedAt) continue
        for (const b of measureVersions(t, now, day)) {
          // dated when the after-window closed, which is when a daily check would have reported it
          const at = new Date(Math.min(now.getTime(), Date.parse(b.version.date) + IMPACT_DAYS * DAY)).toISOString()
          added.push(eventOf('boosted', t, at, [], b.note))
        }
      }
      cs.events = [...cs.events, ...added].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      for (const r of cs.runs) {
        const next = cs.runs.find(x => x.date > r.date)?.date ?? '9999'
        const n = added.filter(e => e.date >= r.date && e.date < next).length
        if (n) r.counts.boosted = n
        else delete r.counts.boosted
      }
      console.log(`${c.id}: ${added.length} boosts`)
    }
    saveAll(cats, g, now)
    break
  }
  case 'seed': {
    if (!arg) throw new Error('usage: seed <path to the Mac app state.json>')
    if (existsSync(join(DATA, 'state', 'global.json')) || existsSync(join(DATA, 'state', 'global.json.enc'))) throw new Error(`${DATA}/state already has data — seed only fills an empty folder`)
    const now = new Date()
    const { cats, g } = seed(arg, s, day, now)
    const list = categories().map(c => ({ c, cs: cats[c.id] ?? { apps: {}, events: [], runs: [] } }))
    saveAll(list, g, now)
    for (const { c, cs } of list) console.log(`${c.id}: ${Object.keys(cs.apps).length} apps, ${cs.events.length} events`)
    console.log(`reviews: ${g.reviews.length}`)
    break
  }
  default:
    throw new Error(`unknown mode "${mode}"`)
}
log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s`)
export type { WatchEvent }
