// `node collector/slacktest.ts` — sends one sample of each kind of Slack alert, marked TEST, through the same
// formatters the real alerts use: a bad review of a watched app, the day's removals in the categories, a watched app
// removed from the App Store and one removed in some countries. Made-up apps, no data involved. The alarms show
// @channel as plain text, so a test doesn't wake everyone. Run by hand: Actions → slack-test.
// Without SLACK_WEBHOOK_URL (locally) the messages are printed instead.
import type { App, WatchEvent } from './model.ts'
import { type Message, post, removalsSummary, reviewsText, watchMessages } from './slack.ts'
import { settings } from './store.ts'

const s = settings()
const site = process.env.SITE_URL
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
const TEST = '🧪 *TEST — not a real alert*'
const test = (m: Message): Message => typeof m === 'string' ? `${TEST}\n${m}` : { ...m, text: `${TEST}\n${m.text}` }

// 1. a bad review of a watched app
const [review] = reviewsText([{
  app: 'Example Cleaner',
  review: {
    id: 'test-review', appId: 1000000001, country: 'us', rating: 1, version: '2.4.0', author: 'test', date: ago(2),
    title: 'Charged after I cancelled',
    text: 'Cancelled the trial on day two and was still charged $9.99. I want a refund, this is a scam.',
    reasons: ['1★', 'scam', 'refund', 'charged', 'cancel'],
  },
}])

// 2. the day's removals in the categories: counts and when
let id = 1000000010
const category = (name: string, count: number) => {
  const apps: Record<string, App> = {}
  const events: WatchEvent[] = []
  for (let i = 0; i < count; i++, id++) {
    apps[id] = { id, name: `Example ${name} app ${i + 1}`, developer: 'Example Ltd', url: '', genre: 'Utilities', firstSeen: ago(900),
      lastSeen: ago(24), missingSince: ago(1), countries: ['us'], byCountry: {}, ratings: 0, rating: 0, growth: [], removedAt: ago(1) }
    events.push({ date: ago(1), kind: 'removed', appId: id, name: apps[id].name, developer: 'Example Ltd', url: '' })
  }
  return { category: name, events, apps }
}
const removals = removalsSummary([category('Cleaners', 2), category('VPN', 7), category('Security', 3)], s.timezone, site, 'cleaners')

// 3–4. a watched app removed from the App Store, another removed in some countries — the loud ones
const alarms = watchMessages([
  { kind: 'removed', app: { id: 1000000001, name: 'Example Cleaner' }, countries: ['us', 'gb', 'de'], lastSeen: ago(6), since: ago(3) },
  { kind: 'pulled', app: { id: 1000000002, name: 'Example VPN' }, countries: ['ru'], live: ['us', 'gb', 'de'] },
], s.timezone, site, '`@channel` ')

for (const m of [review, removals!, ...alarms]) await post(test(m))
console.log(`sent ${2 + alarms.length} test messages`)
