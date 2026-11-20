import { useMemo, useState } from 'preact/hooks'
import type { Ctx } from '../main.tsx'
import { useData, type AppRow, type VersionRow } from '../data.ts'
import { compact, country, date, daysSince, hasWord, median, n, pct, words } from '../format.ts'
import { AppLink, Bars, Card, Empty, HBars, Highlight, Kpi, Seg } from '../ui.tsx'

function releasesByMonth(apps: AppRow[], months: number) {
  const now = new Date()
  const out: { label: string; value: number; title: string }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = d.toISOString().slice(0, 7)
    out.push({
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      title: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      value: apps.filter(a => a.released?.startsWith(key)).length,
    })
  }
  return out
}

export function Insights(ctx: Ctx) {
  const { data: all } = useData<AppRow[]>(`${ctx.cat}/apps.json`)
  const { data: versions } = useData<VersionRow[]>(`${ctx.cat}/versions.json`)
  const [months, setMonths] = useState(12)
  const [trendDays, setTrendDays] = useState<7 | 30>(7)
  const [featDays, setFeatDays] = useState(30)
  const apps = useMemo(() => (all ?? []).filter(a => !a.removedAt), [all])
  const byId = useMemo(() => new Map(apps.map(a => [a.id, a])), [apps])
  if (!all) return <div class="dim">Loading…</div>
  if (!apps.length) return <Empty>No data for this category yet.</Empty>

  const total = apps.reduce((s, a) => s + a.ratings, 0)
  const avg = total ? apps.reduce((s, a) => s + a.rating * a.ratings, 0) / total : 0
  const top10 = total ? [...apps].sort((a, b) => b.ratings - a.ratings).slice(0, 10).reduce((s, a) => s + a.ratings, 0) / total : 0
  const dead = apps.filter(a => a.ratings < 10).length / apps.length
  const updated = apps.filter(a => (daysSince(a.updated) ?? 1e9) <= 30).length / apps.length
  const stale = apps.filter(a => (daysSince(a.updated) ?? 0) > 365).length / apps.length
  const buckets: [string, number, number][] = [['0', 0, 0], ['1+', 1, 9], ['10+', 10, 99], ['100+', 100, 999], ['1k+', 1000, 9999], ['10k+', 10000, 99999], ['100k+', 100000, Infinity]]
  const key = trendDays === 7 ? 'g7' : 'g30'
  const trending = apps.filter(a => (a[key] ?? 0) > 0).sort((a, b) => b[key]! - a[key]!).slice(0, 12)
  const hasHistory = apps.some(a => a[key] !== undefined)
  const newcomers = apps.filter(a => (daysSince(a.released) ?? 1e9) <= 90).sort((a, b) => b.ratings - a.ratings).slice(0, 12)
  const devs = [...apps.reduce((m, a) => {
    const d = m.get(a.dev) ?? { apps: 0, ratings: 0, w: 0 }
    d.apps++; d.ratings += a.ratings; d.w += a.rating * a.ratings
    return m.set(a.dev, d)
  }, new Map<string, { apps: number; ratings: number; w: number }>())].sort((a, b) => b[1].ratings - a[1].ratings).slice(0, 12)
  const countries = new Map<string, number>()
  for (const a of apps) for (const c of a.countries) countries.set(c, (countries.get(c) ?? 0) + 1)
  const live = (versions ?? []).filter(v => byId.has(v.id))
  const boosts = live.filter(v => v.boost).sort((a, b) => (b.after! - (b.before ?? 0)) - (a.after! - (a.before ?? 0))).slice(0, 10)
  const latest = new Map<number, VersionRow>()
  for (const v of live) if (!latest.has(v.id) || latest.get(v.id)!.date < v.date) latest.set(v.id, v)
  const fresh = [...latest.values()].filter(v => (daysSince(v.date) ?? 1e9) <= 14).sort((a, b) => byId.get(b.id)!.ratings - byId.get(a.id)!.ratings).slice(0, 12)
  const recentNotes = [...latest.values()].filter(v => (daysSince(v.date) ?? 1e9) <= featDays)
  const features = words(ctx.index.featureWords).map(w => {
    const hit = recentNotes.filter(v => hasWord(v.notes, w))
    return { w, apps: hit.length, ratings: hit.reduce((s, v) => s + byId.get(v.id)!.ratings, 0) }
  }).sort((a, b) => b.apps - a.apps)

  return (
    <div class="grid">
      <div class="s12 kpis">
        <Kpi t="Apps" v={n(apps.length)} s={`median ${n(median(apps.map(a => a.ratings)))} ratings`} />
        <Kpi t="Ratings, all countries" v={compact(total)} />
        <Kpi t="Avg rating" v={`${avg.toFixed(2)} ★`} s="weighted by ratings" />
        <Kpi t="Top 10 share" v={pct(top10)} s="of all ratings — market concentration" />
        <Kpi t="No traction" v={pct(dead)} s="fewer than 10 ratings" />
        <Kpi t="Updated · 30 days" v={pct(updated)} s={`${pct(stale)} abandoned (> 1 year)`} />
      </div>
      <Card class="s8" title="New releases per month" sub="Apps in the store now, by release date"
        right={<Seg value={months} options={[[12, '12 mo'], [24, '24 mo']]} onChange={setMonths} />}>
        <Bars data={releasesByMonth(apps, months)} showValues={months === 12} />
      </Card>
      <Card class="s4" title="Apps by ratings" sub="Apps per ratings bracket">
        <Bars color="var(--violet)" data={buckets.map(([l, lo, hi]) => ({ label: l, value: apps.filter(a => a.ratings >= lo && a.ratings <= hi).length }))} />
      </Card>
      <Card class="s6" title="Trending" sub="New ratings (a proxy for installs), counted in already-known storefronts only"
        right={<Seg value={trendDays} options={[[7, '7 d'], [30, '30 d']]} onChange={setTrendDays} />}>
        {!hasHistory ? <Empty>Still collecting history — this needs {trendDays} days of daily checks.</Empty> : !trending.length ? <Empty>No growth in this period.</Empty> : (
          <div class="rows">
            {trending.map(a => (
              <div class="row" key={a.id}>
                <span class="grow"><AppLink id={a.id} name={a.name} icon={a.icon} open={ctx.open} /> <span class="dim">· {a.dev}</span></span>
                <span class="dim num">{a.ratings - a[key]! > 0 ? pct(a[key]! / (a.ratings - a[key]!)) : 'new'}</span>
                <span class="num" style={{ color: 'var(--accent)', minWidth: '70px', textAlign: 'right' }}>+{n(a[key])}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card class="s6" title="Rising newcomers" sub="Released in the last 90 days, most rated first">
        {!newcomers.length && <Empty>No releases in the last 90 days.</Empty>}
        <div class="rows">
          {newcomers.map(a => (
            <div class="row" key={a.id}>
              <span class="grow"><AppLink id={a.id} name={a.name} icon={a.icon} open={ctx.open} /> <span class="dim">· {a.dev}</span></span>
              <span class="dim">{date(a.released)}</span>
              <span class="num" style={{ minWidth: '60px', textAlign: 'right' }}>{n(a.ratings)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card class="s6" title="Updates that worked" sub="Rating pace in the 7 days after a release grew 1.5×+ (and by 2+ a day)">
        {!boosts.length && <Empty>Nothing yet. Each release is measured 7 days after it ships, against the 7 days before.</Empty>}
        <div class="rows">
          {boosts.map(v => {
            const a = byId.get(v.id)!
            return (
              <div class="row" key={v.id + v.version} style={{ display: 'block' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span class="grow" style={{ flex: 1, minWidth: 0 }}><AppLink id={a.id} name={a.name} icon={a.icon} open={ctx.open} /> <span class="dim">v{v.version}</span></span>
                  <span class="muted num">{(v.before ?? 0).toFixed(0)} → {v.after!.toFixed(0)} / day</span>
                  <span class="num" style={{ color: 'var(--violet)' }}>{v.before ? `×${(v.after! / v.before).toFixed(1)}` : 'from zero'}</span>
                </div>
                {v.notes && <div class="note"><Highlight text={v.notes} words={ctx.index.featureWords} /></div>}
              </div>
            )
          })}
        </div>
      </Card>
      <Card class="s6" title="Fresh updates" sub="Shipped in the last 14 days by the most-rated apps · watched features highlighted">
        {!fresh.length && <Empty>No updates in the last 14 days.</Empty>}
        <div class="rows">
          {fresh.map(v => {
            const a = byId.get(v.id)!
            return (
              <div class="row" key={v.id} style={{ display: 'block' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><AppLink id={a.id} name={a.name} icon={a.icon} open={ctx.open} /> <span class="dim">v{v.version}</span></span>
                  <span class="muted num">{n(a.ratings)}</span><span class="dim">{date(v.date)}</span>
                </div>
                {v.notes && <div class="note"><Highlight text={v.notes} words={ctx.index.featureWords} /></div>}
              </div>
            )
          })}
        </div>
      </Card>
      <Card class="s4" title="Feature trends" sub="Apps whose latest release notes mention it"
        right={<Seg value={featDays} options={[[30, '30 d'], [90, '90 d']]} onChange={setFeatDays} />}>
        <HBars color="var(--violet)" rows={features.map(f => ({ label: f.w, value: f.apps, text: `${f.apps} · ${compact(f.ratings)} ratings` }))} />
      </Card>
      <Card class="s5" title="Top developers" sub="By total ratings across their apps">
        <table class="t"><thead><tr><th style={{ cursor: 'default' }}>Developer</th><th class="r">Apps</th><th class="r">Ratings</th><th class="r">★</th></tr></thead>
          <tbody>{devs.map(([d, v]) => (
            <tr key={d} onClick={() => ctx.go('apps', `q=${encodeURIComponent(d)}`)}>
              <td class="name" style={{ maxWidth: '220px' }}>{d}</td><td class="r num">{v.apps}</td><td class="r num">{compact(v.ratings)}</td>
              <td class="r num muted">{v.ratings ? (v.w / v.ratings).toFixed(1) : '—'}</td>
            </tr>))}
          </tbody></table>
      </Card>
      <Card class="s3" title="Storefronts" sub="Apps found per country">
        <HBars color="var(--amber)" rows={[...countries].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ label: country(c), value: v }))} />
      </Card>
    </div>
  )
}
