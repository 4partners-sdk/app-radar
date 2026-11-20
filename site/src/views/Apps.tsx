import { useMemo, useState } from 'preact/hooks'
import type { Ctx } from '../main.tsx'
import { useData, type AppRow } from '../data.ts'
import { compact, country, date, daysSince, median, n, signed, usd, words } from '../format.ts'
import { Card, Empty } from '../ui.tsx'

type SortKey = 'name' | 'dev' | 'rating' | 'ratings' | 'g7' | 'g30' | 'released' | 'updated' | 'week' | 'countries' | 'removedAt'

interface Filter {
  status: 'active' | 'removed' | 'all'
  q: string
  minRatings: number
  released: number
  updated: string
  price: string
  sub: string
  maxWeek: number
  genre: string
  country: string
  claim: string
  iPad: string
}

const START: Filter = { status: 'active', q: '', minRatings: 0, released: 0, updated: '', price: '', sub: '', maxWeek: 0, genre: '', country: '', claim: '', iPad: '' }

export function matches(a: AppRow, f: Filter): boolean {
  if (f.status === 'active' && a.removedAt) return false
  if (f.status === 'removed' && !a.removedAt) return false
  if (f.q) {
    const s = f.q.toLowerCase()
    if (!a.name.toLowerCase().includes(s) && !a.dev.toLowerCase().includes(s) && !(a.bundle ?? '').toLowerCase().includes(s)) return false
  }
  if (a.ratings < f.minRatings) return false
  if (f.released && (daysSince(a.released) ?? Infinity) > f.released) return false
  if (f.updated) {
    const d = daysSince(a.updated) ?? Infinity
    if (f.updated === 'stale' ? d <= 365 : d > Number(f.updated)) return false
  }
  if (f.price === 'free' && a.price > 0) return false
  if (f.price === 'paid' && !(a.price > 0)) return false
  if (f.sub === 'weekly' && a.week === undefined) return false
  if (f.sub === 'yearly' && a.year === undefined) return false
  if (f.sub === 'trial' && !a.trial) return false
  if (f.sub === 'noiap' && a.hasIAP !== false) return false
  if (f.sub === 'unscanned' && a.iapAt) return false
  // prices from non-US storefronts are in local currency — the $ filter only compares US prices
  if (f.maxWeek && !(a.iapCountry === 'us' && a.week !== undefined && a.week <= f.maxWeek)) return false
  if (f.genre && a.genre !== f.genre) return false
  if (f.country && !a.countries.includes(f.country) && !(a.pulled ?? []).includes(f.country)) return false
  if (f.claim && !a.claims.includes(f.claim)) return false
  if (f.iPad && String(a.iPad) !== f.iPad) return false
  return true
}

function sortValue(a: AppRow, k: SortKey): number | string {
  switch (k) {
    case 'name': return a.name.toLowerCase()
    case 'dev': return a.dev.toLowerCase()
    case 'countries': return a.countries.length
    case 'released': case 'updated': case 'removedAt': return a[k] ?? ''
    case 'week': return a.iapCountry === 'us' && a.week !== undefined ? -a.week : -Infinity
    default: return a[k] ?? -Infinity
  }
}

function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : Array.isArray(v) ? v.join(' ') : String(v)
  // a cell starting with = + - @ is a formula in Excel
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCSV(rows: AppRow[], cat: string) {
  const cols: (keyof AppRow)[] = ['id', 'name', 'dev', 'devId', 'genre', 'rating', 'ratings', 'g7', 'g30', 'released', 'updated', 'version',
    'priceLabel', 'week', 'month', 'year', 'lifetime', 'plans', 'trial', 'hasIAP', 'iapCountry', 'langs', 'iPad', 'sizeMB', 'age', 'minOS',
    'bundle', 'countries', 'pulled', 'firstSeen', 'removedAt', 'tags', 'claims', 'url']
  const text = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  a.download = `${cat}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export function Apps(ctx: Ctx) {
  const { data: apps } = useData<AppRow[]>(`${ctx.cat}/apps.json`)
  const initialQ = new URLSearchParams(ctx.query).get('q') ?? ''
  const [f, setF] = useState<Filter>({ ...START, q: initialQ })
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'ratings', desc: true })
  const [limit, setLimit] = useState(300)
  const [showFilters, setShowFilters] = useState(false)
  const set = (patch: Partial<Filter>) => { setF({ ...f, ...patch }); setLimit(300) }

  const list = useMemo(() => {
    const l = (apps ?? []).filter(a => matches(a, f))
    const dir = sort.desc ? -1 : 1
    return l.sort((a, b) => {
      const x = sortValue(a, sort.k), y = sortValue(b, sort.k)
      return x < y ? -dir : x > y ? dir : b.ratings - a.ratings
    })
  }, [apps, f, sort])
  const genres = useMemo(() => [...new Set((apps ?? []).map(a => a.genre))].sort(), [apps])

  if (!apps) return <div class="dim">Loading…</div>
  const head = (k: SortKey, label: string, r = false) => (
    <th class={r ? 'r' : ''} onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : !['name', 'dev'].includes(k) })}>
      {label}{sort.k === k ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  )
  const total = list.reduce((s, a) => s + a.ratings, 0)
  const wsum = list.reduce((s, a) => s + a.rating * a.ratings, 0)
  // any filter beyond the search box and the status switch
  const active = (Object.keys(START) as (keyof Filter)[]).some(k => k !== 'q' && k !== 'status' && f[k] !== START[k])
  return (
    <Card>
      <div class="toolbar">
        <div class="seg">
          {([['active', 'In store'], ['removed', 'Removed'], ['all', 'All']] as const).map(([v, l]) => (
            <button key={v} class={f.status === v ? 'on' : ''} onClick={() => set({ status: v })}>{l}</button>
          ))}
        </div>
        <input class="input" placeholder="App, developer or bundle ID" value={f.q} onInput={e => set({ q: (e.target as HTMLInputElement).value })} style={{ flex: '1', minWidth: '220px' }} />
        <button class="btn ghost" onClick={() => setShowFilters(!showFilters)}>Filters{active ? ' •' : ''}</button>
        {active && <button class="btn ghost" onClick={() => set({ ...START, q: f.q, status: f.status })}>Reset</button>}
        <button class="btn" onClick={() => exportCSV(list, ctx.cat)}>CSV · {list.length.toLocaleString('en-US')}</button>
      </div>
      {showFilters && (
        <div class="filters">
          <label>Min ratings
            <select class="select" value={f.minRatings} onChange={e => set({ minRatings: Number((e.target as HTMLSelectElement).value) })}>
              {[0, 10, 100, 1000, 10000, 100000].map(v => <option key={v} value={v}>{v ? n(v) : 'Any'}</option>)}
            </select></label>
          <label>Released
            <select class="select" value={f.released} onChange={e => set({ released: Number((e.target as HTMLSelectElement).value) })}>
              <option value={0}>Any time</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option>
            </select></label>
          <label>Last update
            <select class="select" value={f.updated} onChange={e => set({ updated: (e.target as HTMLSelectElement).value })}>
              <option value="">Any</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="stale">Abandoned (&gt; 1 year)</option>
            </select></label>
          <label>Download price
            <select class="select" value={f.price} onChange={e => set({ price: (e.target as HTMLSelectElement).value })}>
              <option value="">Any</option><option value="free">Free</option><option value="paid">Paid</option>
            </select></label>
          <label>Subscriptions
            <select class="select" value={f.sub} onChange={e => set({ sub: (e.target as HTMLSelectElement).value })}>
              <option value="">Any</option><option value="weekly">Has weekly</option><option value="yearly">Has yearly</option>
              <option value="trial">Has a trial</option><option value="noiap">No in-app purchases</option><option value="unscanned">Prices not read yet</option>
            </select></label>
          <label>Weekly up to (US only)
            <select class="select" value={f.maxWeek} onChange={e => set({ maxWeek: Number((e.target as HTMLSelectElement).value) })}>
              {[0, 4.99, 6.99, 9.99, 14.99].map(v => <option key={v} value={v}>{v ? usd(v) : 'Any'}</option>)}
            </select></label>
          <label>Genre
            <select class="select" value={f.genre} onChange={e => set({ genre: (e.target as HTMLSelectElement).value })}>
              <option value="">Any</option>{genres.map(g => <option key={g} value={g}>{g}</option>)}
            </select></label>
          <label>Country
            <select class="select" value={f.country} onChange={e => set({ country: (e.target as HTMLSelectElement).value })}>
              <option value="">Any</option>{ctx.index.countries.map(c => <option key={c} value={c}>{country(c)}</option>)}
            </select></label>
          <label>Claim word
            <select class="select" value={f.claim} onChange={e => set({ claim: (e.target as HTMLSelectElement).value })}>
              <option value="">Any</option>{words(ctx.index.riskyWords).map(w => <option key={w} value={w}>{w}</option>)}
            </select></label>
          <label>iPad
            <select class="select" value={f.iPad} onChange={e => set({ iPad: (e.target as HTMLSelectElement).value })}>
              <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
            </select></label>
        </div>
      )}
      <div class="summary">
        {n(list.length)} apps · {compact(total)} ratings · median {n(median(list.map(a => a.ratings)) ?? 0)} ·
        avg rating {total ? (wsum / total).toFixed(2) : '—'} ★ · {n(list.filter(a => a.week !== undefined).length)} with a weekly plan
      </div>
      {!list.length ? <Empty>No apps match these filters.</Empty> : (
        <div class="table-wrap">
          <table class="t">
            <thead>
              <tr>
                <th style={{ cursor: 'default' }} />
                {head('name', 'App')}{head('dev', 'Developer')}{head('rating', '★', true)}{head('ratings', 'Ratings', true)}
                {head('g7', '+7 d', true)}{head('g30', '+30 d', true)}{head('released', 'Released')}{head('updated', 'Updated')}
                {head('week', 'Weekly', true)}{head('countries', 'Countries', true)}
                {f.status !== 'active' && head('removedAt', 'Removed')}
              </tr>
            </thead>
            <tbody>
              {list.slice(0, limit).map(a => (
                <tr key={a.id} onClick={() => ctx.open(a.id)}>
                  <td>{a.icon ? <img class="ico" src={a.icon} loading="lazy" alt="" /> : <span class="ico" style={{ display: 'inline-block' }} />}</td>
                  <td class="name" title={a.name}>{a.name}</td>
                  <td class="name muted" style={{ maxWidth: '200px' }} title={a.dev}>{a.dev}</td>
                  <td class="r num">{a.ratings ? a.rating.toFixed(1) : '—'}</td>
                  <td class="r num">{n(a.ratings)}</td>
                  <td class="r num" style={{ color: (a.g7 ?? 0) > 0 ? 'var(--accent)' : undefined }}>{signed(a.g7)}</td>
                  <td class="r num" style={{ color: (a.g30 ?? 0) > 0 ? 'var(--accent)' : undefined }}>{signed(a.g30)}</td>
                  <td class="muted">{date(a.released, true)}</td>
                  <td class="muted">{date(a.updated, true)}</td>
                  <td class="r num">{a.week === undefined ? '' : a.iapCountry === 'us' ? usd(a.week) : <span class="dim" title={`price in ${a.iapCountry?.toUpperCase()} currency`}>{a.week}</span>}{a.trial ? ' · T' : ''}</td>
                  <td class="r num">{a.countries.length}</td>
                  {f.status !== 'active' && <td class="muted" style={{ color: a.removedAt ? 'var(--red)' : undefined }}>{a.removedAt ? date(a.removedAt) : ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > limit && <button class="btn ghost more" onClick={() => setLimit(limit + 500)}>Show more ({n(list.length - limit)})</button>}
    </Card>
  )
}
