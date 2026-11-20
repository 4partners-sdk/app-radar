// `node collector/slacktest.ts` — sends one sample of each kind of Slack alert, marked TEST, through the same
// formatters the real alerts use: a bad review of a watched app, a removal wave in a category, a watched app
// removed from the App Store. Made-up apps, no data involved. Run by hand: Actions → slack-test.
// Without SLACK_WEBHOOK_URL (locally) the messages are printed instead.
import type { App, WatchEvent } from './model.ts'
import { post, removalsText, reviewsText, watchText } from './slack.ts'
import { settings } from './store.ts'

const s = settings()
const site = process.env.SITE_URL
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
const test = (text: string) => `🧪 *TEST — not a real alert*\n${text}`

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

// 2. a removal wave in a category: 6 removals in 24 h, three of them one developer's whole catalogue
const apps: Record<string, App> = {}
const events: WatchEvent[] = []
const removed = [
  ['Example Storage Cleaner', 'Example Studio Ltd', 18_400, true],
  ['Example Photo Cleaner', 'Example Studio Ltd', 7_200, true],
  ['Example Contacts Cleaner', 'Example Studio Ltd', 950, true],
  ['Example Phone Booster', 'Sample Apps LLC', 3_100, false],
  ['Example Junk Remover', 'Demo Soft', 410, false],
  ['Example Smart Clean', 'Test Mobile Inc', 35, false],
] as const
removed.forEach(([name, developer, ratings, wiped], i) => {
  const id = 1000000010 + i
  const url = `https://apps.apple.com/app/id${id}`
  apps[id] = {
    id, name, developer, url, genre: 'Utilities', firstSeen: ago(24 * 60), lastSeen: ago(26), missingSince: ago(5),
    countries: ['us', 'gb', 'de'], byCountry: {}, ratings, rating: 4.2, growth: [], removedAt: ago(1),
  }
  events.push({
    date: ago(1), kind: 'removed', appId: id, name, developer, url, countries: ['us', 'gb', 'de'],
    note: [...(wiped ? ['developer wiped (3 apps)'] : []), 'sweep (6 removed in 24h)'].join(' · '),
  })
})
const wave = removalsText('Cleaners', events, apps, s.timezone, site)

// 3. a watched app removed from the App Store
const watch = watchText([{ kind: 'removed', app: { id: 1000000001, name: 'Example Cleaner' }, lastSeen: ago(6), since: ago(3) }], s.timezone, site)

for (const text of [review, wave, watch]) await post(test(text!))
console.log('sent 3 test messages')
