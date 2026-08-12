# Decisions

Every judgement call made while building the design system, the theme and
wallpaper features, and the observability stack — and why.

This exists because the brief was "take all the decisions yourself". Where a
decision is genuinely reversible I have said so, and where I have gone against
something previously written down I have said that too rather than quietly
routing around it.

Feature-level decisions with roadmap consequences also live in
[docs/prd/chatify-prd.md](docs/prd/chatify-prd.md) as `DEC-*` entries. This file
is the full set, including the ones too small for the PRD.

---

## The two things I did not do

**Nothing was pushed to a remote.** All eleven commits are local, on
`fix/review-findings`. Publishing is yours.

**Your database was not touched.** `server/.env` points at a shared Atlas
cluster. Everything was verified against a throwaway in-memory MongoDB.

These are the only two places I overrode "do whatever you want" — both are
irreversible and outward-facing, and neither was necessary to finish the work.

---

## Design system

### D1 — Removed daisyUI rather than configuring it

**Why.** Its entire footprint was three things: chat bubbles (already fully
overridden inline), the `avatar` presence dot, and a tab strip already
neutralised with `bg-transparent`.

It was also actively broken. With no `themes` key configured, daisyUI v4 emits
`:root { color-scheme: light }` and swaps to dark only under
`prefers-color-scheme: dark`. **On a light-mode OS the chat-bubble tail, the
deleted-message bubble, the tab base and the presence dot were rendering light
inside an unconditionally dark app.** No amount of theme configuration closes
that fully, because the presence dot is a pseudo-element coloured by `--su` and
unreachable from a Tailwind class.

**Cost.** About 60 lines to re-implement three components. The stylesheet went
from 54.7 kB to 30.0 kB.

**Reversible?** Yes, but re-adopting it would mean re-inheriting the leak.

### D2 — Colours are channel triplets, not `rgb()` strings

`--surface: 15 23 42` rather than `--surface: rgb(15 23 42)`.

**Why.** Tailwind's `<alpha-value>` placeholder needs bare channels. Without
this, `bg-surface/60` cannot work — a variable that carries its own alpha cannot
have another applied. Every opacity modifier in the codebase depends on this
one choice.

### D3 — Glass is one component class, not utilities per element

`.glass` rather than `bg-surface/55 backdrop-blur-lg border border-line/15`
repeated everywhere.

**Why.** The entire problem this change set out to fix was that retuning the
look meant editing 22 files. Spraying utilities would have reproduced it exactly,
in a new palette.

### D4 — No `backdrop-filter` falls back to fully opaque

**Why.** A translucent panel without blur is not a degraded version of glass; it
is unreadable text over whatever happens to be behind it. Opaque is worse-looking
and correct.

### D5 — Glass is tuned per theme, not globally

Light themes run `--glass-opacity: 0.74` and `--glass-blur: 10px`; dark themes
run `0.55` and `16px`.

**Why.** The same values that read as frosted over near-black read as "slightly
dirty white" over near-white. Glassmorphism on a light background is a different
problem, not the same problem inverted.

### D6 — Six themes, two of them light

Midnight (default) · Abyss · Aurora · Ember · Daylight · Parchment.

**Why two light ones.** One light theme would have been a token gesture, and the
hard part — making glass work on a light ground — has to be solved once anyway.
Two forces the tokens to actually generalise.

### D7 — An inline script applies the theme before first paint

**Why.** React cannot do this. By the time a component mounts the browser has
painted a frame, so the default theme appears and then swaps — on every load.
The script is synchronous, inline, and ahead of the stylesheet, and is wrapped in
`try` because `localStorage` throws outright when cookies are blocked. A theme is
not worth a blank page.

### D8 — localStorage is the cache; the account is the truth

**Why.** They serve different jobs: the cache is what makes the no-flash script
possible, and the account is what makes a theme chosen on a phone follow you to a
laptop. On login the account wins and rewrites the cache.

### D9 — The theme survives logout

**Why.** It is as much a property of this device and this pair of eyes as of the
account. Resetting someone's light theme to dark because they signed out is
actively hostile — particularly to the people most likely to have chosen it.

### D10 — Themes are validated server-side against an enum

**Why.** An unknown value would persist happily and then be silently rejected by
the client on every render. That does not look like a validation failure; it
looks like the setting simply not working.

### D11 — The theme list is duplicated across client and server

**Why.** A shared import would couple the API's validation to the client bundle.
The server must reject an unknown theme whatever a client claims to support. The
lists are six entries long and change together, and a test asserts the CSS and
the registry agree.

### D12 — Extracted Modal, Avatar and IconButton

**Why.** The three dialogs were byte-identical copies of the same 40 lines. The
consolidation also picked up Escape-to-close, click-outside and focus management
— **none of the three had any of them**, and fixing that once beats fixing it
three times.

`IconButton` makes `label` required rather than optional, because those 18 call
sites were icons with no accessible name until an audit added them one at a time.

---

## Wallpaper

### D13 — Wallpaper lives in `participantState`, not on the conversation

**Why.** A wallpaper is a property of how *you* see a thread, not of the thread.
Storing it on the conversation would mean one person's choice changing what
everyone else sees. `participantState` already models exactly this shape for read
cursors and mute.

### D14 — A scrim sits between the wallpaper and the messages

**Why.** This is the whole feature. Glass bubbles over an arbitrary photo are
unreadable, and a user-chosen image is unknowable — it could be a white
screenshot. The scrim is floored per theme so no image can push text below its
contrast budget, and there is a test that checks the worst case (a pure-white
image on a dark theme).

Without this, the feature makes the app worse.

### D15 — Custom wallpapers must be on our own asset host

**Why.** Otherwise a "wallpaper" is an arbitrary URL the app renders for you,
which is a tracking pixel with extra steps. Uploads go through the existing
signed direct-upload path rather than a second one.

### D16 — Preset and custom URL are mutually exclusive

**Why.** Accepting both would leave the render order to decide which wins, which
is the kind of thing that behaves differently in two places six months later.

---

## Accessibility

### D17 — `prefers-reduced-transparency` *and* an in-app toggle

**Why.** Browser support for the media query is still thin, and plenty of people
want a solid UI without changing a system-wide setting. Supporting only the OS
signal would mean the people who need it most often cannot get it.

### D18 — Contrast is tested; class names are not

**Why.** Asserting class names pins the implementation and catches nothing real.
Contrast is the property that actually breaks when a palette is tweaked, it is
objectively measurable, and on a glass UI it is the thing most likely to degrade
quietly. 56 assertions across six themes, computed from the **composited** glass
surface rather than the raw token.

**It earned itself immediately:** Abyss's own-message bubble measured 4.06:1 for
white-on-violet, under AA. The accent was darkened until it cleared.

### D19 — `accent-ink` exists as a separate token

**Why.** White text on an accent fails on light themes. A token that names "the
colour that is legible *on* the accent" makes that a per-theme decision instead
of a bug discovered later.

---

## Logging and observability

### D20 — `pino`, and `BE-I-07` and `BE-I-06` done together

**Why together.** They were the same ~30 call sites. Doing them apart means
touching each one twice.

**Why pino.** Its overhead is low enough to leave on at info level without
thinking about it, and its redaction is declarative — a path list cannot be
forgotten at a call site the way a manual `delete` can.

### D21 — `AsyncLocalStorage` rather than a logger parameter

**Why.** `lib/*` is called from controllers, sockets and scripts. Threading a
logger through every signature would have been a larger and worse change than the
one it enables.

### D22 — Not `pino-http`

**Why.** It logs every request at info level. On a chat app that means a line per
read-receipt PATCH. Completions are logged at a level chosen by the status code
instead, so a healthy server is quiet and a broken one is not.

### D23 — Controllers no longer catch their own errors

**Why.** Thirty copies of the same six lines meant thirty places to forget the
log, thirty chances for the response shape to drift, and thirty hand-written
function names that go stale on rename. The central handler now owns it — and
logs the stack, which the previous handler dropped while also ignoring the
request, leaving nothing to debug from.

### D24 — Deleted the socket-auth line that logged names and ids

It logged `Socket authenticated for user: ${name} (${id})` on **every**
connection. That is the PII case `BE-I-07` named explicitly, and no amount of
redaction configuration fixes a line whose whole content is the thing you are
trying not to log.

### D25 — Tests run at `LOG_LEVEL=silent`

302 tests spraying JSON makes a genuine failure unfindable.

### D26 — `AuditEvent` has no field for message content

**Why.** It is what makes "an admin cannot read your messages" a property of the
schema rather than of a filter someone has to remember to apply. Metadata is
bounded on write for the same reason — without a cap, a controller could pass a
whole document.

### D27 — Audit events expire via a TTL index

90 days. Long enough to investigate something reported weeks later, short enough
that the collection does not become the largest thing in the database. A TTL
index means MongoDB enforces it, not a cleanup job somebody has to remember.

### D28 — Audit events and system messages both stay

**Why.** They answer different questions. System messages are in-band and
user-visible — "what happened in this chat". Audit events are structured and
queryable — "what happened to my account". Group actions write both.

### D29 — `recordEvent` never fails a request

**Why.** An audit write that 500s someone's message send is a worse outcome than
a missing audit row.

### D30 — Client error reports are authenticated

**Why.** An open write endpoint with a database behind it is a spam magnet, and
the reports are only useful with a user attached anyway.

### D31 — Over-budget reports get 202, not 429

**Why.** 429 invites a retry. A failed error report is never worth surfacing to
the person using the app, and never worth a second attempt.

### D32 — Only stack-frame lines are kept

**Why.** A thrown error's message can contain anything the app put in it, and
that includes message text. Lines that do not look like frames are dropped, and
the path loses its query string and hash because those carry conversation ids.

### D33 — Failed API calls are *not* reported

**Why.** They are already recorded server-side. Reporting them from the client
would double-count and drown the genuine signal.

### D34 — The admin view reads collections, never log files

**Strongest recommendation in this document.**

**Why.** A file-read endpoint on a production server is a path-traversal target
and would expose whatever redaction missed. On a PaaS the logs are not even
files. The two collections it does read are structured and redacted by
construction.

### D35 — `requireAdmin` at the router level, answering 404

**Router level** so a route added later cannot be left unguarded by omission.
**404 rather than 403** because a 403 confirms both that the route exists and
that admins exist — free reconnaissance.

### D36 — Two admin bootstrap paths

`ADMIN_EMAILS` promotes at login; `scripts/grantAdmin.js` works against a running
database.

**Why both.** The allowlist is convenient but needs a redeploy to change. The
script is how you recover when the allowlist is wrong or the first admin loses
access. Either alone has a failure mode with no way out.

### D37 — The overview reports no message or conversation counts

**Why.** An operator has no reason to know how much any individual is talking,
and a total invites the next request being "broken down by user".

---

## Decisions that contradict something previously written

### D38 — Amended the admin-console non-goal

The PRD listed *"moderation, compliance export, retention policy, admin
console"* as a non-goal. An operator view was then asked for directly.

**I amended the entry rather than working around it.** Building it quietly would
have left the document lying about the product. The carve-out is narrow —
moderation, compliance export and retention policy stay out — and is recorded as
`DEC-12` with the two properties that make it safe (D34, D26).

### D39 — Kept the PLT-01 contract step deferred

`Message.receiverId` is still written and never read. I did not take the
opportunity to finish removing it.

**Why.** Dropping a column is irreversible and cannot be verified until the
backfill has run against real data — which is yours to run, not mine.

---

## What I would flag for review

1. **`role` is a new global concept.** Chatify had only per-conversation group
   admin before. It is worth deciding whether you want a global role at all, now
   that one exists.
2. **The six themes are my taste.** The token architecture is the durable part;
   the palettes are cheap to change and I would expect you to.
3. **Nobody has run the app.** 476 tests and a clean build are not the same as
   opening it. The redesign touched every component.
4. **The Abyss accent is darker than a designer would probably pick.** It is
   where AA forced it. If you would rather keep the brighter violet, the honest
   fix is a darker `accent-ink`, not a lower bar.
