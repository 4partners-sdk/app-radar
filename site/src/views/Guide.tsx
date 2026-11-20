import type { ComponentChildren } from 'preact'
import type { Ctx } from '../main.tsx'
import { Chip } from '../ui.tsx'

const REPO = 'https://github.com/4partners-sdk/app-radar'

function Section(p: { id: string; title: string; children: ComponentChildren }) {
  return (
    <section class="guide-sec" id={`guide-${p.id}`}>
      <h3>{p.title}</h3>
      {p.children}
    </section>
  )
}

const SECTIONS: [string, string][] = [
  ['what', 'What App Radar does'], ['when', 'When it checks'], ['tabs', 'The tabs'], ['watchers', 'Watchers'],
  ['slack', 'Slack alerts'], ['words', 'What the words mean'], ['wrong', 'When something looks wrong'], ['change', 'Changing things'],
]

/** How to use the site, in one place — so nobody has to explain it twice. */
export function Guide(ctx: Ctx) {
  const ix = ctx.index
  const hour = `${String(ix.dailyHour).padStart(2, '0')}:00`
  const tz = ix.timezone.split('/').pop()?.replace(/_/g, ' ')
  const cats = ix.categories.filter(c => c.enabled).map(c => c.name).join(', ')
  const go = (tab: string) => (e: Event) => { e.preventDefault(); ctx.go(tab) }
  const tab = (id: string, label: string) => <a class="link" href={`#/${ctx.cat}/${id}`} onClick={go(id)}>{label}</a>
  return (
    <div class="grid">
      <div class="card s12 guide">
        <h2>How to use App Radar</h2>
        <p class="dim">A team dashboard for the App Store: what appears, changes and disappears in our categories, plus Slack alerts for the apps we care about most.</p>
        <nav class="guide-toc">
          {SECTIONS.map(([id, title]) => <a key={id} class="chip-btn" href={`#guide-${id}`} onClick={e => { e.preventDefault(); document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth' }) }}>{title}</a>)}
        </nav>

        <Section id="what" title="What App Radar does">
          <ul>
            <li>Every day it finds every app in our categories — <b>{cats}</b> — in {ix.countries.length} storefronts ({ix.countries.map(c => c.toUpperCase()).join(' ')}) and records ratings, versions, prices and where each app is live.</li>
            <li>From the difference between checks it shows what happened: new apps, updates, apps that took off, and apps removed from the App Store (bans).</li>
            <li>It sends Slack alerts for removals and for bad reviews of the apps on the <b>watch list</b> (the {tab('watchers', 'Watchers')} tab).</li>
            <li>History is kept for {ix.retentionDays} days. The category selector at the top left switches between categories; every tab except Watchers and this guide shows the selected one.</li>
          </ul>
        </Section>

        <Section id="when" title="When it checks">
          <ul>
            <li><b>Full check</b> — once a day after {hour} ({tz} time), about 8 minutes. The header shows when the last one ran.</li>
            <li><b>Removal recheck</b> — about 3 hours later: apps missing in the morning are looked up again, so a ban is confirmed the same day.</li>
            <li><b>Watched apps</b> — every {ix.watchEveryHours} hours, and right after an app is added: reviews and where it is live.</li>
            <li><b>Weekly</b> — subscription prices of the top {ix.pricesTop} apps per category.</li>
            <li><b>Refresh now</b> (top right) starts a full check right away. Everyone sees it running; a second press does nothing until it finishes, and open pages reload by themselves when the new data is in.</li>
          </ul>
        </Section>

        <Section id="tabs" title="The tabs">
          <dl class="guide-dl">
            <dt>{tab('overview', 'Overview')}</dt>
            <dd>The last 7 days at a glance: how many apps were found, released, removed, returned and updated, changes by day, the latest events and the developers with the most apps.</dd>
            <dt>{tab('events', 'Events')}</dt>
            <dd>Everything that happened, newest first: <Chip kind="released" /> <Chip kind="discovered" /> <Chip kind="updated" /> <Chip kind="boosted" /> <Chip kind="removed" /> <Chip kind="pulled" /> <Chip kind="returned" />. Turn types on and off with their buttons (Updated is off at first), or search an app or developer.</dd>
            <dt>{tab('apps', 'Apps')}</dt>
            <dd>Every tracked app as a table — in the store, removed, or all. Sort by a column's header, filter by genre, search by app, developer or bundle ID. Click an app for its card.</dd>
            <dt>{tab('removals', 'Removals')}</dt>
            <dd>Bans: removed apps with the window in which they disappeared, removals by day, whole developers wiped at once, apps pulled from single countries, apps that came back, and which kinds of apps get removed more often than average.</dd>
            <dt>{tab('insights', 'Insights')}</dt>
            <dd>The market: trending apps (new ratings, a proxy for installs), rising newcomers, updates that worked, fresh updates of the leaders, feature trends in release notes, top developers, releases per month and storefronts.</dd>
            <dt>{tab('prices', 'Prices')}</dt>
            <dd>Subscription prices of the leaders in the US store: weekly and yearly plans, medians, trials, and each leader's plans.</dd>
            <dt>{tab('watchers', 'Watchers')}</dt>
            <dd>The watch list and the reviews of its apps — see below.</dd>
            <dt>App card</dt>
            <dd>Click any app anywhere: ratings growth with its releases marked, ratings by country, versions and how ratings reacted, in-app purchases, screenshots and the start of its description.</dd>
          </dl>
        </Section>

        <Section id="watchers" title="Watchers">
          <ul>
            <li>The apps whose <b>bad reviews</b> and <b>removals</b> go to Slack — our own apps, or anyone's we want to follow closely. Up to 25.</li>
            <li><b>Add:</b> paste an App Store link (or just the id — the digits after <code>id</code> in the link) and press Add. Its first check starts right away when nothing else is running, otherwise with the next hourly run. If the App Store doesn't answer at that moment, the app shows a temporary name until that check.</li>
            <li><b>Remove:</b> the Remove button next to the app. Anyone with the site login can add and remove; the list shows who added what.</li>
            <li>The <b>first check</b> only learns where the app is live and remembers its current reviews, so adding an app never floods Slack with old ones. From then on every new bad review is sent.</li>
            <li>A <b>bad review</b> is 1–2 stars, or any rating with alarm words such as refund, scam, charged, cancel, subscription, not working. Only reviews from the last 3 days are sent; the App Store sometimes publishes reviews days late.</li>
            <li>Reviews come from the App Store's public feed: the latest 50 per storefront. Reply to them in App Store Connect with the <b>Reply in ASC</b> link.</li>
            <li>Watched apps that are also in a category show up in both places: the category tracks them every day, Watchers adds reviews and checks every {ix.watchEveryHours} hours.</li>
          </ul>
        </Section>

        <Section id="slack" title="Slack alerts">
          <dl class="guide-dl">
            <dt>🚫 Category: removed from the App Store</dt>
            <dd>After the daily check or the recheck: apps of a category that disappeared, the biggest first, with their ratings, storefronts and when they were last seen. Tags: <i>whole developer removed</i>, <i>removal wave</i>.</dd>
            <dt>👀 Watched apps</dt>
            <dd>🚫 removed from the App Store · 🌍 no longer in some countries (still live elsewhere) · ✅ back in the App Store.</dd>
            <dt>💬 New bad reviews</dt>
            <dd>Bad reviews of watched apps, with the reasons and links to reply in App Store Connect or open the App Store.</dd>
            <dt>⚠️ The collector failed</dt>
            <dd>A run broke; the message links to its log. If the same cause repeats every hour, it is sent once a day.</dd>
          </dl>
          <p class="dim">Want to see what they look like? <a class="link" href={`${REPO}/actions/workflows/slack-test.yml`} target="_blank" rel="noreferrer">Actions → slack-test → Run workflow</a> sends one of each, marked TEST.</p>
        </Section>

        <Section id="words" title="What the words mean">
          <dl class="guide-dl">
            <dt><Chip kind="released" /></dt><dd>Found for the first time and released in the last 30 days.</dd>
            <dt><Chip kind="discovered" /></dt><dd>Found for the first time but older — it just started showing up in our searches.</dd>
            <dt><Chip kind="removed" /></dt><dd>Gone from every storefront it was live in, on two checks in a row hours apart — one empty answer from Apple doesn't count. The time shown is a window: between the last check that saw it and the first that didn't.</dd>
            <dt><Chip kind="pulled" /></dt><dd>Gone from some countries while still live in others.</dd>
            <dt><Chip kind="returned" /></dt><dd>Back in the store after a removal.</dd>
            <dt><Chip kind="updated" /></dt><dd>A new version came out.</dd>
            <dt><Chip kind="boosted" /></dt><dd>In the 7 days after a release the app gained ratings at least 1.5× (and 2+ a day) faster than the 7 days before.</dd>
            <dt>Removal wave</dt><dd>5+ removals in a category within 24 hours, at least 3× the usual rate.</dd>
            <dt>Whole developer removed</dt><dd>Every app of one developer (2 or more) removed within 24 hours.</dd>
            <dt>Ratings growth</dt><dd>New ratings, our stand-in for installs. Counted only in storefronts an app was already in, so appearing in a new country doesn't look like a jump.</dd>
          </dl>
        </Section>

        <Section id="wrong" title="When something looks wrong">
          <ul>
            <li><b>“No new data for over a day”</b> at the top, or <b>Last update failed</b> next to Refresh: open <a class="link" href={`${REPO}/actions`} target="_blank" rel="noreferrer">GitHub Actions</a> and look at the latest red run; Slack also gets a message with its log.</li>
            <li><b>Refresh does nothing:</b> a check is already running — wait for it, the page reloads by itself.</li>
            <li><b>An app is missing from a category:</b> it is found through searches; if it never shows up in them, add it to Watchers to follow it anyway.</li>
            <li><b>The site asks for the password again:</b> it's one shared login for the team — ask whoever set it up.</li>
          </ul>
        </Section>

        <Section id="change" title="Changing things">
          <ul>
            <li><b>Watch list:</b> right here, in {tab('watchers', 'Watchers')}.</li>
            <li><b>Categories, search terms, countries, check time, review words, retention:</b> files in <code>config/</code> of the <a class="link" href={REPO} target="_blank" rel="noreferrer">app-radar repository</a>; the README there explains each.</li>
            <li>The data itself is encrypted and kept in a private repository; the code repository is public, so never put passwords or tokens in it.</li>
          </ul>
        </Section>
      </div>
    </div>
  )
}
