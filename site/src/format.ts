import type { EventKind } from './data.ts'

const nf = new Intl.NumberFormat('en-US')
const cf = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const regions = new Intl.DisplayNames(['en'], { type: 'region' })

export const n = (v: number | undefined | null) => (v === undefined || v === null ? '—' : nf.format(v))
export const compact = (v: number | undefined) => (v === undefined ? '—' : cf.format(v))
export const pct = (v: number) => (Number.isFinite(v) ? (v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0) + '%' : '—')
/** +1,234 / −56 / 0 */
export const signed = (v: number | undefined) => (v === undefined ? '—' : v > 0 ? '+' + nf.format(v) : v < 0 ? '−' + nf.format(-v) : '0')
export const usd = (v: number | undefined) => (v === undefined ? '—' : '$' + v.toFixed(2))
export const country = (c: string) => (c === 'xk' ? 'Kosovo' : regions.of(c.toUpperCase()) ?? c.toUpperCase())

let tz = 'Europe/Warsaw'
export const setTimezone = (z: string) => { tz = z }

export function date(iso: string | undefined, withYear = false): string {
  if (!iso) return '—'
  return new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-GB', {
    timeZone: tz, day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
  })
}

export function dateTime(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function ago(iso: string | undefined): string {
  if (!iso) return 'never'
  const m = (Date.now() - Date.parse(iso)) / 60_000
  if (m < 2) return 'just now'
  if (m < 60) return `${Math.round(m)} min ago`
  const h = m / 60
  if (h < 24) return `${Math.round(h)} h ago`
  const d = Math.round(h / 24)
  return `${d} ${d === 1 ? 'day' : 'days'} ago`
}

export const daysSince = (iso: string | undefined) => (iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : undefined)

export function age(days: number | undefined): string {
  // a release date in the future (pre-orders, odd listings) has no meaningful age
  if (days === undefined || days < 0) return '—'
  if (days < 60) return `${Math.round(days)} d`
  if (days < 730) return `${Math.round(days / 30.4)} mo`
  return `${(days / 365).toFixed(1)} yr`
}

export const KIND: Record<EventKind, string> = {
  released: 'New',
  discovered: 'Found',
  removed: 'Removed',
  returned: 'Returned',
  pulled: 'Pulled',
  updated: 'Updated',
  boosted: 'Update boost',
}

export const KIND_COLOR: Record<EventKind, string> = {
  released: 'var(--accent)',
  discovered: 'var(--blue)',
  removed: 'var(--red)',
  returned: 'var(--teal)',
  pulled: 'var(--amber)',
  updated: 'var(--dim)',
  boosted: 'var(--violet)',
}

/** notes the collector stores (removal tags, boost notes, errors), made a little friendlier */
export function storedText(s: string): string {
  return s
    .replace(/developer wiped \((\d+) apps\)/g, 'whole developer removed ($1 apps)')
    .replace(/sweep \((\d+) removed in 24h\)/g, 'removal wave ($1 in 24 h)')
    .replace(/Some requests failed: /g, 'No answer from: ')
}

export function median(v: number[]): number | undefined {
  if (!v.length) return undefined
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export function words(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

const wordRe = new Map<string, RegExp>()
export function wordPattern(w: string): RegExp {
  let re = wordRe.get(w)
  if (!re) {
    re = new RegExp('(?<![\\p{L}\\p{N}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'giu')
    wordRe.set(w, re)
  }
  re.lastIndex = 0
  return re
}
export const hasWord = (text: string, w: string) => wordPattern(w).test(text)
