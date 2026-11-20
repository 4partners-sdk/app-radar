import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import './style.css'
import { useData, type Index } from './data.ts'
import { ago, dateTime, setTimezone } from './format.ts'
import { Overview } from './views/Overview.tsx'
import { Events } from './views/Events.tsx'
import { Apps } from './views/Apps.tsx'
import { AppCard } from './views/AppCard.tsx'
import { Removals } from './views/Removals.tsx'
import { Insights } from './views/Insights.tsx'
import { Prices } from './views/Prices.tsx'
import { Watchers } from './views/Watchers.tsx'
import { Refresh } from './refresh.tsx'

export interface Ctx {
  index: Index
  cat: string
  open: (id: number) => void
  go: (tab: string, query?: string) => void
  query: string
}

const TABS: [string, string][] = [
  ['overview', 'Overview'], ['events', 'Events'], ['apps', 'Apps'], ['removals', 'Removals'],
  ['insights', 'Insights'], ['prices', 'Prices'], ['watchers', 'Watchers'],
]

interface Route { cat?: string; tab: string; query: string; app?: number }

function parse(): Route {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?')
  const [cat, tab = 'overview', a, id] = path.split('/')
  return { cat: cat || undefined, tab, query, app: a === 'app' && id ? Number(id) : undefined }
}

function App() {
  const { data: index, error } = useData<Index>('index.json')
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  if (error) return <main><div class="warn">Couldn't load the data: {error}</div></main>
  if (!index) return <main class="dim">Loading…</main>
  setTimezone(index.timezone)
  const cats = index.categories.filter(c => c.enabled)
  const cat = cats.find(c => c.id === route.cat)?.id ?? cats[0]?.id
  const href = (tab: string, c = cat, extra = '') => `#/${c}/${tab}${extra}`
  const ctx: Ctx = {
    index, cat, query: route.query,
    open: id => { location.hash = href(route.tab, cat, `/app/${id}`) + (route.query ? `?${route.query}` : '') },
    go: (tab, query) => { location.hash = href(tab) + (query ? `?${query}` : '') },
  }
  const close = () => { location.hash = href(route.tab) + (route.query ? `?${route.query}` : '') }
  const stale = !index.lastDaily || Date.now() - Date.parse(index.lastDaily) > 30 * 3_600_000
  const view = (() => {
    switch (route.tab) {
      case 'events': return <Events {...ctx} />
      case 'apps': return <Apps {...ctx} />
      case 'removals': return <Removals {...ctx} />
      case 'insights': return <Insights {...ctx} />
      case 'prices': return <Prices {...ctx} />
      // 'reviews' is the old name of the tab: links to it still work
      case 'watchers': case 'reviews': return <Watchers {...ctx} />
      default: return <Overview {...ctx} />
    }
  })()
  return (
    <>
      <header class="top">
        <div class="top-in">
          <div class="brand"><i />App Radar</div>
          <select class="select" value={cat} onChange={e => { location.hash = href(route.tab === 'watchers' || route.tab === 'reviews' ? 'overview' : route.tab, (e.target as HTMLSelectElement).value) }}>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name} · {c.active.toLocaleString('en-US')}</option>)}
          </select>
          <nav class="tabs">
            {TABS.map(([id, label]) => <a key={id} class={`tab ${route.tab === id || (id === 'watchers' && route.tab === 'reviews') ? 'on' : ''}`} href={href(id)}>{label}</a>)}
          </nav>
          <div class="status">
            Last check: <b>{dateTime(index.lastDaily)}</b> ({ago(index.lastDaily)})<br />
            Next around {String(index.dailyHour).padStart(2, '0')}:00 · keeps {index.retentionDays} days
          </div>
          <Refresh generatedAt={index.generatedAt} />
        </div>
      </header>
      <main>
        {stale && <div class="warn">No new data for over a day — check the collector in GitHub Actions.</div>}
        {view}
      </main>
      {route.app && <AppCard {...ctx} id={route.app} onClose={close} />}
    </>
  )
}

render(<App />, document.getElementById('app')!)

// a tab left open all day picks up the next check: reload once the collector has published new data
let seenGeneratedAt: string | undefined
setInterval(async () => {
  try {
    const r = await fetch('data/index.json', { cache: 'no-cache' })
    if (!r.ok) return
    const at = ((await r.json()) as Index).generatedAt
    if (seenGeneratedAt && at !== seenGeneratedAt) location.reload()
    seenGeneratedAt = at
  } catch { /* offline or signed out — try again later */ }
}, 10 * 60_000)
fetch('data/index.json', { cache: 'no-cache' }).then(r => r.json()).then((x: Index) => { seenGeneratedAt = x.generatedAt }, () => {})
