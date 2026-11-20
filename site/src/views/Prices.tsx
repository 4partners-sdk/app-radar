import { useMemo } from 'preact/hooks'
import type { Ctx } from '../main.tsx'
import { useData, type AppRow } from '../data.ts'
import { date, median, n, pct, usd } from '../format.ts'
import { Bars, Card, Empty, Kpi } from '../ui.tsx'

export function Prices(ctx: Ctx) {
  const { data: all } = useData<AppRow[]>(`${ctx.cat}/apps.json`)
  const apps = useMemo(() => (all ?? []).filter(a => !a.removedAt), [all])
  if (!all) return <div class="dim">Loading…</div>
  const scanned = apps.filter(a => a.iapAt)
  if (!scanned.length) return <Card title="Subscription prices"><Empty>Prices haven’t been read yet. They are read weekly after the morning check.</Empty></Card>
  const us = scanned.filter(a => a.iapCountry === 'us')
  const med = (k: 'week' | 'month' | 'year') => median(us.map(a => a[k]).filter((v): v is number => v !== undefined))
  const cnt = (k: 'week' | 'month' | 'year') => us.filter(a => a[k] !== undefined).length
  const edges: [string, number, number][] = [['< $5', 0, 5], ['$5–6.99', 5, 7], ['$7–9.99', 7, 10], ['$10–14.99', 10, 15], ['$15+', 15, 1e6]]
  const weekly = us.map(a => a.week).filter((v): v is number => v !== undefined)
  const yearly = us.map(a => a.year).filter((v): v is number => v !== undefined)
  const yEdges: [string, number, number][] = [['< $20', 0, 20], ['$20–29', 20, 30], ['$30–39', 30, 40], ['$40–59', 40, 60], ['$60+', 60, 1e6]]
  const last = scanned.map(a => a.iapAt!).sort().at(-1)
  const leaders = [...scanned].sort((a, b) => b.ratings - a.ratings).slice(0, 40)
  const unknown = scanned.filter(a => a.hasIAP && !a.plans).length
  return (
    <div class="grid">
      <div class="s12 kpis">
        <Kpi t="Median · week" v={usd(med('week'))} s={`${cnt('week')} apps with a weekly plan`} />
        <Kpi t="Median · month" v={usd(med('month'))} s={`${cnt('month')} apps`} />
        <Kpi t="Median · year" v={usd(med('year'))} s={`${cnt('year')} apps`} />
        <Kpi t="Weekly plan" v={pct(scanned.filter(a => a.week !== undefined).length / scanned.length)} s={`of ${n(scanned.length)} apps read`} />
        <Kpi t="Trial in plan name" v={pct(scanned.filter(a => a.trial).length / scanned.length)} s="understated: trials are rarely named" />
        <Kpi t="Plans not recognized" v={n(unknown)} s="“Premium”, “Pro” with no period" />
      </div>
      <Card class="s6" title="Weekly plan" sub={`Usual price (the one listed most often), US store · ${n(weekly.length)} apps`}>
        <Bars data={edges.map(([l, lo, hi]) => ({ label: l, value: weekly.filter(v => v >= lo && v < hi).length }))} />
      </Card>
      <Card class="s6" title="Yearly plan" sub={`US store · ${n(yearly.length)} apps`}>
        <Bars color="var(--blue)" data={yEdges.map(([l, lo, hi]) => ({ label: l, value: yearly.filter(v => v >= lo && v < hi).length }))} />
      </Card>
      <Card class="s12" title="Plans of the leaders" sub={`The category’s top ${ctx.index.pricesTop} are read weekly · last read ${date(last, true)}`}>
        <div class="table-wrap" style={{ maxHeight: '600px' }}>
          <table class="t">
            <thead><tr><th>App</th><th class="r">Ratings</th><th>Plans</th><th class="r">Weekly</th><th>Trial</th><th>Store</th></tr></thead>
            <tbody>
              {leaders.map(a => (
                <tr key={a.id} onClick={() => ctx.open(a.id)}>
                  <td class="name">{a.icon && <img class="ico" src={a.icon} loading="lazy" alt="" style={{ marginRight: '8px' }} />}{a.name}</td>
                  <td class="r num">{n(a.ratings)}</td>
                  <td class="muted">{a.plans ?? (a.hasIAP === false ? 'no in-app purchases' : 'not recognized')}</td>
                  <td class="r num">{a.week !== undefined && a.iapCountry === 'us' ? usd(a.week) : ''}</td>
                  <td>{a.trial ? 'yes' : ''}</td>
                  <td class="dim">{a.iapCountry?.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
