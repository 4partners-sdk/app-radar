// Reviews of favorite apps from the public RSS feed. A storefront's first read only remembers what is
// there; after that every new bad review is reported.
import type { GlobalState, Review, Settings } from './model.ts'
import { reviewFeed } from './api.ts'
import { log, wordsIn } from './util.ts'

interface RawReview { id: string; title: string; text: string; version: string; author: string; rating: number; date: string }

/** The feed's `entry` is an array, a single object when there is one review, or missing when there are none. */
export function parseFeed(data: unknown): RawReview[] {
  const feed = (data as { feed?: { entry?: unknown } })?.feed
  if (!feed) return []
  const entries = (Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : []) as Record<string, unknown>[]
  const label = (e: Record<string, unknown>, k: string) => ((e[k] as { label?: string } | undefined)?.label ?? '')
  const out: RawReview[] = []
  for (const e of entries) {
    const rating = Number(label(e, 'im:rating'))
    if (!rating) continue // the app's own entry has no rating
    const author = ((e.author as { name?: { label?: string } } | undefined)?.name?.label) ?? ''
    const d = Date.parse(label(e, 'updated'))
    out.push({ id: label(e, 'id'), title: label(e, 'title'), text: label(e, 'content'), version: label(e, 'im:version'), author, rating,
      date: new Date(Number.isNaN(d) ? Date.now() : d).toISOString() })
  }
  return out
}

/** "1★" for low ratings, plus every alarm word in the title or text */
export function reasons(rating: number, title: string, text: string, maxStars: number, words: string): string[] {
  const r = rating <= maxStars ? [`${rating}★`] : []
  return [...r, ...wordsIn(title + '\n' + text, words)]
}

/**
 * The feed publishes some reviews days after their date (moderation). Those are stored and shown, but only
 * reviews from the last few days are sent to Slack — a week-old review is not news.
 */
export const ALERT_DAYS = 3

/** Reads every favorite in every storefront; returns the new bad reviews (not from a first read, not stale). */
export async function readReviews(g: GlobalState, s: Settings): Promise<{ review: Review; app: string }[]> {
  const fresh: { review: Review; app: string }[] = []
  const alertFrom = new Date(Date.now() - ALERT_DAYS * 86_400_000).toISOString()
  const known = new Set(g.reviews.map(r => r.id))
  for (const fav of s.favorites) {
    const seen = (g.seen[fav.id] ??= {})
    for (const c of s.countries) {
      let raw: RawReview[]
      try { raw = parseFeed(await reviewFeed(fav.id, c)) } catch (e) { log(`reviews ${fav.id} ${c}: ${(e as Error).message}`); continue }
      const firstRead = !seen[c]
      const ids = new Set(seen[c] ?? [])
      for (const r of raw) {
        if (!r.id || ids.has(r.id) || known.has(r.id)) continue
        const review: Review = { ...r, appId: fav.id, country: c, reasons: reasons(r.rating, r.title, r.text, s.reviewMaxStars, s.reviewWords) }
        if (firstRead) review.baseline = true
        g.reviews.push(review)
        known.add(r.id)
        if (!firstRead && review.reasons.length && review.date >= alertFrom) fresh.push({ review, app: fav.name })
      }
      seen[c] = [...new Set([...raw.map(r => r.id), ...(seen[c] ?? [])])].slice(0, 300)
    }
  }
  g.reviews.sort((a, b) => (a.date < b.date ? 1 : -1))
  log(`reviews: ${g.reviews.length} stored, ${fresh.length} new bad`)
  return fresh
}
