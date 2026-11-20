// iTunes Search / Lookup, App Store pages and review feeds — all public, no key.
import type { StoreApp } from './model.ts'
import { log } from './util.ts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Spaces requests evenly. Apple answers 429/403 after ~100 requests at 2/s; at 1/s a run normally never trips it.
 * A throttle pauses everything for a minute and slows the pace for the rest of the run: speeding back up only
 * runs into the same wall again (measured: a 429 wave every ~3 minutes when the pace recovered).
 */
export class RateGate {
  static pause = 60_000
  static maxInterval = 4000
  private interval: number
  private next = 0
  private pausedAt = 0
  throttles = 0
  readonly steady: number
  constructor(steady: number) { this.steady = steady; this.interval = steady }

  get slowed() { return this.interval > this.steady }

  async wait() {
    const now = Date.now()
    const at = Math.max(now, this.next)
    this.next = at + this.interval
    if (at > now) await sleep(at - now)
  }

  succeeded() {}

  throttled() {
    this.throttles++
    const now = Date.now()
    // workers already in flight get the same answer: a wave of them is one throttle
    if (now - this.pausedAt < RateGate.pause) return
    this.pausedAt = now
    this.interval = Math.min(Math.round(this.interval * 1.5), RateGate.maxInterval)
    this.next = Math.max(this.next, now + RateGate.pause)
    log(`throttled — pausing ${RateGate.pause / 1000} s, then one request per ${(this.interval / 1000).toFixed(2)} s`)
  }
}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number) { super(`App Store returned HTTP ${status}`); this.status = status }
}

const RETRY = new Set([403, 429, 500, 502, 503, 504])

export async function send(url: string, gate: RateGate, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    await gate.wait()
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
      if (r.ok) { gate.succeeded(); return r }
      last = new HttpError(r.status)
      // the logs are public: no query, and no app ids (review feeds carry the watched app's id in the path)
      log(`HTTP ${r.status} (attempt ${i + 1}) ${url.split('?')[0].replace(/\d{5,}/g, '…')}`)
      if (!RETRY.has(r.status)) throw last
      gate.throttled()
    } catch (e) {
      if (e instanceof HttpError && !RETRY.has(e.status)) throw e
      last = e
    }
  }
  throw last
}

/** the Search / Lookup API: ~1000 requests a day at 1/s take about 17 minutes. API_INTERVAL_MS overrides. */
export const apiGate = new RateGate(Number(process.env.API_INTERVAL_MS) || 1000)
/** App Store web pages are much heavier than an API call */
export const pageGate = new RateGate(1100)

export const LOOKUP_BATCH = 150

export async function search(term: string, country: string): Promise<StoreApp[]> {
  const q = new URLSearchParams({ term, entity: 'software', limit: '200', country })
  const r = await send(`https://itunes.apple.com/search?${q}`, apiGate)
  return ((await r.json()) as { results: StoreApp[] }).results
}

export async function lookup(ids: number[], country: string): Promise<StoreApp[]> {
  const q = new URLSearchParams({ id: ids.join(','), entity: 'software', country })
  const r = await send(`https://itunes.apple.com/lookup?${q}`, apiGate)
  return ((await r.json()) as { results: StoreApp[] }).results.filter(a => a.trackId && a.trackName)
}

/** The public App Store page of an app — not an API, Apple can change the format. */
export async function page(id: number, country: string): Promise<string> {
  const r = await send(`https://apps.apple.com/${country}/app/id${id}`, pageGate, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  return r.text()
}

/** Up to 50 most recent reviews of an app in one storefront (public RSS). */
export async function reviewFeed(id: number, country: string): Promise<unknown> {
  const r = await send(`https://itunes.apple.com/${country}/rss/customerreviews/page=1/id=${id}/sortby=mostrecent/json`, apiGate)
  return r.json()
}
