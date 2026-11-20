import { useMemo, useState } from 'preact/hooks'
import type { Ctx } from '../main.tsx'
import { useData, type AppRow, type EventKind, type WatchEvent } from '../data.ts'
import { KIND, date, storedText } from '../format.ts'
import { AppLink, Card, Chip, Empty, Highlight } from '../ui.tsx'

const ALL: EventKind[] = ['released', 'discovered', 'removed', 'returned', 'pulled', 'updated', 'boosted']

export function Events(ctx: Ctx) {
  const { data: events } = useData<WatchEvent[]>(`${ctx.cat}/events.json`)
  const { data: apps } = useData<AppRow[]>(`${ctx.cat}/apps.json`)
  const [kinds, setKinds] = useState<Set<EventKind>>(new Set(ALL.filter(k => k !== 'updated')))
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(300)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (events ?? []).filter(e => kinds.has(e.kind) && (!s || e.name.toLowerCase().includes(s) || e.developer.toLowerCase().includes(s)))
  }, [events, kinds, q])
  if (!events) return <div class="dim">Loading…</div>
  const icons = new Map((apps ?? []).map(a => [a.id, a.icon]))
  const toggle = (k: EventKind) => { const s = new Set(kinds); s.has(k) ? s.delete(k) : s.add(k); setKinds(s) }
  const counts = new Map<EventKind, number>()
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  return (
    <Card title="Events" sub={`Last ${ctx.index.retentionDays} days · ${list.length.toLocaleString('en-US')} of ${events.length.toLocaleString('en-US')}`}>
      <div class="toolbar">
        <div class="chips">
          {ALL.map(k => (
            <button key={k} class={`chip-btn ${kinds.has(k) ? `on k-${k}` : ''}`} onClick={() => toggle(k)}>{KIND[k]} · {counts.get(k) ?? 0}</button>
          ))}
        </div>
        <input class="input" placeholder="App or developer" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} style={{ minWidth: '240px' }} />
      </div>
      {!list.length && <Empty>Nothing found.</Empty>}
      <div class="rows">
        {list.slice(0, limit).map((e, i) => (
          <div class="row" key={i} style={{ alignItems: 'flex-start' }}>
            <span class="dim num" style={{ flex: 'none', width: '64px' }}>{date(e.date)}</span>
            <span style={{ width: '120px', flex: 'none' }}><Chip kind={e.kind} /></span>
            <span class="grow" style={{ whiteSpace: 'normal' }}>
              <AppLink id={e.appId} name={e.name} icon={icons.get(e.appId)} open={ctx.open} /> <span class="dim">· {e.developer}</span>
              {e.note && <div class="note"><Highlight text={storedText(e.note)} words={e.kind === 'updated' ? ctx.index.featureWords : ''} /></div>}
            </span>
            <span class="dim" style={{ flex: 'none', maxWidth: '200px', textAlign: 'right' }}>{e.countries?.map(c => c.toUpperCase()).join(' ')}</span>
          </div>
        ))}
      </div>
      {list.length > limit && <button class="btn ghost more" onClick={() => setLimit(limit + 500)}>Show more</button>}
    </Card>
  )
}
