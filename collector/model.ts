// Shapes of the collector's state (data/state/*.json) and of what the App Store returns.

/** One row of the iTunes Search / Lookup API. */
export interface StoreApp {
  trackId: number
  trackName: string
  artistName: string
  artistId?: number
  trackViewUrl: string
  primaryGenreName?: string
  description?: string
  averageUserRating?: number
  userRatingCount?: number
  releaseDate?: string
  version?: string
  currentVersionReleaseDate?: string
  releaseNotes?: string
  price?: number
  formattedPrice?: string
  languageCodesISO2A?: string[]
  fileSizeBytes?: string
  minimumOsVersion?: string
  supportedDevices?: string[]
  contentAdvisoryRating?: string
  genres?: string[]
  bundleId?: string
  sellerUrl?: string
  artworkUrl512?: string
  artworkUrl100?: string
  screenshotUrls?: string[]
}

export interface Category {
  id: string
  name: string
  enabled: boolean
  terms: string[]
  /** primary genres to accept; empty = any */
  genres: string[]
  /** name matching this qualifies on its own */
  strong: string
  /** …or name matching namePattern AND description matching descPattern */
  namePattern: string
  descPattern: string
  /** if set, the description (or name) must also match this */
  context: string
  /** name matching this is always dropped */
  exclude: string
}

export interface Settings {
  timezone: string
  dailyHour: number
  recheckAfterHours: number
  retentionDays: number
  countries: string[]
  pricesTop: number
  pricesEveryDays: number
  /** spread the new-app searches over this many days (known apps are still checked daily) */
  searchRotationDays?: number
  /** the daily check's requests are split across this many GitHub Actions jobs (each gets its own IP and Apple limit) */
  parallelJobs?: number
  /** how often the watched apps' reviews and presence are read (the daily check reads them too) */
  watchEveryHours?: number
  /** who a watched app's removal pings in Slack: "channel" (default), "here" or "" (nobody) */
  watchAlarm?: string
  reviewMaxStars: number
  reviewWords: string
  riskyWords: string
  featureWords: string
}

export interface Meta {
  version: string
  /** release date of the current version */
  updatedAt?: string
  notes: string
  price: number
  formattedPrice: string
  languages: string[]
  sizeBytes: number
  minOS: string
  iPad: boolean
  ageRating: string
  genres: string[]
  bundleId: string
  sellerURL?: string
  icon?: string
  screenshots: string[]
  /** start of the store description, for claim words */
  desc?: string
}

export interface Version {
  version: string
  date: string
  notes: string
  /** false for the version that was already live when tracking started */
  seen: boolean
  /** ratings per day in the 7 days before / after the release */
  before?: number
  after?: number
  measured?: boolean
}

export interface InAppItem {
  name: string
  priceText: string
  price?: number
}

/** Ratings growth that only counts storefronts present on both sides of each step. */
export type GrowthPoint = [day: number, cumulative: number]

export interface App {
  id: number
  name: string
  developer: string
  developerId?: number
  url: string
  genre: string
  releaseDate?: string
  firstSeen: string
  lastSeen: string
  /** storefronts the app is live in (among watched) */
  countries: string[]
  /** latest [ratings, average] per storefront */
  byCountry: Record<string, [number, number]>
  /** sum of byCountry over live, watched storefronts */
  ratings: number
  /** weighted average */
  rating: number
  growth: GrowthPoint[]
  meta?: Meta
  versions?: Version[]
  /** consecutive checks the app was missing from every storefront */
  missing?: number
  missingSince?: string
  removedAt?: string
  removalTags?: string[]
  countryMiss?: Record<string, { n: number; since: string }>
  pulledFrom?: Record<string, string>
  inApp?: InAppItem[]
  hasInApp?: boolean
  inAppAt?: string
  inAppCountry?: string
}

export type EventKind = 'released' | 'discovered' | 'removed' | 'returned' | 'pulled' | 'updated' | 'boosted'

export interface WatchEvent {
  date: string
  kind: EventKind
  appId: number
  name: string
  developer: string
  url: string
  countries?: string[]
  note?: string
}

export interface Run {
  date: string
  mode: 'daily' | 'recheck'
  duration: number
  active: number
  counts: Partial<Record<EventKind, number>>
  baseline?: boolean
  failed?: boolean
  error?: string
}

export interface CategoryState {
  apps: Record<string, App>
  events: WatchEvent[]
  runs: Run[]
}

export interface Review {
  id: string
  appId: number
  country: string
  rating: number
  title: string
  text: string
  version: string
  author: string
  date: string
  reasons: string[]
  /** read on a storefront's first pass — history, never alerted */
  baseline?: boolean
}

/** An app on the watch list. The list is edited on the site and kept as watchers.json in the data repository. */
export interface WatchedApp {
  id: number
  name: string
  developer?: string
  icon?: string
  addedAt?: string
  /** the site login that added it */
  addedBy?: string
}

/** Where a watched app is in the App Store, as of the last check. */
export interface WatchState {
  /** absent until the first check, which only learns where the app is live */
  checkedAt?: string
  /** storefronts the app is live in (among watched) */
  countries: string[]
  lastSeen?: string
  /** consecutive checks the app was missing from every storefront it is live in */
  missing?: number
  missingSince?: string
  removedAt?: string
  /** consecutive misses in one storefront while the app is live elsewhere */
  countryMiss?: Record<string, { n: number; since: string }>
  /** storefront → since when the app is gone from it */
  pulled?: Record<string, string>
  /** as the App Store lists it now */
  name?: string
  developer?: string
  icon?: string
}

export interface GlobalState {
  /** last successful daily run (any category checked) */
  lastDaily?: string
  lastRecheck?: string
  lastPrices?: string
  /** last read of the watched apps' reviews and presence */
  lastReviews?: string
  /** review ids already seen, per app and storefront */
  seen: Record<string, Record<string, string[]>>
  reviews: Review[]
  /** the watch list as of the last check (the dashboard shows it) */
  watchers?: WatchedApp[]
  /** per watched app id */
  watch?: Record<string, WatchState>
}
