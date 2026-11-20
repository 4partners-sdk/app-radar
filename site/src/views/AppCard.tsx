import { useEffect, useState } from 'preact/hooks'
import type { Ctx } from '../main.tsx'
import { detail, useData, type AppRow, type Detail } from '../data.ts'
import { age, country, date, dateTime, daysSince, n, signed, storedText } from '../format.ts'
import { Card, Empty, Highlight, HBars, Line } from '../ui.tsx'

const PERIOD_ORDER = ['1W', '1M', '3M', '6M', '1Y', '∞']

export function AppCard(p: Ctx & { id: number; onClose: () => void }) {
  const { data: apps } = useData<AppRow[]>(`${p.cat}/apps.json`)
  const [d, setD] = useState<Detail | null | undefined>(undefined)
  useEffect(() => {
    setD(undefined)
    detail(p.cat, p.id).then(x => setD(x ?? null), () => setD(null))
  }, [p.cat, p.id])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [p.onClose])
  const a = apps?.find(x => x.id === p.id)
  const field = (k: string, v: unknown) => (
    <div><div class="k">{k}</div><div class="v">{v === undefined || v === '' || v === null ? '—' : (v as string)}</div></div>
  )
  const dayFmt = (x: number) => date(new Date(x * 86_400_000).toISOString().slice(0, 10))
  return (
    <div class="modal-bg" onClick={e => e.target === e.currentTarget && p.onClose()}>
      <div class="modal">
        <button class="close" onClick={p.onClose} aria-label="Close">×</button>
        {!a ? <Empty>{apps ? 'This app is not in this category.' : 'Loading…'}</Empty> : (
          <>
            <div class="head">
              {a.icon && <img class="ico lg" src={a.icon} alt="" />}
              <div style={{ minWidth: 0 }}>
                <h2>{a.name}</h2>
                <div class="muted">{a.dev} · {a.genre}</div>
                <div style={{ marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <a class="link" href={a.url} target="_blank" rel="noreferrer">App Store ↗</a>
                  {d?.sellerURL && <a class="link muted" href={d.sellerURL} target="_blank" rel="noreferrer">Website ↗</a>}
                  {a.removedAt && <span style={{ color: 'var(--red)', fontWeight: 600 }}>Removed {dateTime(a.removedAt)}</span>}
                </div>
              </div>
            </div>
            <div class="grid">
              <Card class="s12">
                <div class="fields">
                  {field('Rating', a.ratings ? `${a.rating.toFixed(2)} ★` : '—')}
                  {field('Ratings (all countries)', n(a.ratings))}
                  {field('Gained 7 / 30 d', `${signed(a.g7)} / ${signed(a.g30)}`)}
                  {field('Released', `${date(a.released, true)} · ${age(daysSince(a.released))}`)}
                  {field('Version', `${a.version ?? '—'} · ${date(a.updated, true)}`)}
                  {field('Download price', a.priceLabel)}
                  {field('Subscriptions', a.plans ? `${a.plans}${a.iapCountry && a.iapCountry !== 'us' ? ` (${a.iapCountry.toUpperCase()})` : ''}` : a.hasIAP === false ? 'no in-app purchases' : a.iapAt ? 'not recognized' : 'not read yet')}
                  {field('Size', a.sizeMB !== undefined ? `${a.sizeMB} MB` : '—')}
                  {field('Min iOS', a.minOS)}
                  {field('iPad', a.iPad ? 'yes' : 'no')}
                  {field('Age rating', a.age)}
                  {field('Languages', a.langs)}
                  {field('Bundle ID', a.bundle)}
                  {field('Tracked since', date(a.firstSeen, true))}
                  {a.removedAt && field('Disappeared', `between ${dateTime(a.lastSeen)} and ${dateTime(a.missingSince)}`)}
                  {a.tags && field('Removal context', a.tags.map(storedText).join(' · '))}
                  {a.pulled && field('Pulled from', a.pulled.map(c => c.toUpperCase()).join(' '))}
                  {a.claims.length > 0 && field('Claim words', a.claims.join(', '))}
                </div>
              </Card>
              {d === undefined && <Card class="s12"><Empty>Loading details…</Empty></Card>}
              {d && (
                <>
                  <Card class="s8" title="Ratings growth" sub="Counted only in storefronts the app was already in · dashed lines are new versions">
                    <Line points={d.growth} format={dayFmt}
                      marks={(d.versions ?? []).filter(v => v.seen).map(v => ({ x: Math.floor(Date.parse(v.date) / 86_400_000), label: `v${v.version} · ${date(v.date)}` }))} />
                  </Card>
                  <Card class="s4" title="Ratings by country">
                    <HBars rows={Object.entries(d.byCountry).sort((x, y) => y[1][0] - x[1][0]).slice(0, 13)
                      .map(([c, [cnt, avg]]) => ({ label: country(c), value: cnt, text: `${n(cnt)} · ${avg.toFixed(1)}★` }))} />
                  </Card>
                  <Card class="s6" title="Versions" sub="Releases in the period and how ratings reacted">
                    {!(d.versions ?? []).length && <Empty>No versions seen.</Empty>}
                    <div class="rows">
                      {[...(d.versions ?? [])].reverse().map(v => (
                        <div class="row" key={v.version} style={{ display: 'block' }}>
                          <div><b>v{v.version}</b> <span class="dim">· {date(v.date, true)}{!v.seen ? ' · live when tracking started' : ''}</span>
                            {v.after !== undefined && <span class="dim"> · {v.before?.toFixed(1) ?? '?'} → {v.after.toFixed(1)} ratings/day</span>}</div>
                          {v.notes && <div class="note" style={{ WebkitLineClamp: 4 }}><Highlight text={v.notes} words={p.index.featureWords} /></div>}
                        </div>
                      ))}
                    </div>
                  </Card>
                  <Card class="s6" title="In-app purchases" sub={a.iapAt ? `From the App Store page (${a.iapCountry?.toUpperCase()}), ${date(a.iapAt, true)}` : 'Prices are read weekly for the top apps of each category'}>
                    {!(d.inApp ?? []).length ? <Empty>{a.hasIAP === false ? 'No in-app purchases.' : 'No data.'}</Empty> : (
                      <div class="rows">
                        {d.inApp!.map((i, k) => (
                          <div class="row" key={k}><span class="grow">{i.name}</span><span class="num">{i.priceText}</span></div>
                        ))}
                      </div>
                    )}
                  </Card>
                  {(d.screenshots ?? []).length > 0 && (
                    <Card class="s12" title="Screenshots">
                      <div class="shots">{d.screenshots!.map(s => <img key={s} src={s} loading="lazy" alt="" />)}</div>
                    </Card>
                  )}
                  {d.desc && <Card class="s12" title="Description (start)"><div class="muted" style={{ whiteSpace: 'pre-wrap' }}><Highlight text={d.desc} words={p.index.riskyWords} /></div></Card>}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
export { PERIOD_ORDER }
