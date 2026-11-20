import type { Category, StoreApp } from './model.ts'

function pattern(p: string, where: string): RegExp | undefined {
  if (!p.trim()) return undefined
  try {
    return new RegExp(p, 'iu')
  } catch (e) {
    // an invalid rule must fail loudly, not silently switch itself off
    throw new Error(`invalid regex in ${where}: ${(e as Error).message}`)
  }
}

/** Compiled matcher for a category: genre, then name rules, then description context, then exclusions. */
export class Classifier {
  private genres: Set<string>
  private strong?: RegExp
  private name?: RegExp
  private desc?: RegExp
  private context?: RegExp
  private exclude?: RegExp

  constructor(c: Category) {
    this.genres = new Set(c.genres)
    this.strong = pattern(c.strong, `${c.id}.strong`)
    this.name = pattern(c.namePattern, `${c.id}.namePattern`)
    this.desc = pattern(c.descPattern, `${c.id}.descPattern`)
    this.context = pattern(c.context, `${c.id}.context`)
    this.exclude = pattern(c.exclude, `${c.id}.exclude`)
    if (!this.strong && !this.name) throw new Error(`${c.id}: needs "strong" or "namePattern"`)
  }

  matches(a: StoreApp): boolean {
    if (this.genres.size && !this.genres.has(a.primaryGenreName ?? '')) return false
    const n = a.trackName, d = a.description ?? ''
    const descHit = this.desc?.test(d) ?? false
    if (!(this.strong?.test(n) || (this.name?.test(n) && descHit))) return false
    if (this.context && !descHit && !this.context.test(n + ' ' + d.slice(0, 400))) return false
    if (this.exclude?.test(n)) return false
    return true
  }
}
