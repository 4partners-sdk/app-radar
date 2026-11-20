import { useState } from 'preact/hooks'
import type { Ctx } from '../main.tsx'
import { useData, type AppRow, type EventKind, type Run, type WatchEvent } from '../data.ts'
import { KIND_COLOR, date, dateTime, n, storedText } from '../format.ts'
import { AppLink, Card, Chip, Empty, Kpi, Seg, Stacked } from '../ui.tsx'

const CATALOG: EventKind[] = ['released', 'discovered', 'removed', 'returned', 'pulled']

export function since(events: WatchEvent[], days: number, kind?: EventKind) {
  const from = new Date(Date.now() - days * 86_400_000).toISOString()
  return events.filter(e => e.date >= from && (!kind || e.kind === kind))
}

export function byDay(events: WatchEvent[], days: number, kinds: EventKind[], tz: string) {
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz })
  const map = new Map<string, Partial<Record<EventKind, number>>>()
  for (let i = days - 1; i >= 0; i--) map.set(key(new Date(Date.now() - i * 86_400_000)), {})
  for (const e of events) {
    if (!kinds.includes(e.kind)) continue
    const m = map.get(key(new Date(e.date)))
    if (m) m[e.kind] = (m[e.kind] ?? 0) + 1
  }
  return [...map].map(([k, parts]) => ({ label: date(k), parts }))
}

export function Overview(ctx: Ctx) {
  const { data: apps } = useData<AppRow[]>(`${ctx.cat}/apps.json`)
  const { data: events } = useData<WatchEvent[]>(`${ctx.cat}/events.json`)
  const { data: runs } = useData<Run[]>(`${ctx.cat}/runs.json`)
  const [days, setDays] = useState(30)
  if (!apps || !events) return <div class="dim">Loading…</div>
  const icons = new Map(apps.map(a => [a.id, a.icon]))
  const active = apps.filter(a => !a.removedAt)
  const w = (k: EventKind) => since(events, 7, k).length
  const last = runs?.filter(r => r.mode === 'daily').at(-1)
  const recent = events.filter(e => e.kind !== 'updated').slice(0, 25)
  const devs = [...active.reduce((m, a) => m.set(a.dev, (m.get(a.dev) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
  return (
    <div class="grid">
      <div class="s12 kpis">
        <Kpi t="Tracking" v={n(active.length)} s={`${n(apps.length - active.length)} removed in the period`} />
        <Kpi t="New · 7 days" v={n(w('released'))} s="released < 30 days ago" />
        <Kpi t="Found · 7 days" v={n(w('discovered'))} s="older apps, first seen in search" />
        <Kpi t="Removed · 7 days" v={<span style={{ color: 'var(--red)' }}>{n(w('removed'))}</span>} s={`${n(w('pulled'))} pulled from some countries`} />
        <Kpi t="Returned · 7 days" v={n(w('returned'))} s="temporary removals" />
        <Kpi t="Updates · 7 days" v={n(w('updated'))} s={`${n(w('boosted'))} with a ratings boost`} />
      </div>
      <Card class="s8" title="Changes by day" sub="New, found, removed and returned apps"
        right={<Seg value={days} options={[[30, '30 d'], [90, '90 d']]} onChange={setDays} />}>
        <Stacked days={byDay(events, days, CATALOG, ctx.index.timezone)} kinds={CATALOG} colors={KIND_COLOR} />
      </Card>
      <Card class="s4" title="Most apps" sub="Developers in this category">
        <div class="rows">
          {devs.map(([d, c]) => (
            <div class="row" key={d}>
              <span class="grow link" onClick={() => ctx.go('apps', `q=${encodeURIComponent(d)}`)}>{d}</span>
              <span class="num muted">{c}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card class="s8" title="Latest events" right={<a class="link muted" href={`#/${ctx.cat}/events`}>All events →</a>}>
        {!recent.length && <Empty>No events yet — they start with the second check.</Empty>}
        <div class="rows">
          {recent.map((e, i) => (
            <div class="row" key={i}>
              <span style={{ width: '110px', flex: 'none' }}><Chip kind={e.kind} /></span>
              <span class="grow"><AppLink id={e.appId} name={e.name} icon={icons.get(e.appId)} open={ctx.open} /> <span class="dim">· {e.developer}</span>
                {e.note && <div class="note">{storedText(e.note)}</div>}</span>
              <span class="dim" style={{ flex: 'none' }}>{e.countries?.slice(0, 4).map(c => c.toUpperCase()).join(' ')}</span>
              <span class="dim num" style={{ flex: 'none', width: '64px', textAlign: 'right' }}>{date(e.date)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card class="s4" title="Last check">
        {last ? (
          <div class="rows">
            <div class="row"><span class="grow muted">When</span><span>{dateTime(last.date)}</span></div>
            <div class="row"><span class="grow muted">Took</span><span>{Math.round(last.duration / 60)} min</span></div>
            <div class="row"><span class="grow muted">In the store</span><span class="num">{n(last.active)}</span></div>
            {Object.entries(last.counts).map(([k, v]) => (
              <div class="row" key={k}><span class="grow"><Chip kind={k as EventKind} /></span><span class="num">{n(v)}</span></div>
            ))}
            {last.error && <div class="row"><span class="grow" style={{ color: 'var(--amber)' }}>⚠︎ {storedText(last.error)}</span></div>}
          </div>
        ) : <Empty>No checks yet.</Empty>}
      </Card>
    </div>
  )
}
