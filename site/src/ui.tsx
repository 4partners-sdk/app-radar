import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import type { EventKind } from './data.ts'
import { KIND, n, wordPattern, words } from './format.ts'

export function Card(p: { title?: string; sub?: string; right?: ComponentChildren; class?: string; children?: ComponentChildren }) {
  return (
    <section class={`card ${p.class ?? ''}`}>
      {(p.title || p.right) && (
        <div class="card-h">
          <div>
            {p.title && <h3>{p.title}</h3>}
            {p.sub && <div class="sub">{p.sub}</div>}
          </div>
          {p.right}
        </div>
      )}
      {p.children}
    </section>
  )
}

export function Kpi(p: { t: string; v: ComponentChildren; s?: ComponentChildren }) {
  return (
    <div class="kpi">
      <div class="t">{p.t}</div>
      <div class="v">{p.v}</div>
      {p.s && <div class="s">{p.s}</div>}
    </div>
  )
}

export function Seg<T extends string | number>(p: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg">
      {p.options.map(([v, label]) => (
        <button key={String(v)} class={v === p.value ? 'on' : ''} onClick={() => p.onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

export const Chip = (p: { kind: EventKind }) => <span class={`chip k-${p.kind}`}>{KIND[p.kind]}</span>

export const Empty = (p: { children: ComponentChildren }) => <div class="empty">{p.children}</div>

/** text with watched keywords marked */
export function Highlight(p: { text: string; words: string }) {
  const list = words(p.words)
  if (!list.length || !p.text) return <>{p.text}</>
  const hits: [number, number][] = []
  for (const w of list) for (const m of p.text.matchAll(wordPattern(w))) hits.push([m.index!, m.index! + m[0].length])
  hits.sort((a, b) => a[0] - b[0])
  const out: ComponentChildren[] = []
  let at = 0
  for (const [s, e] of hits) {
    if (s < at) continue
    out.push(p.text.slice(at, s), <mark>{p.text.slice(s, e)}</mark>)
    at = e
  }
  out.push(p.text.slice(at))
  return <>{out}</>
}

/** vertical bars with a value on top */
export function Bars(p: { data: { label: string; value: number; title?: string }[]; height?: number; color?: string; showValues?: boolean }) {
  const h = p.height ?? 180
  const max = Math.max(1, ...p.data.map(d => d.value))
  const w = 100 / Math.max(1, p.data.length)
  return (
    <div>
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" width="100%" height={h} role="img">
        {p.data.map((d, i) => {
          const bh = (d.value / max) * (h - 18)
          return (
            <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={h - bh} height={Math.max(bh, d.value ? 1 : 0)} rx={0.6}
              fill={p.color ?? 'var(--accent)'}><title>{`${d.title ?? d.label}: ${n(d.value)}`}</title></rect>
          )
        })}
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${p.data.length}, 1fr)`, fontSize: '11px', color: 'var(--dim)', textAlign: 'center' }}>
        {p.data.map((d, i) => (
          <div key={i} style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {p.showValues !== false && <div class="num" style={{ color: 'var(--muted)' }}>{d.value ? n(d.value) : ''}</div>}
            {d.label}
          </div>
        ))}
      </div>
    </div>
  )
}

/** stacked bars per day */
export function Stacked(p: { days: { label: string; parts: Partial<Record<EventKind, number>> }[]; kinds: EventKind[]; colors: Record<EventKind, string>; height?: number }) {
  const h = p.height ?? 170
  const [tip, setTip] = useState('')
  const max = Math.max(1, ...p.days.map(d => p.kinds.reduce((s, k) => s + (d.parts[k] ?? 0), 0)))
  const w = 100 / Math.max(1, p.days.length)
  const every = Math.ceil(p.days.length / 10)
  return (
    <div>
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" width="100%" height={h} onMouseLeave={() => setTip('')}>
        {p.days.map((d, i) => {
          let y = h
          return (
            <g key={i} onMouseEnter={() => setTip(`${d.label}: ` + p.kinds.filter(k => d.parts[k]).map(k => `${KIND[k]} ${d.parts[k]}`).join(' · ') || `${d.label}: no changes`)}>
              <rect x={i * w} width={w} y={0} height={h} fill="transparent" />
              {p.kinds.map(k => {
                const v = d.parts[k] ?? 0
                if (!v) return null
                const bh = (v / max) * (h - 4)
                y -= bh
                return <rect key={k} x={i * w + w * 0.12} width={w * 0.76} y={y} height={bh} fill={p.colors[k]} />
              })}
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${p.days.length}, 1fr)`, fontSize: '10.5px', color: 'var(--dim)' }}>
        {p.days.map((d, i) => <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'visible' }}>{i % every === 0 ? d.label : ''}</div>)}
      </div>
      <div class="chart-tip">{tip}</div>
      <div class="legend">{p.kinds.map(k => <span key={k} style={{ '--c': p.colors[k] }}>{KIND[k]}</span>)}</div>
    </div>
  )
}

/** line over days with optional markers (versions) */
export function Line(p: { points: [number, number][]; marks?: { x: number; label: string }[]; height?: number; format: (x: number) => string }) {
  const h = p.height ?? 160
  const [tip, setTip] = useState('')
  if (p.points.length < 2) return <Empty>Not enough points yet — the history grows with every check.</Empty>
  const xs = p.points.map(q => q[0]), ys = p.points.map(q => q[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const X = (x: number) => ((x - x0) / Math.max(1, x1 - x0)) * 100
  const Y = (y: number) => h - 6 - ((y - y0) / Math.max(1, y1 - y0)) * (h - 12)
  const d = p.points.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(2)},${Y(q[1]).toFixed(1)}`).join(' ')
  return (
    <div>
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" width="100%" height={h} onMouseLeave={() => setTip('')}>
        {(p.marks ?? []).filter(m => m.x >= x0 && m.x <= x1).map((m, i) => (
          <line key={i} x1={X(m.x)} x2={X(m.x)} y1={0} y2={h} stroke="var(--violet)" stroke-width="0.4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke">
            <title>{m.label}</title>
          </line>
        ))}
        <path d={d} fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" />
        {p.points.map((q, i) => (
          <rect key={i} x={X(q[0]) - 1} width={2} y={0} height={h} fill="transparent" onMouseEnter={() => setTip(`${p.format(q[0])}: +${n(q[1] - ys[0])} since the start`)} />
        ))}
      </svg>
      <div class="chart-tip">{tip || `${p.format(x0)} — ${p.format(x1)} · +${n(y1 - ys[0])} ratings`}</div>
    </div>
  )
}

/** horizontal bars with labels */
export function HBars(p: { rows: { label: ComponentChildren; value: number; text?: string }[]; color?: string }) {
  const max = Math.max(1, ...p.rows.map(r => r.value))
  return (
    <div>
      {p.rows.map((r, i) => (
        <div class="bar-row" key={i}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
          <div class="track"><div class="fill" style={{ width: `${(r.value / max) * 100}%`, background: p.color }} /></div>
          <div class="num muted">{r.text ?? n(r.value)}</div>
        </div>
      ))}
    </div>
  )
}

export function AppLink(p: { id: number; name: string; icon?: string; open: (id: number) => void }) {
  return (
    <span class="link" onClick={() => p.open(p.id)} title={p.name}>
      {p.icon && <img class="ico" src={p.icon} loading="lazy" alt="" style={{ marginRight: '8px', width: '18px', height: '18px' }} />}
      {p.name}
    </span>
  )
}
