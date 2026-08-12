# Chatify — Product Requirements

> **Status: 34 of 34 shipped, across 6 phases.** All phases are complete; see
> [Where Chatify is today](#where-chatify-is-today) for what still needs configuration.
> Every feature carries its phase and state. The [ID index](#id-index) at the end is the
> whole roadmap on one screen — if you read only one section, read that one.

This document says **what Chatify should become and why**. It does not say how to build it;
that lives in the code and, for engineering hardening, in [improvements.md](../../improvements.md).

---

## Contents

1. [How to read this](#how-to-read-this)
2. [Where Chatify is today](#where-chatify-is-today)
3. [Who it is for](#who-it-is-for)
4. [Product principles](#product-principles)
5. [Non-goals](#non-goals)
6. [PLT — Platform and data model](#plt--platform-and-data-model)
7. [MSG — Core messaging](#msg--core-messaging)
8. [GRP — Groups](#grp--groups)
9. [MED — Rich media and files](#med--rich-media-and-files)
10. [NTF — Notifications and presence](#ntf--notifications-and-presence)
11. [Decision log](#decision-log)
12. [Phasing](#phasing)
13. [Success signals](#success-signals)
14. [Open questions](#open-questions)
15. [ID index](#id-index)

---

## How to read this

### Where things belong

Chatify has three long-lived documents. They do not overlap, and the rule that keeps them
apart is one question:

> **Would a user notice if this shipped on its own?** Yes → this document. No → `improvements.md`.

| | **This document** | [improvements.md](../../improvements.md) | [bugs.md](../../bugs.md) |
|---|---|---|---|
| Owns | Capability and why — what people get | Hardening of what already exists | Defect record |
| Contains | User stories, acceptance criteria, phasing, decisions, non-goals | Debt, dependencies, tooling, perf, DX | 23 resolved findings |
| Voice | Future tense, user-facing | Present tense, engineer-facing | Past tense |
| States | Phase / ✅ Shipped | ✅ Done / ⬜ Open / 🟡 Partly | Fixed |

Applying that rule to the items people ask about most:

- **Pagination (`BE-I-05`) and windowing (`FE-I-04`)** stay in `improvements.md` — shipped
  alone, a user only notices "faster". But *"load older messages"* as an interaction is
  visible, so this document owns [`MSG-08`](#msg-08--conversation-history--phase-2) and names
  those two as dependencies without restating them.
- **Tests (`X-03`), CI (`X-04`), Zod validation (`X-05`)** stay entirely in
  `improvements.md`. They appear here once, as **release gates**: no phase ships without
  `X-03` covering its new endpoints and `X-05` schemas for its new request bodies.
- **Audio refactor (`FE-I-07`)** becomes load-bearing at Phase 5 and is listed as a
  dependency of [`NTF-06`](#ntf-06--notification-sounds--phase-5), nothing more.

**One deliberate exception**, called out so it does not read as inconsistent: the
Conversation migration ([`PLT-01`](#plt-01--the-conversation-model--phase-1)) is invisible to
users, but this document owns it. *When* to pay for it is a roadmap decision, not
engineering hygiene.

Cross-links run **one way only** — entries here carry a `Depends on` field pointing into
`improvements.md`. There are no per-item backlinks the other way; they rot. `improvements.md`
carries a single `Blocks` column on its "Still open" table.

### ID scheme

Prefixes are chosen not to collide with the existing `X-*`, `BE-I-*`, `FE-I-*` (improvements)
or `BE-*`, `FE-*` (bugs) namespaces:

| Prefix | Area |
|---|---|
| `PLT-` | Platform and data model |
| `MSG-` | Core messaging |
| `GRP-` | Groups |
| `MED-` | Rich media and files |
| `NTF-` | Notifications and presence |
| `DEC-` | Decision log |

Numbers are stable and never reused. A cut feature is marked `⬛ Dropped` and keeps its row.

### Entry shape

Every feature entry has the same six fields and is capped at roughly twelve lines. If an
entry needs more room, it is two features.

```
What         one sentence
Why now      one sentence — dependency- or value-based
Acceptance   3–5 observable bullets, no implementation
Impact       one line: data model / socket contract / API surface
Depends on   other IDs
Status       phase and state
```

---

## Where Chatify is today

A working one-to-one chat app. Stack, API reference and setup are in the
[root README](../../README.md) and are not repeated here. What follows is only what
*constrains the roadmap*:

- **Conversations are explicit as of `PLT-01`.** `Conversation` carries participants, a
  type and per-participant read cursors, and reads go through it. `Message.receiverId` is
  still written but no longer read — the contract step that removes it is deliberately
  held, because dropping a column is irreversible and cannot be verified until the backfill
  has run against real data.
- **The inbound socket surface is new and deliberately small.** `PLT-02` established it with
  two events. Arcjet still rate-limits HTTP only, so the socket budget is enforced by a
  per-socket token bucket rather than by Arcjet — anything added to that registry inherits
  validation and rate limiting, and anything added outside it does not.
- **Presence is scoped as of `PLT-05`.** A connect or disconnect notifies only the people
  who share a conversation with that user, as one delta rather than a full roster to
  everybody.
- **Push needs configuration to do anything.** Without `VAPID_PUBLIC_KEY` and
  `VAPID_PRIVATE_KEY` the app runs exactly as before and every send is a no-op — push is an
  enhancement, not a dependency. Generate a pair with `npx web-push generate-vapid-keys`.
- **The digest has no scheduler.** `buildDigestFor` and `markDigestSent` are written and
  tested; nothing calls them on a timer yet, because choosing a scheduler is a hosting
  decision.
- **Uploads go straight to Cloudinary as of `MED-01`.** The server issues a narrow,
  short-lived signature — folder and size are its decision, never the client's — and the file
  never transits the API. The old base64-in-JSON path remains only on the legacy
  `/api/messages` routes and on profile pictures.
- **Both halves now have a regression net.** `X-03` is closed: 69 server tests
  (mutation-checked) and 37 client tests covering component render plus the store's socket
  handling. That is the gate `PLT-01` was waiting on.

**Shipped since this document was opened — all of Phase 0:** read receipts and unread
badges ([`MSG-01`](#msg-01--read-receipts--phase-0), [`MSG-02`](#msg-02--unread-badges--phase-0)),
the global inbox listener ([`PLT-03`](#plt-03--global-inbox-listener--phase-0)), the inbound
socket contract ([`PLT-02`](#plt-02--inbound-socket-event-contract--phase-0)) and typing
indicators ([`MSG-03`](#msg-03--typing-indicators--phase-0)).

The inbound contract is hand-validated rather than Zod-backed, because `X-05` is still open.
It is written as one registry so that folding Zod in later is a change to that file alone.

---

## Who it is for

**The everyday correspondent.** Uses Chatify to keep in touch with a handful of people.
Cares that messages arrive, that they can tell whether they were read, and that nothing is
lost. Will not configure anything. Judges the product on whether the unread badge is right.

**The small group.** Four to twenty people — a household, a project, a club. Needs shared
conversation, needs to find things said last week, and needs to not be woken at 3am by a
chat they do not care about. Everything in Phases 3–5 exists for this persona.

Both are on mobile at least half the time.

---

## Product principles

1. **Correctness over immediacy.** Never show a receipt, count, or presence state that
   cannot be proven from persisted data. A badge that is wrong is worse than a badge that
   is late.
2. **One code path for direct and group.** Anything built only for one-to-one will be
   rewritten at Phase 4. Design for a participant list of size N from
   [`PLT-01`](#plt-01--the-conversation-model--phase-1) onward.
3. **The server is the source of truth.** The client may render optimistically, but it
   never owns state. Every optimistic update has a server correction path.
4. **Quiet by default.** New notification surfaces ship off, or scoped as narrowly as
   is defensible. It is easier to add noise than to earn back trust.
5. **No feature without a delete path.** Anything that stores user content needs an answer
   for removing it before it ships.
6. **Small dependency surface.** A new runtime dependency needs to earn its place against
   the maintenance cost of a solo-maintained project.

---

## Non-goals

Stated up front, because scope creep in a chat app is relentless. Each with its reason.

| Not doing | Why not |
|---|---|
| **End-to-end encryption** | Incompatible with server-side search, link unfurling and push payloads. Credible key management — device enrolment, rotation, recovery — is not a solo-project undertaking, and doing it badly is worse than not doing it. |
| **Voice and video calling** | WebRTC plus TURN infrastructure is a different product with a different operational burden. |
| **Message threads** | Distinct from reply/quote ([`MSG-05`](#msg-05--reply-and-quote--phase-2)). Threading is a whole navigation model, not a feature. |
| **Channels, workspaces, orgs, federation** | [`DEC-09`](#dec-09--conversation-type-as-a-single-field) leaves the door open with a `type` field. Walking through it is out of scope. |
| **Bots, webhooks, public API** | No audience for it. |
| **Native mobile apps** | A PWA with web push ([`NTF-01`](#ntf-01--web-push--phase-5)) is the ceiling. |
| **Moderation, compliance export, retention policy, admin console** | Presupposes an operator role the product does not have. |
| **Offline-first / CRDT sync** | Contradicts principle 3. The server stays authoritative. |
| **Internationalisation** | English only until there is a second-language user. |
| **Horizontal scaling of the socket tier** | **Deferred, not rejected.** The in-memory socket map binds the app to a single Node process. **Tripwire: revisit the moment a second process is needed**, at which point the answer is the Socket.IO Redis adapter — not a redesign. |

---

## PLT — Platform and data model

Nothing in this section is visible to a user. It is here because the sequencing is a product
decision: these are the things that get more expensive the longer they are deferred.

### PLT-01 — The conversation model — Phase 1

**What** Replace the implicit `senderId`/`receiverId` pair with a real `Conversation`
collection holding a participant list, and key messages to it.

**Why now** Every feature in Phases 2–5 either needs it or gets rewritten without it. Its
cost grows on two axes at once — message volume, and the number of call sites touching the
sender/receiver pair. It is a days-scale job now and a weeks-scale job after five more
features land on top of the old shape.

**Acceptance**
- Existing conversations survive with full history and correct ordering
- A user opening any existing chat sees exactly what they saw before
- Two users messaging each other for the first time *simultaneously* end up in one
  conversation, not two
- No message is orphaned by the migration; the backfill is verifiable by count

**Impact** Data model, API surface, socket payloads. The largest single change on the roadmap.

**Depends on** `X-03` — ✅ met

**Status** Phase 1 · ✅ Shipped (steps 1-3; the contract step is deliberately held — see below)

**Migration — four steps, in this order:**

1. **Expand.** Add `Conversation` with a normalized participant key and a unique index on
   it. Add a nullable `Message.conversationId`. Dual-write on send.
2. **Backfill.** Group existing messages by sorted participant pair, create the
   conversations, stamp `conversationId`. Idempotent and re-runnable.
3. **Migrate reads.** Point conversation loads and the chat-partner list at
   `conversationId`. Keep `GET /api/messages/:id` for one release as a thin
   user-id → conversation resolver, and introduce `/api/conversations/:id/messages` as the
   real surface.
4. **Contract.** Make `conversationId` required, drop `receiverId`
   ([`DEC-02`](#dec-02--drop-messagereceiverid-at-contract)) and the two participant-pair
   indexes it served.

**What breaks, recorded so it is not a surprise:** the `newMessage` socket payload gains
`conversationId` and the client's routing must key off it rather than the sender; the
optimistic message built on send fabricates a `receiverId` and must be reshaped; the read
receipts shipped in Phase 0 move to cursors
([`DEC-03`](#dec-03--per-message-status--read-cursors)). Rendering own-vs-other messages by
`senderId` is unaffected.

### PLT-02 — Inbound socket event contract — Phase 0

**What** A typed, validated, rate-limited set of client → server socket events, plus the
convention for adding more.

**Why now** Typing indicators need it, and it is the first inbound surface the app has ever
had. Establishing the contract with one low-stakes event is much cheaper than retrofitting
it across five.

**Acceptance**
- Every inbound event validates its payload and is rejected cleanly on mismatch
- A client cannot exceed a per-socket budget regardless of how it behaves
- The authenticated identity comes from the socket, never from the payload
- Adding a new inbound event requires no new plumbing

**Impact** Socket contract, security posture.

**Depends on** `X-05` (share the schemas with HTTP rather than growing a second validator)

**Status** Phase 0 · ✅ Shipped — see [`DEC-06`](#dec-06--inbound-socket-events-and-abuse-control)

### PLT-03 — Global inbox listener — Phase 0

**What** One socket subscription for the whole session instead of one per open conversation.

**Why now** Unread badges are impossible without it — the old per-conversation listener
discarded every message from a chat that was not on screen.

**Acceptance**
- Messages for any conversation update the sidebar, open or not
- Exactly one listener exists regardless of navigation or StrictMode double-mounting
- A logout/login cycle leaves no orphaned subscription

**Impact** Client architecture.

**Depends on** —

**Status** Phase 0 · ✅ Shipped

### PLT-04 — Conversation-scoped socket rooms — Phase 1

**What** Deliver messages via Socket.IO rooms keyed on conversation, rather than resolving
recipient socket ids in application code.

**Why now** Ships with [`PLT-01`](#plt-01--the-conversation-model--phase-1) because it is the
same change viewed from the transport side, and because application-level fan-out over a
participant list does not survive groups.

**Acceptance**
- A message reaches every participant's every open tab, once
- Joining and leaving a conversation is reflected in delivery immediately
- Delivery cost does not grow with the number of conversations a user is *not* looking at

**Impact** Socket contract.

**Depends on** `PLT-01`

**Status** Phase 1 · ✅ Shipped — see [`DEC-04`](#dec-04--rooms-over-application-level-fan-out)

### PLT-05 — Scoped presence — Phase 5

**What** Replace the global online-roster broadcast with presence scoped to the people a
user actually shares a conversation with.

**Why now** Last seen and do-not-disturb both need per-viewer authorization, which a
broadcast cannot express — and the current design leaks the full roster to every client.

**Acceptance**
- A user's online state is visible only to people they share a conversation with
- Connecting does not notify users who have no relationship to the connecting user
- Presence survives a reconnect without flicker

**Impact** Socket contract, privacy posture.

**Depends on** `PLT-01`, `PLT-02`

**Status** Phase 5 · ✅ Shipped — see [`DEC-05`](#dec-05--scoped-presence-over-a-global-broadcast)

---

## MSG — Core messaging

### MSG-01 — Read receipts — Phase 0

**What** Each outgoing message shows whether it was sent, delivered to the recipient's
device, or read by them.

**Why now** The single most-missed affordance in a one-to-one chat app, and the feature that
forced [`PLT-03`](#plt-03--global-inbox-listener--phase-0).

**Acceptance**
- A message to an offline recipient shows *sent*, and upgrades to *delivered* when they next
  connect — without the sender doing anything
- *Read* appears only when the recipient has the conversation open **and** their tab is on
  screen; a background tab does not read
- State never moves backwards, and survives a reload on both sides
- Status is conveyed to screen readers, not by tick shape alone

**Impact** Data model (`Message.status`), socket contract (3 new events), API surface
(`PATCH /messages/read/:id`).

**Depends on** `PLT-03`

**Status** Phase 0 · ✅ Shipped — revisited by [`DEC-03`](#dec-03--per-message-status--read-cursors)

### MSG-02 — Unread badges — Phase 0

**What** A per-conversation unread count in the sidebar, with a last-message preview and
most-recent-first ordering.

**Why now** Ships with [`MSG-01`](#msg-01--read-receipts--phase-0) — same data, same plumbing.

**Acceptance**
- The count is correct after a reload, not only while the socket is live
- Opening a conversation clears it in every one of that user's open tabs
- The conversation list is ordered by most recent activity
- A conversation with no messages yet does not appear as unread

**Impact** API surface (`/chats` response shape).

**Depends on** `MSG-01`, `PLT-03`

**Status** Phase 0 · ✅ Shipped

### MSG-03 — Typing indicators — Phase 0

**What** "X is typing…" in the conversation header while the other participant is composing.

**Why now** It is the smallest possible consumer of
[`PLT-02`](#plt-02--inbound-socket-event-contract--phase-0), which makes it the right feature
to prove that contract with.

**Acceptance**
- The indicator appears within a beat of the first keystroke and clears within a few seconds
  of the last one
- It clears when the composer is cleared, the message is sent, or the tab closes
- It is never persisted and never survives a reconnect
- Keystrokes are throttled — one held-down key does not become a broadcast per character

**Impact** Socket contract.

**Depends on** `PLT-02`

**Status** Phase 0 · ✅ Shipped

### MSG-04 — Edit and delete — Phase 2

**What** Edit or delete a message you sent, within a bounded window.

**Why now** Table stakes, and it must land before replies
([`MSG-05`](#msg-05--reply-and-quote--phase-2)) can define what a deleted parent looks like.

**Acceptance**
- An edited message is visibly marked as edited, with the original not recoverable by others
- Delete-for-everyone works within the window; after it, only delete-for-me
- A deleted message that has replies leaves a tombstone, not a hole
- Neither operation breaks pagination or reordering

**Impact** Data model, API surface, socket contract.

**Depends on** `PLT-01`, `X-05`

**Status** Phase 2 · ✅ Shipped — see [`DEC-08`](#dec-08--delete-semantics)

### MSG-05 — Reply and quote — Phase 2

**What** Reply to a specific message, with the quoted original shown above yours.

**Why now** The highest-value Phase 2 item and the one that makes group conversation legible
later.

**Acceptance**
- Tapping the quote jumps to the original, loading older history if needed
- A reply to a deleted message shows the tombstone, not a crash or a blank
- The quote survives an edit of the original by updating, not by going stale

**Impact** Data model, API surface.

**Depends on** `PLT-01`, `MSG-04`, `MSG-08`

**Status** Phase 2 · ✅ Shipped

### MSG-06 — Reactions — Phase 2

**What** Attach one or more emoji reactions to a message.

**Why now** Independent of everything else in Phase 2, cheap, and it absorbs a large share of
low-content replies — which makes every other list shorter.

**Acceptance**
- Reactions aggregate by emoji with a count and the list of who reacted
- Adding and removing is idempotent — double-tap does not double-count
- Reactions arrive live without a refresh
- A reaction does not bump the conversation to the top of the sidebar

**Impact** Data model, socket contract.

**Depends on** `PLT-01`

**Status** Phase 2 · ✅ Shipped

### MSG-07 — Message search — Phase 2

**What** Search message text, scoped to one conversation or across all of them.

**Why now** The value of search grows with history, so the sooner it exists the sooner it is
worth having.

**Acceptance**
- A result opens the conversation positioned at that message, with surrounding context
- Search only ever returns messages the searching user is a participant in
- An empty result is distinguishable from a failed search

**Impact** Data model (text index), API surface.

**Depends on** `PLT-01`, `MSG-08`

**Status** Phase 2 · ✅ Shipped — see [`DEC-10`](#dec-10--search-via-mongo-text)

### MSG-08 — Conversation history — Phase 2

**What** Open a conversation at its most recent messages and load older ones on demand.

**Why now** Long conversations currently transfer and render in full. This is the user-facing
half; the engineering half is already specced.

**Acceptance**
- Opening a long conversation is fast regardless of its length
- Scrolling up loads older messages without losing scroll position
- Reaching the beginning is signalled, not an infinite spinner
- A message arriving while scrolled up does not yank the view down

**Impact** API surface (pagination contract).

**Depends on** `BE-I-05`, `FE-I-04` — see [improvements.md](../../improvements.md)

**Status** Phase 2 · ✅ Shipped

### MSG-09 — Link previews — Phase 3

**What** A title, description and thumbnail card for URLs in messages.

**Why now** Rides along with Phase 3 — it is the same asynchronous enrich-after-send pattern
as media processing, and sharing links is most of what people paste.

**Acceptance**
- The preview resolves after send without blocking the message
- A URL that fails to unfurl degrades to a plain link, silently
- Fetching a preview cannot be used to make the server request internal addresses
- Previews are cached per URL, not re-fetched per message

**Impact** Data model, a new outbound network path.

**Depends on** `PLT-01`

**Status** Phase 3 · ✅ Shipped

### MSG-10 — Pin a message — Phase 4

**What** Pin messages to the top of a conversation.

**Why now** Low value in a one-to-one chat, real value in a group with shared context.

**Acceptance**
- Pinned messages are visible to every participant
- Unpinning is available to whoever can pin
- A deleted message unpins itself

**Impact** Data model.

**Depends on** `PLT-01`, `GRP-02`

**Status** Phase 4 · ✅ Shipped

---

## GRP — Groups

Everything in this section is blocked on
[`PLT-01`](#plt-01--the-conversation-model--phase-1). None of it is worth starting before the
participant list exists.

### GRP-01 — Group conversations — Phase 4

**What** A conversation with three or more participants, with a name and an avatar.

**Why now** The largest single expansion of what Chatify is for, and the reason the whole
data model was reshaped in Phase 1.

**Acceptance**
- Every participant sees the same message history from the point they joined
- Every message shows who sent it, unambiguously
- Read state is meaningful with N participants — it does not claim "read" because one
  person read it
- A group with one remaining participant still functions

**Impact** Data model, API surface, socket contract, most of the UI.

**Depends on** `PLT-01`, `PLT-04`, `DEC-03`

**Status** Phase 4 · ✅ Shipped

### GRP-02 — Roles and permissions — Phase 4

**What** Admin and member roles, with admin-only operations.

**Why now** Ships with [`GRP-01`](#grp-01--group-conversations--phase-4) — a group without a
way to remove someone is not shippable.

**Acceptance**
- A group always has at least one admin; the last one cannot leave without promoting someone
- Permission checks are enforced server-side, not merely hidden in the UI
- Role changes are visible to all participants

**Impact** Data model, API surface.

**Depends on** `GRP-01`

**Status** Phase 4 · ✅ Shipped

### GRP-03 — Member management — Phase 4

**What** Add and remove participants; leave a group.

**Why now** Same shipping unit as `GRP-01` and `GRP-02`.

**Acceptance**
- A new member's history visibility is explicit and consistent
- Removal takes effect immediately across every open session of the removed user
- Join and leave events are visible in the conversation
- A removed member cannot read subsequent messages by any route

**Impact** Data model, API surface, socket contract.

**Depends on** `GRP-01`, `GRP-02`

**Status** Phase 4 · ✅ Shipped

### GRP-04 — Mentions — Phase 4

**What** `@name` addressing that highlights and notifies the named participant.

**Why now** This is what makes group notification tolerable — without it, the only options
are "notify on everything" and "notify on nothing".

**Acceptance**
- Autocomplete offers only participants of the conversation
- A mention notifies even when the conversation is muted
- Mentions survive a display-name change
- A mention of a removed participant degrades to plain text

**Impact** Data model, notification routing.

**Depends on** `GRP-01`, `NTF-01`

**Status** Phase 4 · ✅ Shipped

### GRP-05 — Group read state — Phase 4

**What** Per-participant read state, surfaced as a "seen by" list rather than a single tick.

**Why now** [`MSG-01`](#msg-01--read-receipts--phase-0)'s per-message status is a
one-to-one concept. This is where it has to become per-participant.

**Acceptance**
- A sender can see who has read a message and who has not
- Read state costs the same to record whether the group has 3 or 30 members
- Unread counts remain correct as members join and leave

**Impact** Data model — the cursor migration from
[`DEC-03`](#dec-03--per-message-status--read-cursors).

**Depends on** `GRP-01`, `DEC-03`

**Status** Phase 4 · ✅ Shipped

---

## MED — Rich media and files

The whole section is gated on
[`DEC-07`](#dec-07--signed-direct-upload). The current base64-through-the-API path cannot
carry any of it.

### MED-01 — Signed direct uploads — Phase 3

**What** Upload straight from the browser to Cloudinary against a server-issued signature,
rather than inlining files in a JSON request body.

**Why now** It is the gate for everything else in this section, and it is the single largest
piece of work in Phase 3.

**Acceptance**
- A file never transits the API server
- A signature is single-use, scoped and short-lived
- Type and size limits are enforced somewhere the client cannot bypass
- Existing images continue to render unchanged

**Impact** API surface, upload pipeline, security posture.

**Depends on** `X-05`

**Status** Phase 3 · ✅ Shipped — see [`DEC-07`](#dec-07--signed-direct-upload)

### MED-02 — Upload progress and cancel — Phase 3

**What** A real progress indicator during upload, and the ability to cancel.

**Why now** Impossible before [`MED-01`](#med-01--signed-direct-uploads--phase-3); mandatory
after it, since the files get much larger.

**Acceptance**
- Progress reflects actual bytes transferred, not a fake animation
- Cancelling leaves no orphaned message and no orphaned remote asset
- A failed upload is retryable without re-selecting the file

**Impact** Client architecture.

**Depends on** `MED-01`

**Status** Phase 3 · ✅ Shipped

### MED-03 — Arbitrary file attachments — Phase 3

**What** Send any file type, shown with name, size and a type-appropriate icon.

**Why now** The most-requested thing the current image-only path cannot do.

**Acceptance**
- Download works on mobile and desktop
- Dangerous types are handled without pretending to be safe
- A file with no preview still shows enough to identify it

**Impact** Data model, UI.

**Depends on** `MED-01`

**Status** Phase 3 · ✅ Shipped

### MED-04 — Voice notes — Phase 3

**What** Record, send and play back a short voice message inline.

**Why now** The highest-value media type on mobile, and the one that most needs
[`MED-01`](#med-01--signed-direct-uploads--phase-3).

**Acceptance**
- Recording requires an explicit, revocable permission grant
- Playback shows duration and position, and does not restart on re-render
- A recording can be discarded before sending
- Playing one voice note stops any other

**Impact** Data model, UI, a new browser permission.

**Depends on** `MED-01`, `FE-I-07`

**Status** Phase 3 · ✅ Shipped

### MED-05 — Video — Phase 3

**What** Send video with an inline thumbnail and tap-to-play.

**Why now** Same pipeline as `MED-03`; the marginal cost after it is small.

**Acceptance**
- A thumbnail renders without downloading the whole video
- Playback is inline, not a forced download
- Oversized video is rejected before upload, not after

**Impact** Data model, upload pipeline.

**Depends on** `MED-01`

**Status** Phase 3 · ✅ Shipped

### MED-06 — Drag, drop and paste — Phase 3

**What** Attach by dragging a file onto the conversation or pasting from the clipboard.

**Why now** Cheap once `MED-01` and `MED-03` exist, and it is how people actually attach
things on desktop.

**Acceptance**
- The drop target is discoverable — the affordance appears on drag-over
- Pasting an image attaches it rather than inserting a data URI into the composer
- Multiple files at once are handled

**Impact** UI.

**Depends on** `MED-01`, `MED-03`

**Status** Phase 3 · ✅ Shipped

### MED-07 — Conversation media gallery — Phase 4

**What** A single view of every image and file shared in a conversation.

**Why now** Only worth building once there is enough media to be worth browsing.

**Acceptance**
- The gallery paginates rather than loading everything
- Each item links back to its message in context
- Deleting a message removes its item

**Impact** API surface.

**Depends on** `MED-03`, `MSG-08`

**Status** Phase 4 · ✅ Shipped

---

## NTF — Notifications and presence

Last by dependency count, not by importance. Most of the value here is unlocked by
[`GRP-04`](#grp-04--mentions--phase-4).

### NTF-01 — Web push — Phase 5

**What** Push notifications when the app is closed, via the Push API and a service worker.

**Why now** The point at which Chatify stops requiring a tab to be open, which is the
difference between a demo and something people rely on.

**Acceptance**
- Permission is requested in context, never on first load
- Tapping a notification opens the right conversation
- Notifications stop when the conversation is read elsewhere
- Revoking permission degrades cleanly and is recoverable

**Impact** New infrastructure — service worker, subscription storage, push credentials.

**Depends on** `PLT-01`, `NTF-04`

**Status** Phase 5 · ✅ Shipped

### NTF-02 — Desktop notifications — Phase 5

**What** OS-level notifications while the app is open but not focused.

**Why now** A fraction of `NTF-01`'s cost once the routing rules exist.

**Acceptance**
- Fires only when the tab is genuinely not visible
- Does not double up with an in-app indicator or with push
- Respects mute and do-not-disturb

**Impact** Client only.

**Depends on** `NTF-04`, `NTF-05`

**Status** Phase 5 · ✅ Shipped

### NTF-03 — Unread digest email — Phase 5

**What** A periodic email summarising unread messages for a user who has been away.

**Why now** The re-engagement path for users who never grant push. Resend is already wired in.

**Acceptance**
- Sends only for genuinely unread messages, per the read cursors
- Never sends twice for the same messages
- One-click unsubscribe that actually stops it
- Silent when there is nothing to report

**Impact** New scheduled job.

**Depends on** `DEC-03`, `NTF-05`

**Status** Phase 5 · ✅ Shipped

### NTF-04 — Per-conversation mute — Phase 5

**What** Mute a conversation for a chosen duration or indefinitely.

**Why now** A prerequisite for shipping push at all — principle 4. Groups without mute are
a reason to leave.

**Acceptance**
- A muted conversation produces no push, no desktop notification and no sound
- It still accumulates an unread count
- A direct mention overrides mute ([`GRP-04`](#grp-04--mentions--phase-4))
- Mute state is per user, not per device

**Impact** Data model, notification routing.

**Depends on** `PLT-01`

**Status** Phase 5 · ✅ Shipped

### NTF-05 — Do not disturb — Phase 5

**What** An account-level quiet period during which nothing notifies.

**Why now** Ships with `NTF-04` — same routing decision, one level up.

**Acceptance**
- Respects the user's local timezone, including when it changes
- Suppressed notifications are not replayed in a burst afterwards
- The state is visible to the user so they know why it is quiet

**Impact** Data model, notification routing.

**Depends on** `NTF-04`, `PLT-02`

**Status** Phase 5 · ✅ Shipped

### NTF-06 — Notification sounds — Phase 5

**What** Bring the existing sound toggle under the same routing rules as every other
notification surface.

**Why now** Sounds already exist but bypass mute and do-not-disturb entirely, which will be
read as a bug the moment those ship.

**Acceptance**
- Sound respects mute and do-not-disturb
- Rapid messages do not produce overlapping or clipped playback
- A blocked autoplay policy fails silently

**Impact** Client only.

**Depends on** `NTF-04`, `NTF-05`, `FE-I-07`

**Status** Phase 5 · ✅ Shipped

### NTF-07 — Last seen — Phase 5

**What** "Last seen at…" for a contact who is offline.

**Why now** Needs scoped presence ([`PLT-05`](#plt-05--scoped-presence--phase-5)) to be
expressible without leaking to people the user does not talk to.

**Acceptance**
- Visible only to people who share a conversation with the user
- Granularity is coarse enough not to be a location signal
- Absent rather than wrong when it cannot be determined

**Impact** Data model, privacy posture.

**Depends on** `PLT-05`

**Status** Phase 5 · ✅ Shipped

---

## Decision log

Each entry: the question, the options, the recommendation, and what it costs.

### DEC-01 — When to introduce the conversation model

**Question** Before Phase 0, right after it, or once groups are actually being built?

**Recommendation — immediately after Phase 0, before all other feature work.** Not first,
because read receipts were already in flight and are message-level. Not later, because the
cost rises monotonically on both message volume and call-site count.

**Consequence** One phase of zero user-visible progress. The alternative — doing Phase 2
first — means reply, reactions, edit/delete, search and pagination all get written against
the sender/receiver pair and then rewritten.

**Trap to design against** Two users messaging each other for the first time at the same
moment will create duplicate conversations unless there is a unique index on a normalized
participant key. This is the failure that is easy to miss in testing and impossible to
untangle in production.

**Status** Proposed

### DEC-02 — Drop `Message.receiverId` at contract

**Question** Keep the sender/receiver pair alongside `conversationId`, or remove it?

**Recommendation — remove it.** `senderId` plus `conversationId` is sufficient, and
`receiverId` is meaningless the moment a conversation has three participants. Keeping both
invites drift between the pair and the participant list, and drift in the data model is
the expensive kind.

**Consequence** Migration step 4 must rewrite every query filtering on `receiverId`,
including the read-receipt paths shipped in Phase 0.

**Status** Proposed

### DEC-03 — Per-message status → read cursors

**Question** Record read state per message, or as a per-participant watermark?

**Recommendation — per-message `status` now; migrate to cursors as part of
[`PLT-01`](#plt-01--the-conversation-model--phase-1).**

This is a deliberate, scheduled piece of debt, recorded here so it does not become an
accident. Cursors — `lastReadAt` and `lastDeliveredAt` per participant — are the model that
survives groups: one write per read event regardless of participant count, unread count as a
single counted range query. Per-message status is O(N) writes per message in a group of N.

It is nonetheless right for Phase 0. Cursors have to hang off a participant record, which
means either doing the entire conversation migration first — the largest item on this
roadmap — or standing up a separate read-state collection that gets migrated again at
`PLT-01` anyway. The enum is one field, one index, renders without a join, and drops into
the existing chat-list aggregation as a sum.

**Consequence** The receipt code shipped in Phase 0 is rewritten at Phase 1. The backfill is
one pass — each participant's `lastReadAt` is the newest `createdAt` among their read
messages. **If groups move earlier than Phase 4, do `PLT-01` first and build receipts on
cursors directly.**

**Status** Accepted — supersedes the implicit choice made in Phase 0

### DEC-04 — Rooms over application-level fan-out

**Question** Keep resolving recipient socket ids in application code, or use Socket.IO rooms?

**Recommendation — rooms**, keyed `conversation:<id>`, joined on open plus eagerly for the
most recent N conversations on connect.

**Consequence** Room membership becomes state that must be kept correct across joins,
leaves and removals — a removed member who stays in the room keeps receiving messages, which
is a security bug rather than a glitch.

**Status** Proposed

### DEC-05 — Scoped presence over a global broadcast

**Question** Keep broadcasting the full online roster, or scope presence per viewer?

**Recommendation — scope it.** The current design sends the complete list of online users to
every client on every connect and disconnect. That is O(users²) in messages, and it tells
every user who else is online whether or not they have any relationship to them. Neither
last seen nor do-not-disturb can be expressed on top of it.

**Consequence** Presence becomes a subscription rather than a broadcast, which is more code.
Defer the work to Phase 5, but treat the current behaviour as a known privacy weakness in
the meantime rather than as the design.

**Status** Proposed

### DEC-06 — Inbound socket events and abuse control

**Question** How should the first client → server socket events be validated and bounded?

**Recommendation — a small typed event set sharing the `X-05` Zod schemas with HTTP, plus a
per-socket token bucket.** Arcjet guards HTTP only; the socket channel has no rate limiting
of any kind today. Typing indicators are specifically a fan-out amplifier — one abusive
client can force a broadcast to every participant on every keystroke.

**Consequence** `X-05` becomes a genuine prerequisite for
[`MSG-03`](#msg-03--typing-indicators--phase-0) rather than a nice-to-have.

**Status** Proposed

### DEC-07 — Signed direct upload

**Question** Keep base64-through-the-API, or move to signed direct-to-Cloudinary uploads?

**Recommendation — signed direct upload**, and treat it as the gate for all of Phase 3.

The current path inlines a data URI into a JSON body capped at 5 MB. It cannot carry voice
notes, video or arbitrary files, it makes upload progress impossible because the browser
sees one opaque POST, and every byte transits the API server. The server issues a scoped,
short-lived signature; the client uploads directly; the server records what came back.

**Consequence** Validation currently done in application code moves to a Cloudinary upload
preset, which means the limits live somewhere less visible and need documenting. A signature
endpoint is also a new abuse surface and needs its own rate limit.

**Status** Proposed

### DEC-08 — Delete semantics

**Question** Hard delete, tombstone, or hide-for-me?

**Recommendation — tombstone, with delete-for-everyone inside a bounded window** (start at
one hour) and delete-for-me as a client-side hide thereafter. **Shipped at one hour**, which
answers open question 2: long enough for the "wrong person" and "spotted a typo" cases,
short enough that history stays trustworthy. A group admin may delete at any age.

**Consequence** Deleted content occupies rows indefinitely. Accepted: hard deletion breaks
reply references ([`MSG-05`](#msg-05--reply-and-quote--phase-2)) and punches holes in
pagination cursors, both of which are worse. Attached media *should* be hard-deleted from
Cloudinary even when the message is tombstoned.

**Status** Proposed

### DEC-09 — Conversation type as a single field

**Question** Separate collections for direct chats and groups, or one with a type field?

**Recommendation — one `Conversation` collection with `type: direct | group`.** Principle 2:
one code path. Channels are deliberately not a third value — the door stays open, but see
[non-goals](#non-goals).

**Status** Proposed

### DEC-10 — Search via Mongo `$text`

**Question** Mongo's built-in text index, or a hosted search service?

**Recommendation — `$text`, scoped per conversation**, accepting its limitations: no fuzzy
matching, weak stemming outside English, no relevance tuning worth the name.

**Consequence** Search quality will be visibly worse than a dedicated engine. That is the
right trade for a solo-maintained project — a hosted search dependency is a cost and an
operational surface that [`MSG-07`](#msg-07--message-search--phase-2) does not justify.
Revisit if search becomes a primary way people navigate.

**Status** Proposed

### DEC-11 — Read receipts ship always-on

**Question** Should users be able to turn read receipts off?

**Recommendation — always-on, no toggle**, recorded here so it reads as a choice rather than
an oversight.

A reciprocal toggle (disable yours, lose theirs) is the only honest design, and it doubles
the state space of every receipt path for a feature nobody has asked for. Revisit if it is
actually requested; the data model does not need to change to support it later.

**Status** Accepted

---

## Phasing

Dependency-driven. Each phase pays for the substrate the next one assumes.

| Phase | Contents | What it unlocks | Gate |
|---|---|---|---|
| **0 — Receipts and the inbound channel** ✅ | `MSG-01`, `MSG-02`, `PLT-03`, `MSG-03`, `PLT-02` — all shipped | The inbound socket surface and the global listener that every later phase assumes | `X-03` for the new endpoints |
| **1 — Conversation migration** ✅ | `PLT-01`, `PLT-04` — shipped; contract step held | Literally everything below | Backfill verified by count; rollback rehearsed |
| **2 — Message polish** ✅ | `MSG-04`, `MSG-05`, `MSG-06`, `MSG-07`, `MSG-08` — shipped | The conversation stops being a flat log | `X-05` schemas for all new bodies |
| **3 — Media** ✅ | `MED-01`–`MED-06`, `MSG-09` — shipped | Chatify carries more than text and images | `DEC-07` accepted and `MED-01` shipped |
| **4 — Groups** ✅ | `GRP-01`–`GRP-05`, `MSG-10`, `MED-07` — shipped | The second persona | `DEC-03` cursor migration complete |
| **5 — Notifications** ✅ | `NTF-01`–`NTF-07`, `PLT-05` — shipped; push needs VAPID keys configured | Chatify works without a tab open | `NTF-04` before any push ships |

**Why not do Phase 2 before Phase 1?** It feels better — visible progress sooner. It loses
anyway: five features get written against the sender/receiver pair and then rewritten, and
the migration itself gets harder with every one of them. See
[`DEC-01`](#dec-01--when-to-introduce-the-conversation-model).

**Why are groups after media?** Two reasons. Groups need the cursor migration
([`DEC-03`](#dec-03--per-message-status--read-cursors)) to have settled, and launching groups
with a weaker media story than one-to-one chat would be a visible regression in the place
media matters most.

**Why are notifications last?** Dependency count, not importance. Push value comes largely
from mentions (Phase 4), digests need read cursors (Phase 1), per-conversation mute needs
conversations (Phase 1), and do-not-disturb needs the inbound channel (Phase 0).

---

## Success signals

Deliberately few and observable. This is a personal project; metrics theatre would be worse
than nothing.

**Phase 0** — Unread counts survive a reload and match the server. No message is lost when a
recipient reconnects. No duplicate bubbles across multiple tabs.

**Phase 1** — Message count before and after the backfill is identical. No conversation has
duplicate records. Every existing chat opens showing exactly its prior history.

**Phase 2** — A conversation with thousands of messages opens as fast as one with ten.
Search finds a known message from months back. No reply points at a hole.

**Phase 3** — A voice note records and plays back on both iOS and Android. Upload progress
reflects real bytes. No file transits the API server.

**Phase 4** — A group of ten works without a per-participant slowdown. Removed members stop
receiving messages immediately, verified from a live session.

**Phase 5** — A push notification opens the right conversation from a cold start. A muted
group produces no notification of any kind. No notification arrives during a quiet period.

---

## Open questions

| # | Question | Decide by |
|---|---|---|
| 1 | ~~Do new group members see history from before they joined?~~ **Answered: yes, full history.** A group where half the members see a different thread is confusing, and hiding it properly needs a per-participant `joinedAt` filter on every read. Their read cursor starts null, so the backlog does not land as unread. | ✅ Phase 4 |
| 2 | ~~What is the right delete-for-everyone window?~~ **Answered: one hour**, with group admins exempt. | ✅ Phase 2 |
| 3 | Should cross-conversation search be a separate surface from in-conversation search, or one input with a scope switch? | Phase 2 |
| 4 | Is a PWA install prompt worth shipping alongside web push, or does it distract from the permission ask? | Phase 5 |
| 5 | What is the retention story for media attached to tombstoned messages — immediate hard delete, or a grace period? | Phase 2 |

---

## ID index

Everything on one screen. Status: ✅ shipped · ⬜ open · ⬛ dropped.

| ID | Title | Phase | State | Depends on |
|---|---|---|---|---|
| `PLT-01` | The conversation model | 1 | ✅ | `X-03` ✅ |
| `PLT-02` | Inbound socket event contract | 0 | ✅ | `X-05` |
| `PLT-03` | Global inbox listener | 0 | ✅ | — |
| `PLT-04` | Conversation-scoped socket rooms | 1 | ✅ | `PLT-01` |
| `PLT-05` | Scoped presence | 5 | ✅ | `PLT-01`, `PLT-02` |
| `MSG-01` | Read receipts | 0 | ✅ | `PLT-03` |
| `MSG-02` | Unread badges | 0 | ✅ | `MSG-01`, `PLT-03` |
| `MSG-03` | Typing indicators | 0 | ✅ | `PLT-02` |
| `MSG-04` | Edit and delete | 2 | ✅ | `PLT-01`, `X-05` |
| `MSG-05` | Reply and quote | 2 | ✅ | `PLT-01`, `MSG-04`, `MSG-08` |
| `MSG-06` | Reactions | 2 | ✅ | `PLT-01` |
| `MSG-07` | Message search | 2 | ✅ | `PLT-01`, `MSG-08` |
| `MSG-08` | Conversation history | 2 | ✅ | `BE-I-05`, `FE-I-04` |
| `MSG-09` | Link previews | 3 | ✅ | `PLT-01` |
| `MSG-10` | Pin a message | 4 | ✅ | `PLT-01`, `GRP-02` |
| `GRP-01` | Group conversations | 4 | ✅ | `PLT-01`, `PLT-04`, `DEC-03` |
| `GRP-02` | Roles and permissions | 4 | ✅ | `GRP-01` |
| `GRP-03` | Member management | 4 | ✅ | `GRP-01`, `GRP-02` |
| `GRP-04` | Mentions | 4 | ✅ | `GRP-01`, `NTF-01` |
| `GRP-05` | Group read state | 4 | ✅ | `GRP-01`, `DEC-03` |
| `MED-01` | Signed direct uploads | 3 | ✅ | `X-05` |
| `MED-02` | Upload progress and cancel | 3 | ✅ | `MED-01` |
| `MED-03` | Arbitrary file attachments | 3 | ✅ | `MED-01` |
| `MED-04` | Voice notes | 3 | ✅ | `MED-01`, `FE-I-07` |
| `MED-05` | Video | 3 | ✅ | `MED-01` |
| `MED-06` | Drag, drop and paste | 3 | ✅ | `MED-01`, `MED-03` |
| `MED-07` | Conversation media gallery | 4 | ✅ | `MED-03`, `MSG-08` |
| `NTF-01` | Web push | 5 | ✅ | `PLT-01`, `NTF-04` |
| `NTF-02` | Desktop notifications | 5 | ✅ | `NTF-04`, `NTF-05` |
| `NTF-03` | Unread digest email | 5 | ✅ | `DEC-03`, `NTF-05` |
| `NTF-04` | Per-conversation mute | 5 | ✅ | `PLT-01` |
| `NTF-05` | Do not disturb | 5 | ✅ | `NTF-04`, `PLT-02` |
| `NTF-06` | Notification sounds | 5 | ✅ | `NTF-04`, `NTF-05`, `FE-I-07` |
| `NTF-07` | Last seen | 5 | ✅ | `PLT-05` |
