import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Ctx } from '../main.tsx'
import { useData, type Review, type WatchRow } from '../data.ts'
import { ago, date, dateTime, n } from '../format.ts'
import { Card, Empty, Seg } from '../ui.tsx'
import { addApp, readWatchList, removeApp, type WatchList, type WatchedApp } from '../watch-api.ts'

const WEEK = 7 * 86_400_000

/** an app on the list, with what the last check found (absent until its first check) */
interface Item extends WatchedApp { row?: WatchRow }

const store = (id: number) => `https://apps.apple.com/app/id${id}`

function status(row: WatchRow | undefined, storefronts: number): [kind: string, text: string] {
  if (!row?.checkedAt) return ['k-updated', 'First check pending']
  if (row.removedAt) return ['k-removed', `Removed from the App Store · ${dateTime(row.removedAt)}`]
  if (row.missingSince) return ['k-pulled', `Missing since ${dateTime(row.missingSince)}`]
  if (!row.countries.length) return ['k-updated', 'Not in the watched storefronts']
  return ['k-returned', `Live in ${row.countries.length} of ${storefronts} storefronts`]
}

export function Watchers(ctx: Ctx) {
  const { data: reviews } = useData<Review[]>('reviews.json')
  const [live, setLive] = useState<WatchList>()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<number | 'add'>()
  const [note, setNote] = useState<{ text: string; bad?: boolean }>()
  const [app, setApp] = useState(0)
  const [bad, setBad] = useState<'bad' | 'all'>('bad')
  const [cc, setCc] = useState('')
  const [limit, setLimit] = useState(200)

  useEffect(() => {
    readWatchList().then(setLive, e => setLive({ configured: false, error: String((e as Error).message ?? e) }))
  }, [])

  const published = ctx.index.watchers ?? []
  const editable = !!live?.configured && !live.error && !!live.apps
  // the live list decides what is on it; the last check adds where each app is and its current name
  const items: Item[] = (editable ? live!.apps! : published).map(a => {
    const row = published.find(p => p.id === a.id)
    return { ...a, name: row?.name ?? a.name, developer: row?.developer ?? a.developer, icon: row?.icon ?? a.icon, row }
  })
  const ids = new Set(items.map(a => a.id))
  const name = (id: number) => items.find(a => a.id === id)?.name ?? String(id)

  const mine = useMemo(() => (reviews ?? []).filter(r => ids.has(r.appId)), [reviews, items.map(a => a.id).join()])
  const list = useMemo(() => mine.filter(r =>
    (!app || r.appId === app) && (bad === 'all' || r.reasons.length) && (!cc || r.country === cc)), [mine, app, bad, cc])
  const countries = [...new Set(mine.map(r => r.country))].sort()

  const answer = (r: WatchList, ok?: string) => {
    if (r.apps) setLive({ configured: true, apps: r.apps })
    setNote(r.error ? { text: r.error, bad: true } : ok ? { text: ok } : undefined)
  }

  const add = async (e: Event) => {
    e.preventDefault()
    const what = input.trim()
    if (!what || busy) return
    setBusy('add')
    setNote(undefined)
    try {
      const r = await addApp(what)
      if (!r.error) setInput('')
      const name = r.unverified ? ' The App Store didn\'t answer just now, so its name and icon show after that check.' : ''
      answer(r, (r.started
        ? 'Added. Its first check is running — this page updates by itself in a few minutes.'
        : 'Added. Its first check comes with the next run, within the hour.') + name)
    } catch (err) {
      setNote({ text: (err as Error).message, bad: true })
    }
    setBusy(undefined)
  }

  const remove = async (a: Item) => {
    if (busy || !confirm(`Stop watching ${a.name}? Its reviews and removals will no longer go to Slack.`)) return
    setBusy(a.id)
    setNote(undefined)
    try {
      answer(await removeApp(a.id))
      if (app === a.id) setApp(0)
    } catch (err) {
      setNote({ text: (err as Error).message, bad: true })
    }
    setBusy(undefined)
  }

  const every = ctx.index.watchEveryHours
  return (
    <div class="grid">
      <Card class="s12" title="Watched apps"
        sub={`Their bad reviews and removals go to Slack · checked every ${every} h, last ${ago(ctx.index.lastReviews)}`}>
        <form class="toolbar watch-add" onSubmit={add}>
          <input class="input" value={input} onInput={e => setInput((e.target as HTMLInputElement).value)}
            placeholder="App Store link or app id, e.g. https://apps.apple.com/us/app/…/id1234567890"
            disabled={!editable || !!busy} aria-label="App Store link or app id" />
          <button class="btn" type="submit" disabled={!editable || !!busy || !input.trim()}>{busy === 'add' ? 'Adding…' : 'Add'}</button>
        </form>
        {note && <div class={`watch-note ${note.bad ? 'bad' : ''}`}>{note.text}</div>}
        {live?.error && <div class="warn">Couldn't load the watch list: {live.error}</div>}
        {live && !live.configured && !live.error &&
          <div class="warn">Editing isn't set up: the site needs the DATA_REPO_TOKEN secret (Contents: Read and write on the data repository). Showing the list as of the last check.</div>}
        {!items.length && <Empty>No apps yet. Paste an App Store link above — your own apps, or any app whose reviews you want in Slack.</Empty>}
        {items.map(a => {
          const [kind, text] = status(a.row, ctx.index.countries.length)
          const all = mine.filter(r => r.appId === a.id)
          const b = all.filter(r => r.reasons.length)
          const week = b.filter(r => Date.now() - Date.parse(r.date) < WEEK)
          const pulled = Object.keys(a.row?.pulled ?? {})
          return (
            <div class="watch" key={a.id}>
              {a.icon ? <img class="watch-ico" src={a.icon} alt="" loading="lazy" /> : <div class="watch-ico" />}
              <div class="watch-main">
                <a class="watch-name" href={store(a.id)} target="_blank" rel="noreferrer">{a.name}</a>
                <div class="dim">{a.developer ?? `id${a.id}`}</div>
                <div class="chips">
                  <span class={`chip ${kind}`}>{text}</span>
                  {pulled.length > 0 && <span class="chip k-pulled" title="Gone from these storefronts while live elsewhere">Gone from {pulled.map(c => c.toUpperCase()).join(' ')}</span>}
                </div>
              </div>
              <button class="watch-stats" title="Show this app's reviews" onClick={() => { setApp(a.id); setBad('bad') }}>
                <b>{n(week.length)}</b> bad in 7 days<br />
                <span class="dim">{n(b.length)} bad of {n(all.length)} reviews</span>
              </button>
              <div class="watch-side">
                <span class="dim">Added {date(a.addedAt)}{a.addedBy ? ` by ${a.addedBy}` : ''}</span>
                {editable && <button class="btn ghost" onClick={() => remove(a)} disabled={!!busy}>{busy === a.id ? 'Removing…' : 'Remove'}</button>}
              </div>
            </div>
          )
        })}
      </Card>

      <Card class="s12" title="Reviews of watched apps" sub={`The latest 50 reviews per storefront on every check · last ${ctx.index.retentionDays} days`}>
        <div class="toolbar">
          <select class="select" value={app} onChange={e => setApp(Number((e.target as HTMLSelectElement).value))}>
            <option value={0}>All apps</option>{items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select class="select" value={cc} onChange={e => setCc((e.target as HTMLSelectElement).value)}>
            <option value="">All countries</option>{countries.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
          <Seg value={bad} options={[['bad', 'Bad'], ['all', 'All']]} onChange={setBad} />
          <span class="dim">{n(list.length)}</span>
        </div>
        {!reviews && <div class="dim">Loading…</div>}
        {reviews && !list.length && <Empty>No reviews match.</Empty>}
        {list.slice(0, limit).map(r => (
          <div class="review" key={r.id}>
            <div class="meta">
              <span class="stars">{'★'.repeat(r.rating)}{'☆'.repeat(Math.max(0, 5 - r.rating))}</span>
              <b style={{ color: 'var(--ink)' }}>{name(r.appId)}</b>
              <span>{r.country.toUpperCase()}</span><span>v{r.version}</span><span>{dateTime(r.date)}</span>
              {r.reasons.filter(x => !x.endsWith('★')).map(w => <span key={w} class="chip k-removed">{w}</span>)}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
                <a class="link" target="_blank" rel="noreferrer" href={`https://appstoreconnect.apple.com/apps/${r.appId}/distribution/activity/ios/ratingsResponses`}>Reply in ASC</a>
                <a class="link" target="_blank" rel="noreferrer" href={`https://apps.apple.com/${r.country}/app/id${r.appId}?see-all=reviews`}>App Store</a>
              </span>
            </div>
            {r.title && <div class="title">{r.title}</div>}
            <div class="text">{r.text}</div>
          </div>
        ))}
        {list.length > limit && <button class="btn ghost more" onClick={() => setLimit(limit + 300)}>Show more</button>}
      </Card>
    </div>
  )
}
