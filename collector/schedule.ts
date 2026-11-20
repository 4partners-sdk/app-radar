// What the hourly schedule should do right now (`main.ts due` / `auto`).
import type { GlobalState, Settings, WatchedApp } from './model.ts'
import { HOUR, dayNumber, localHour } from './util.ts'

export type Due = 'daily' | 'recheck' | 'reviews'

/**
 * The daily check after the daily hour, the removal recheck a few hours later, and in between the watched apps
 * every few hours. The daily check and the recheck read the watched apps too.
 */
export function due(now: Date, g: GlobalState, s: Settings, list: WatchedApp[] = []): Due | undefined {
  const day = (d: Date) => dayNumber(d, s.timezone)
  const dailyToday = !!g.lastDaily && day(new Date(g.lastDaily)) === day(now)
  if (!dailyToday && localHour(now, s.timezone) >= s.dailyHour) return 'daily'
  if (dailyToday) {
    const recheckedToday = !!g.lastRecheck && g.lastRecheck > g.lastDaily!
    if (!recheckedToday && now.getTime() - Date.parse(g.lastDaily!) >= s.recheckAfterHours * HOUR) return 'recheck'
  }
  if (!list.length) return undefined
  // an app added on the site gets its first check with the next hourly run
  if (list.some(a => !g.watch?.[a.id]?.checkedAt)) return 'reviews'
  // a few minutes' slack: the hourly runs start at :05 give or take, and "every 3 h" must not slip to 4
  const every = (s.watchEveryHours ?? 3) * HOUR - 10 * 60_000
  return !g.lastReviews || now.getTime() - Date.parse(g.lastReviews) >= every ? 'reviews' : undefined
}
