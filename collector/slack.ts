// Slack incoming webhook: removals ("bans") per category, and the watched apps' removals and new bad reviews.
import type { App, Review, WatchEvent } from './model.ts'
import type { WatchNotice } from './watchers.ts'
import { log } from './util.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const n = (v: number) => v.toLocaleString('en-US')
const time = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** A Slack message. With `details`, those go in a coloured block under `text` (mentions only work in `text`). */
export type Message = string | { text: string; details?: string; color?: string }

const RED = '#E01E5A', AMBER = '#F2A100', GREEN = '#2EB67D'

export async function post(message: Message): Promise<void> {
  const m = typeof message === 'string' ? { text: message } : message
  const hook = process.env.SLACK_WEBHOOK_URL
  if (!hook) {
    // run logs of a public repository are public: there only say a message was skipped
    log(process.env.CI ? 'slack: no SLACK_WEBHOOK_URL — message not sent'
      : 'slack: no SLACK_WEBHOOK_URL — message printed instead\n' + m.text + (m.details ? `\n┃ ${m.details.replace(/\n/g, '\n┃ ')}` : ''))
    return
  }
  const body = {
    text: m.text, unfurl_links: false,
    ...(m.details ? { attachments: [{ color: m.color, text: m.details, mrkdwn_in: ['text'] }] } : {}),
  }
  const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`Slack returned HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

/** from–to as one short text: "22 Nov, 09:10–12:50" or "21 Nov, 13:20 – 22 Nov, 12:50" */
function span(from: string, to: string, tz: string): string {
  const a = time(from, tz), b = time(to, tz)
  if (a === b) return a
  const day = (x: string) => x.slice(0, x.lastIndexOf(','))
  return day(a) === day(b) ? `${a}–${b.slice(b.lastIndexOf(',') + 2)}` : `${a} – ${b}`
}

/**
 * One short message for a run's removals in every category: how many apps each lost and when (between the last
 * check that saw them and the first that didn't). Which apps they were is on the site's Removals tab.
 */
export function removalsSummary(rows: { category: string; events: WatchEvent[]; apps: Record<string, App> }[], tz: string, site?: string, catId?: string): string | undefined {
  const lines: string[] = []
  let total = 0
  for (const { category, events, apps } of rows) {
    const removed = events.filter(e => e.kind === 'removed')
    if (!removed.length) continue
    total += removed.length
    const seen = removed.map(e => apps[e.appId]?.lastSeen).filter((x): x is string => !!x).sort()
    const gone = removed.map(e => apps[e.appId]?.missingSince ?? apps[e.appId]?.lastSeen).filter((x): x is string => !!x).sort()
    const when = seen.length && gone.length ? ` · gone between ${span(seen[0], gone.at(-1)!, tz)}` : ''
    lines.push(`• *${esc(category)}* — ${n(removed.length)} ${removed.length === 1 ? 'app' : 'apps'}${when}`)
  }
  if (!total) return undefined
  const link = site ? `\n<${site.replace(/\/$/, '')}/#/${catId ?? 'all'}/removals|See which apps>` : ''
  return `🚫 *Removed from the App Store: ${n(total)} ${total === 1 ? 'app' : 'apps'}*\n${lines.join('\n')}${link}`
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

/** who a watched app's ban pings: settings.watchAlarm — "channel" (everyone in it), "here" (whoever is online), "" (nobody) */
export function mentionOf(setting: string | undefined): string {
  return setting === 'here' ? '<!here> ' : setting === '' || setting === 'none' ? '' : '<!channel> '
}

/**
 * The watched apps' removals, one message each so none drowns in a batch. A removal — from the whole App Store
 * or from some storefronts — is an alarm that pings the channel; coming back is good news and doesn't.
 */
export function watchMessages(notices: WatchNotice[], tz: string, site?: string, mention = '<!channel> '): Message[] {
  const list = site ? `\n<${site.replace(/\/$/, '')}/#/all/watchers|Open the watch list>` : ''
  const where = (l?: string[]) => (l ?? []).map(c => c.toUpperCase()).join(' ')
  return notices.map(x => {
    const name = esc(x.app.name)
    const app = `<https://apps.apple.com/app/id${x.app.id}|${name}>`
    if (x.kind === 'removed') {
      return {
        text: `${mention}🚨🚨🚨 *WATCHED APP REMOVED FROM THE APP STORE: ${name}*`,
        details: `${app} is gone from every storefront it was live in` + (x.countries?.length ? ` (${where(x.countries)})` : '') +
          (x.since ? `\nGone between ${span(x.lastSeen ?? x.since, x.since, tz)}` : '') +
          `\nConfirmed by two checks in a row — check App Store Connect for a message from Apple.${list}`,
        color: RED,
      }
    }
    if (x.kind === 'pulled') {
      return {
        text: `${mention}🚨 *WATCHED APP REMOVED IN ${where(x.countries)}: ${name}*`,
        details: `${app} is no longer in ${where(x.countries)}` + (x.live?.length ? `, still live in ${where(x.live)}` : '') +
          `.\nConfirmed by two checks in a row.${list}`,
        color: AMBER,
      }
    }
    return { text: `✅ *Watched app back in the App Store: ${name}*`, details: `${app} is live again` + (x.countries?.length ? ` in ${where(x.countries)}` : '') + `.${list}`, color: GREEN }
  })
}
