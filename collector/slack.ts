// Slack incoming webhook: removals ("bans") per category, and the watched apps' removals and new bad reviews.
import type { App, Review, WatchEvent } from './model.ts'
import type { WatchNotice } from './watchers.ts'
import { log } from './util.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const n = (v: number) => v.toLocaleString('en-US')
const time = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** removal tags as the site shows them */
const tagsText = (s: string) => s
  .replace(/developer wiped \((\d+) apps\)/g, 'whole developer removed ($1 apps)')
  .replace(/sweep \((\d+) removed in 24h\)/g, 'removal wave: $1 in 24 h')

export async function post(text: string): Promise<void> {
  const hook = process.env.SLACK_WEBHOOK_URL
  if (!hook) {
    // run logs of a public repository are public: there only say a message was skipped
    log(process.env.CI ? 'slack: no SLACK_WEBHOOK_URL — message not sent' : 'slack: no SLACK_WEBHOOK_URL — message printed instead\n' + text)
    return
  }
  const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, unfurl_links: false }) })
  if (!r.ok) throw new Error(`Slack returned HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

/** One message per category with every removal of this run, biggest apps first. */
export function removalsText(category: string, events: WatchEvent[], apps: Record<string, App>, tz: string, site?: string): string | undefined {
  const removed = events.filter(e => e.kind === 'removed')
  if (!removed.length) return undefined
  const rows = removed
    .map(e => ({ e, a: apps[e.appId] }))
    .sort((x, y) => (y.a?.ratings ?? 0) - (x.a?.ratings ?? 0))
  const lines = rows.slice(0, 25).map(({ e, a }) => {
    const since = a?.missingSince ?? a?.lastSeen
    const window = since ? ` · gone between ${time(a?.lastSeen ?? since, tz)} and ${time(since, tz)}` : ''
    const where = e.countries?.length ? ` · ${e.countries.map(c => c.toUpperCase()).join(' ')}` : ''
    const tags = e.note ? `\n    ⚠️ ${esc(tagsText(e.note))}` : ''
    return `• <${e.url}|${esc(e.name)}> — ${esc(e.developer)} · ${n(a?.ratings ?? 0)} ratings${where}${window}${tags}`
  })
  const more = rows.length > 25 ? `\n…and ${rows.length - 25} more` : ''
  const link = site ? `\n<${site}|Open the dashboard>` : ''
  return `🚫 *${esc(category)}: removed from the App Store — ${removed.length}*\n${lines.join('\n')}${more}${link}`
}

export function reviewsText(items: { review: Review; app: string }[]): string[] {
  const out: string[] = []
  for (let i = 0; i < items.length; i += 10) {
    const part = items.slice(i, i + 10).map(({ review: r, app }) => {
      const stars = '★'.repeat(r.rating) + '☆'.repeat(Math.max(0, 5 - r.rating))
      const words = r.reasons.filter(x => !x.endsWith('★'))
      const asc = `https://appstoreconnect.apple.com/apps/${r.appId}/distribution/activity/ios/ratingsResponses`
      const store = `https://apps.apple.com/${r.country}/app/id${r.appId}?see-all=reviews`
      return `${stars} *${esc(app)}* · ${r.country.toUpperCase()} · v${esc(r.version)}\n` +
        (r.title ? `“${esc(r.title)}”\n` : '') + esc(r.text.slice(0, 600)) +
        (words.length ? `\n⚠️ ${esc(words.join(', '))}` : '') + `\n<${asc}|Reply in ASC> · <${store}|App Store>`
    })
    out.push(`💬 *New bad reviews: ${items.length}*\n\n` + part.join('\n\n'))
  }
  return out
}

/** The watched apps' removals: gone from the App Store, gone from some storefronts, back again. */
export function watchText(notices: WatchNotice[], tz: string, site?: string): string | undefined {
  if (!notices.length) return undefined
  const app = (x: WatchNotice) => `<https://apps.apple.com/app/id${x.app.id}|${esc(x.app.name)}>`
  const where = (l?: string[]) => (l ?? []).map(c => c.toUpperCase()).join(' ')
  const lines = notices.map(x =>
    x.kind === 'removed'
      ? `🚫 ${app(x)} — removed from the App Store` + (x.since ? ` · gone between ${time(x.lastSeen ?? x.since, tz)} and ${time(x.since, tz)}` : '')
      : x.kind === 'pulled'
        ? `🌍 ${app(x)} — no longer in ${where(x.countries)}`
        : `✅ ${app(x)} — back in the App Store${x.countries?.length ? ` · ${where(x.countries)}` : ''}`)
  const link = site ? `\n<${site.replace(/\/$/, '')}/#/all/watchers|Open the watch list>` : ''
  return `👀 *Watched apps*\n${lines.join('\n')}${link}`
}
