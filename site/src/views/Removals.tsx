import { useMemo, useState } from 'preact/hooks'
import type { Ctx } from '../main.tsx'
import { useData, type AppRow, type EventKind, type WatchEvent } from '../data.ts'
import { KIND_COLOR, age, country, date, dateTime, n, pct, storedText, words } from '../format.ts'
import { AppLink, Card, Empty, HBars, Kpi, Seg, Stacked } from '../ui.tsx'
import { byDay, since } from './Overview.tsx'

interface Factor { group: string; label: string; apps: number; removed: number; rate: number; lift: number; strength: number }

/** apps of average risk blended into every group before comparing: 1 of 5 removed proves less than 12 of 500 */
const PRIOR = 100

function factors(all: AppRow[], riskyWords: string): { list: Factor[]; base: number } {
  const hits = (a: AppRow) => !!a.removedAt
  const base = all.length ? all.filter(hits).length / all.length : 0
  const asOf = (a: AppRow) => (a.removedAt ? Date.parse(a.removedAt) : Date.now())
  const days = (a: AppRow, d?: string) => (d ? (asOf(a) - Date.parse(d)) / 86_400_000 : undefined)
  const portfolio = new Map<string, number>()
  for (const a of all) portfolio.set(a.dev, (portfolio.get(a.dev) ?? 0) + 1)
  const out: Factor[] = []
  const add = (group: string, label: string, match: (a: AppRow) => boolean) => {
    const g = all.filter(match)
    if (g.length < 5) return
    const r = g.filter(hits).length
    const rate = r / g.length
    out.push({ group, label, apps: g.length, removed: r, rate, lift: base ? rate / base : 0,
      strength: base ? (r + PRIOR * base) / (g.length + PRIOR) / base : 0 })
  }
  for (const w of words(riskyWords)) add('Claims', `“${w}” in name or description`, a => a.claims.includes(w))
  for (const [l, lo, hi] of [['< 30 days old', 0, 30], ['1–6 months old', 30, 182], ['6–24 months old', 182, 730], ['> 2 years old', 730, 1e9]] as const)
    add('Age', l, a => { const d = days(a, a.released); return d !== undefined && d >= lo && d < hi })
  for (const [l, lo, hi] of [['updated < 90 days ago', 0, 90], ['90–365 days without an update', 90, 365], ['> 1 year without an update', 365, 1e9]] as const)
    add('Updates', l, a => { const d = days(a, a.updated); return d !== undefined && d >= lo && d < hi })
  for (const [l, lo, hi] of [['0 ratings', 0, 0], ['1–9 ratings', 1, 9], ['10–99', 10, 99], ['100–999', 100, 999], ['1,000+', 1000, Infinity]] as const)
    add('Ratings', l, a => a.ratings >= lo && a.ratings <= hi)
  add('Price', 'free download', a => !(a.price > 0))
  add('Price', 'paid download', a => a.price > 0)
  for (const [l, lo, hi] of [['1 language', 0, 1], ['2–5 languages', 2, 5], ['6+ languages', 6, 1000]] as const)
    add('Localization', l, a => a.langs >= lo && a.langs <= hi)
  for (const [l, lo, hi] of [['developer with 1 app here', 1, 1], ['developer with 2–4 apps', 2, 4], ['developer with 5+ apps', 5, 1e6]] as const)
    add('Developer', l, a => { const c = portfolio.get(a.dev) ?? 1; return c >= lo && c <= hi })
  return { list: out, base }
}

const level = (f: Factor) => (f.removed >= 3 && f.strength >= 2 ? 'strong' : f.removed >= 2 && f.strength >= 1.3 ? 'moderate' : '')

export function Removals(ctx: Ctx) {
  const { data: apps } = useData<AppRow[]>(`${ctx.cat}/apps.json`)
  const { data: events } = useData<WatchEvent[]>(`${ctx.cat}/events.json`)
  const [days, setDays] = useState(30)
  const [mode, setMode] = useState<'strength' | 'group'>('strength')
  const analysis = useMemo(() => (apps ? factors(apps, ctx.index.riskyWords) : undefined), [apps, ctx.index.riskyWords])
  if (!apps || !events || !analysis) return <div class="dim">Loading…</div>
  const removed = apps.filter(a => a.removedAt).sort((a, b) => (b.removedAt! > a.removedAt! ? 1 : -1))
  const r = (d: number) => since(events, d, 'removed').length
  const returned = events.filter(e => e.kind === 'returned')
  const wipes = new Map<string, AppRow[]>()
  for (const a of removed) if (a.tags?.some(t => t.startsWith('developer wiped'))) wipes.set(a.dev, [...(wipes.get(a.dev) ?? []), a])
  const pulled = new Map<string, number>()
  for (const a of apps) for (const c of a.pulled ?? []) pulled.set(c, (pulled.get(c) ?? 0) + 1)
  const kinds: EventKind[] = ['removed', 'pulled', 'returned']
  const sorted = mode === 'strength' ? [...analysis.list].sort((a, b) => b.strength - a.strength) : analysis.list
  const signals = analysis.list.filter(f => level(f) === 'strong').sort((a, b) => b.strength - a.strength)
  return (
    <div class="grid">
      <div class="s12 kpis">
        <Kpi t="Removed · 7 days" v={<span style={{ color: 'var(--red)' }}>{n(r(7))}</span>} />
        <Kpi t="30 days" v={n(r(30))} />
        <Kpi t={`${ctx.index.retentionDays} days`} v={n(removed.length)} s={`${pct(analysis.base)} of everything tracked`} />
        <Kpi t="Returned" v={n(returned.length)} s="temporary removals, glitches" />
        <Kpi t="Developer wipes" v={n(wipes.size)} s="all of a developer’s apps within a day" />
        <Kpi t="Pulled from countries" v={n([...pulled.values()].reduce((s, v) => s + v, 0))} s="still live elsewhere" />
      </div>
      <Card class="s8" title="Removals by day" right={<Seg value={days} options={[[30, '30 d'], [90, '90 d']]} onChange={setDays} />}>
        <Stacked days={byDay(events, days, kinds, ctx.index.timezone)} kinds={kinds} colors={KIND_COLOR} />
      </Card>
      <Card class="s4" title="Strongest signals" sub="Groups removed 2×+ more often than average, with 3+ removals">
        {!signals.length && <Empty>No solid signals yet — more removals are needed.</Empty>}
        <div class="rows">
          {signals.slice(0, 8).map(f => (
            <div class="row" key={f.group + f.label}>
              <span class="grow"><span class="dim">{f.group}:</span> {f.label}</span>
              <span class="strong num">×{f.strength.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card class="s12" title="Removed apps" sub="The removal happened between the last check that saw the app and the first one that didn’t">
        {!removed.length && <Empty>No removals in the period.</Empty>}
        {removed.length > 0 && (
          <div class="table-wrap" style={{ maxHeight: '480px' }}>
            <table class="t">
              <thead><tr><th>App</th><th>Developer</th><th class="r">Ratings</th><th>Age</th><th>Since update</th><th>Disappeared</th><th>Context</th></tr></thead>
              <tbody>
                {removed.slice(0, 400).map(a => (
                  <tr key={a.id} onClick={() => ctx.open(a.id)}>
                    <td class="name">{a.icon && <img class="ico" src={a.icon} loading="lazy" alt="" style={{ marginRight: '8px' }} />}{a.name}</td>
                    <td class="name muted" style={{ maxWidth: '180px' }}>{a.dev}</td>
                    <td class="r num">{n(a.ratings)}</td>
                    <td class="muted">{age(a.released ? (Date.parse(a.removedAt!) - Date.parse(a.released)) / 86_400_000 : undefined)}</td>
                    <td class="muted">{age(a.updated ? (Date.parse(a.removedAt!) - Date.parse(a.updated)) / 86_400_000 : undefined)}</td>
                    <td class="muted">{dateTime(a.missingSince ?? a.removedAt)}</td>
                    <td class="dim">{[...(a.tags ?? []).map(storedText), ...a.claims.slice(0, 3)].join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card class="s8" title="Who gets removed more often" sub={`Removal rate per group vs the average (${pct(analysis.base)}). Strength accounts for group size.`}
        right={<Seg value={mode} options={[['strength', 'By strength'], ['group', 'By group']]} onChange={setMode} />}>
        <div class="table-wrap" style={{ maxHeight: '520px' }}>
          <table class="t">
            <thead><tr><th>Group</th><th>Trait</th><th class="r">Apps</th><th class="r">Removed</th><th class="r">Rate</th><th class="r">×</th><th class="r">Strength</th></tr></thead>
            <tbody>
              {sorted.map(f => (
                <tr key={f.group + f.label} style={{ cursor: 'default' }}>
                  <td class="muted">{f.group}</td><td>{f.label}</td>
                  <td class="r num">{n(f.apps)}</td><td class="r num">{n(f.removed)}</td><td class="r num">{pct(f.rate)}</td>
                  <td class="r num">{f.lift.toFixed(1)}</td><td class={`r num ${level(f)}`}>{f.strength.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div class="s4" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Card title="Pulled by country" sub="Gone from a country, still live in others">
          {!pulled.size ? <Empty>None.</Empty> : <HBars color="var(--amber)" rows={[...pulled].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, v]) => ({ label: country(c), value: v }))} />}
        </Card>
        <Card title="Developer wipes">
          {!wipes.size && <Empty>None.</Empty>}
          <div class="rows">
            {[...wipes].map(([dev, list]) => (
              <div class="row" key={dev}><span class="grow">{dev}</span><span class="num muted">{list.length} apps · {date(list[0].removedAt)}</span></div>
            ))}
          </div>
        </Card>
        <Card title="Came back" sub="Removed, then live again">
          {!returned.length && <Empty>None.</Empty>}
          <div class="rows">
            {returned.slice(0, 12).map((e, i) => (
              <div class="row" key={i}><span class="grow"><AppLink id={e.appId} name={e.name} open={ctx.open} /></span><span class="dim num">{date(e.date)}</span></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
