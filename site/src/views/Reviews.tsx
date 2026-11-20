import { useMemo, useState } from 'preact/hooks'
import type { Ctx } from '../main.tsx'
import { useData, type Review } from '../data.ts'
import { dateTime, n } from '../format.ts'
import { Card, Empty, Kpi, Seg } from '../ui.tsx'

export function Reviews(ctx: Ctx) {
  const { data: reviews } = useData<Review[]>('reviews.json')
  const [app, setApp] = useState<number | 0>(0)
  const [bad, setBad] = useState<'bad' | 'all'>('bad')
  const [cc, setCc] = useState('')
  const [limit, setLimit] = useState(200)
  const list = useMemo(() => (reviews ?? []).filter(r =>
    (!app || r.appId === app) && (bad === 'all' || r.reasons.length) && (!cc || r.country === cc)), [reviews, app, bad, cc])
  if (!reviews) return <div class="dim">Loading…</div>
  const favs = ctx.index.favorites
  const name = (id: number) => favs.find(f => f.id === id)?.name ?? String(id)
  const countries = [...new Set(reviews.map(r => r.country))].sort()
  return (
    <div class="grid">
      <div class="s12 kpis">
        {favs.map(f => {
          const mine = reviews.filter(r => r.appId === f.id)
          const b = mine.filter(r => r.reasons.length)
          const week = b.filter(r => Date.now() - Date.parse(r.date) < 7 * 86_400_000)
          return <Kpi key={f.id} t={f.name} v={<span>{n(b.length)} <span class="dim" style={{ fontSize: '14px', fontWeight: 500 }}>bad of {n(mine.length)}</span></span>} s={`${n(week.length)} bad in 7 days · sent to Slack`} />
        })}
      </div>
      <Card class="s12" title="Reviews of favorite apps" sub={`The latest 50 reviews per country on every check · last ${ctx.index.retentionDays} days`}>
        <div class="toolbar">
          <select class="select" value={app} onChange={e => setApp(Number((e.target as HTMLSelectElement).value))}>
            <option value={0}>All apps</option>{favs.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select class="select" value={cc} onChange={e => setCc((e.target as HTMLSelectElement).value)}>
            <option value="">All countries</option>{countries.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
          <Seg value={bad} options={[['bad', 'Bad'], ['all', 'All']]} onChange={setBad} />
          <span class="dim">{n(list.length)}</span>
        </div>
        {!list.length && <Empty>No reviews match.</Empty>}
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
