export const DAY = 86_400_000
export const HOUR = 3_600_000

export const verbose = process.argv.includes('--verbose') || !!process.env.CI
export function log(...a: unknown[]) {
  if (verbose) console.error(new Date().toISOString().slice(11, 19), ...a)
}

/** Epoch day number of a date in the given time zone: groups checks by the local calendar day. */
export function dayNumber(d: Date, tz: string): number {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  return Math.round(Date.parse(p + 'T00:00:00Z') / DAY)
}

export function localHour(d: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d))
}

export function dayString(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10)
}

/** Runs `work` over `inputs` with at most `width` in flight; results keep the input order. */
export async function pool<I, O>(inputs: I[], width: number, work: (x: I) => Promise<O>, onDone?: () => void) {
  const out: ({ ok: true; value: O } | { ok: false; error: unknown })[] = new Array(inputs.length)
  let next = 0
  async function lane() {
    while (next < inputs.length) {
      const i = next++
      try { out[i] = { ok: true, value: await work(inputs[i]) } } catch (error) { out[i] = { ok: false, error } }
      onDone?.()
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, inputs.length) }, lane))
  return inputs.map((input, i) => ({ input, result: out[i] }))
}

export function chunks<T>(a: T[], n: number): T[][] {
  const r: T[][] = []
  for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n))
  return r
}

export function wordList(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

const wordCache = new Map<string, RegExp>()
/** Whole-word, case-insensitive: "AI" must not match "email". */
export function hasWord(text: string, word: string): boolean {
  let re = wordCache.get(word)
  if (!re) {
    re = new RegExp('(?<![\\p{L}\\p{N}])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'iu')
    wordCache.set(word, re)
  }
  return re.test(text)
}

export function wordsIn(text: string, raw: string): string[] {
  return wordList(raw).filter(w => hasWord(text, w))
}
