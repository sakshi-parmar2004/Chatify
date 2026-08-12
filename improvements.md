# Improvements

> **Status: 20 done, 1 partly done, 8 open.** Each heading carries its state.
> The open items are the ones that need a product decision, add a dependency, or
> are projects rather than edits — they were deliberately not bundled into the
> bug-fix pass. See [Still open](#still-open) at the end.

Enhancements and hardening work — things that are **not broken**, but are missing, fragile, or will hurt as the app grows. Actual defects are tracked separately in [bugs.md](bugs.md).

Priority key:

| Level | Meaning |
|---|---|
| **P1** | Do before any real traffic — security posture, correctness safety net, or a trap already set |
| **P2** | Meaningfully improves reliability, performance, or developer experience |
| **P3** | Polish, consistency, and long-term maintainability |

**Summary**

| Area | P1 | P2 | P3 | Total |
|---|---|---|---|---|
| Cross-cutting | 3 | 2 | 0 | 5 |
| Backend | 4 | 5 | 3 | 12 |
| Frontend | 2 | 5 | 5 | 12 |
| **Total** | **9** | **12** | **8** | **29** |

---

# Cross-cutting

## X-01 **P1** Remove the `chatify: "file:.."` self-dependency — ✅ Done

**Files:** [client/package.json:14](client/package.json#L14), [server/package.json:31](server/package.json#L31)

Both workspaces declare the **root package as a dependency of themselves**:

```json
"chatify": "file:.."
```

This produces `client/node_modules/chatify -> ../..` — a symlink pointing at the project root from inside its own `node_modules`. Almost certainly the residue of an `npm install chatify` run in the wrong directory.

**Why it matters:** recursive symlinks confuse file watchers, glob-based tooling, and bundler module resolution; some CI environments and Docker builds fail outright on cyclic `file:` links. It also inflates both lockfiles with a meaningless entry.

**Do:** delete both lines, then regenerate `package-lock.json` in each workspace.

---

## X-02 **P1** Add `.env.example` — ✅ Done

There is no template for the 15 environment variables the server needs. `server/.env` is correctly gitignored and untracked, but a new contributor has no way to discover what to set beyond reading [env.js](server/src/lib/env.js) and grepping for usages.

**Do:** commit `server/.env.example` with every key present and values blank or clearly placeholder. Pair it with **BE-07** in bugs.md (startup validation) so a missing key fails loudly at boot rather than mid-request.

---

## X-03 **P1** No automated tests anywhere — ✅ Done (server)

**Files:** [server/vitest.config.js](server/vitest.config.js), [server/src/test/](server/src/test/)

Vitest + Supertest against an in-memory MongoDB, 69 tests over five files: the auth
flow, the message round trip, receipts and unread counts, the delivered flush, and the
inbound socket contract. `npm test` in `server/` runs them.

Two structural notes:

- `src/index.js` was split so `src/app.js` exports the configured Express app without
  connecting to a database or binding a port. The entry point owns the process
  lifecycle; the app owns the request pipeline.
- Each test file gets its own database name. Vitest isolates files into separate
  workers, and sharing one database let a finishing file drop it out from under a
  running one — which surfaced as a different test failing every few runs.

Arcjet, Cloudinary and Resend are mocked; every required env var is stubbed before
`lib/env.js` loads, so a test can never reach the real Atlas cluster or spend quota.

Validated by mutation testing: of ten deliberately introduced defects, nine are
caught. The tenth — dropping the explicit recency sort in `/chats` — is not
detectable from outside, because MongoDB does not guarantee `$group` output order and
it happens to come out sorted anyway. The explicit sort stays; it guards a documented
non-guarantee.

**Still open:** the client has no test script at all.

---

## X-04 **P2** No CI pipeline — ⬜ Open

Nothing runs lint, build, or tests on push. `oxlint` exists but must be run by hand, and only two rules are enabled.

**Do:** a GitHub Actions workflow running `npm run lint` and `npm run build` for the client and `npm test` for the server — the last of which now exists (X-03).

---

## X-05 **P2** Introduce schema validation for request bodies — ⬜ Open

Validation is hand-rolled and inconsistent — [auth.controller.js](server/src/controller/auth.controller.js) checks presence, length, and a regex inline; [message.controller.js](server/src/controller/message.controller.js) checks only that one of `text`/`image` exists. Nothing validates types, so a non-string `password` or an array `text` reaches Mongoose.

**Do:** define Zod schemas per endpoint and validate in middleware. Removes ~20 lines of scattered `if` blocks and closes the type-confusion gap in one move.

---

---

# Backend

## BE-I-01 **P1** Add `helmet` — ✅ Done

**File:** [server/src/app.js](server/src/app.js)

`app.disable("x-powered-by")` is in place, but that is the only security header set. Missing: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a CSP for the SPA served in production.

**Do:** `app.use(helmet())` before the routes, with `contentSecurityPolicy` tuned to allow Cloudinary image origins.

---

## BE-I-02 **P1** Validate and bound image uploads — ✅ Done

**Files:** [auth.controller.js:82](server/src/controller/auth.controller.js#L82), [message.controller.js:58-61](server/src/controller/message.controller.js#L58-L61)

The body limit is `5mb` ([app.js](server/src/app.js)), which after base64 overhead permits roughly a 3.7 MB image. Beyond that ceiling there is no check on MIME type, actual decoded size, or dimensions before the payload is forwarded to Cloudinary.

**Why it matters:** every upload costs Cloudinary quota, and an authenticated user can burn it in a loop. This is the same code path as the SSRF issue in **BE-04** of bugs.md — fix them together.

**Do:** assert the `data:image/*;base64,` prefix, cap the decoded byte length, and pass Cloudinary transformation limits (`max_bytes`, `width`/`height` caps).

---

## BE-I-03 **P1** Index the `Message` collection — ✅ Done

**File:** [server/src/models/message.model.js](server/src/models/message.model.js)

No indexes are declared. Every conversation load ([message.controller.js:22](server/src/controller/message.controller.js#L22)) and every chat-partner lookup ([message.controller.js:87](server/src/controller/message.controller.js#L87)) is a full collection scan.

**Do:**

```js
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: -1 });
```

Cheap now, effectively mandatory past a few thousand messages.

---

## BE-I-04 **P1** Rewrite `getChatPartners` — it loads every message into memory — ✅ Done

**File:** [server/src/controller/message.controller.js:86-101](server/src/controller/message.controller.js#L86-L101)

```js
const messages = await Message.find({
  $or: [{ senderId: loggedInUserId }, { receiverId: loggedInUserId }],
});
```

Every message the user has ever sent or received is pulled into Node, mapped, and deduplicated in JavaScript — purely to extract a list of distinct user ids. This runs on **every render of the Chats tab** ([ChatsList.jsx:13](client/src/components/ChatsList.jsx#L13)).

**Why it matters:** memory and latency grow linearly with a user's entire message history. A heavy user with 50k messages moves tens of MB per sidebar load.

**Do:** replace with an aggregation that groups to distinct partner ids server-side, or two `Message.distinct()` calls unioned. Combined with BE-I-03 this becomes an index-only operation.

---

## BE-I-05 **P2** Paginate conversation history — ⬜ Open

**File:** [server/src/controller/message.controller.js:22](server/src/controller/message.controller.js#L22)

`GET /api/messages/:id` returns the **entire** conversation with no `limit` or `skip`. Opening a long-running chat transfers every message ever exchanged, and the client renders all of them ([ChatContainer.jsx:44](client/src/components/ChatContainer.jsx#L44)).

**Do:** default to the most recent ~50 with cursor-based pagination on `createdAt`. Pairs with **FE-I-04**.

---

## BE-I-06 **P2** Add a centralized error handler — 🟡 Partly done

Every controller repeats the same `try/catch` → `console.log` → generic 500 block, and the response shape is inconsistent: some return `{ message }` ([auth.controller.js:45](server/src/controller/auth.controller.js#L45)), others `{ error }` ([message.controller.js:32](server/src/controller/message.controller.js#L32)). The client only ever reads `.message`, so `{ error }` responses surface as the fallback string.

**Do:** an Express error middleware plus an `asyncHandler` wrapper. Removes the boilerplate and makes one response shape enforceable.

---

## BE-I-07 **P2** Replace `console.log` with structured logging — ⬜ Open

**Files:** throughout — [socket.js:29](server/src/lib/socket.js#L29), [socket.auth.middleware.js:37](server/src/middleware/socket.auth.middleware.js#L37), [emailHandler.js:20](server/src/emails/emailHandler.js#L20), every controller

Logging is `console.log`/`console.error` with no levels, no request correlation, and no structure. Some of it is noisy per-connection chatter; some logs user names and ids on every socket event.

**Do:** `pino` with request ids, levels, and redaction. Then errors like **BE-06** in bugs.md (Arcjet failing open) become alertable instead of invisible.

---

## BE-I-08 **P2** Add a health check endpoint — ✅ Done

Nothing exposes liveness or DB connectivity. A platform health check against `/` in development gets a 404 (the root handler was removed in `78bb21c`).

**Do:** `GET /api/health` returning status plus `mongoose.connection.readyState`.

---

## BE-I-09 **P2** Handle DB connection loss after startup — ✅ Done

**File:** [server/src/lib/db.js](server/src/lib/db.js)

`connectDB` exits the process if the *initial* connection fails, but there are no handlers for `disconnected` / `error` events afterwards. A mid-flight Mongo outage leaves the server accepting requests that hang until the Mongoose buffer timeout.

**Do:** register connection event handlers and surface the state through the health check from BE-I-08.

---

## BE-I-10 **P3** Graceful shutdown — ✅ Done

`server.listen` has no `SIGTERM` handler ([index.js](server/src/index.js)). On deploy the process is killed with sockets open and requests in flight.

**Do:** close the HTTP server and Socket.IO, drain, then close the Mongoose connection.

---

## BE-I-11 **P3** `connectDB` is called after the server starts listening — ✅ Done

**File:** [server/src/index.js:38-41](server/src/index.js#L38-L41)

```js
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  connectDB();
});
```

The server accepts traffic before the database is connected. Mongoose buffers the queries so it usually works, but requests arriving in that window sit until buffering resolves — or time out if the connection fails.

**Do:** `await connectDB()` first, then listen.

---

## BE-I-12 **P3** Move the email link out of the email handler — ✅ Done

**File:** [server/src/emails/emailHandler.js:17](server/src/emails/emailHandler.js#L17)

The welcome email hardcodes `https://chatify-km3zy.sevalla.app/` while `CLIENT_URL` already exists in config. Anyone self-hosting sends new users to someone else's deployment.

**Do:** pass `env_variable.CLIENT_URL`. Also note the template hardcodes the product name as "Messenger" in the body, footer, and signature while the subject says "Chatify" ([emailTemplate.js](server/src/emails/emailTemplate.js)).

---

# Frontend

## FE-I-01 **P1** Add an error boundary — ✅ Done

**File:** [client/src/main.jsx](client/src/main.jsx)

There is no error boundary anywhere in the tree. Any render-time throw — and [bugs.md](bugs.md) documents four that are reachable through normal use (FE-03, FE-04, FE-08, FE-09) — unmounts the entire application and leaves a blank page with no recovery path.

**Do:** wrap `<App />` in an error boundary with a reload affordance.

---

## FE-I-02 **P1** Guard against a missing `authUser` in protected components — ⬜ Open

**Files:** [ProfileHeader.jsx:50](client/src/components/ProfileHeader.jsx#L50), [ChatContainer.jsx:47](client/src/components/ChatContainer.jsx#L47)

Both dereference `authUser` directly (`authUser.profilePic`, `authUser._id`). They are only reachable when `authUser` is set, so this holds — but it holds by routing accident, and **FE-02** in bugs.md shows that guard is already broken once.

**Do:** either make the guarantee explicit with a route-level `ProtectedRoute` wrapper, or use optional chaining at the point of use.

---

## FE-I-03 **P2** Configure a Vite dev proxy — ✅ Done

**Files:** [client/vite.config.js](client/vite.config.js), [client/src/lib/axios.js:6](client/src/lib/axios.js#L6), [useAuthStore.js:5](client/src/store/useAuthStore.js#L5)

The dev API base URL is hardcoded to `http://localhost:8000` in two separate places, and the socket URL duplicates the same conditional.

**Do:** add a `server.proxy` entry for `/api` and `/socket.io`, then use relative URLs in both modes. This removes the mode conditional, removes CORS from development entirely, and eliminates the duplicated constant.

---

## FE-I-04 **P2** The message list has no windowing or pagination — ⬜ Open

**File:** [client/src/components/ChatContainer.jsx:44](client/src/components/ChatContainer.jsx#L44)

`messages.map(...)` renders every message in the conversation, and the effect at [line 32](client/src/components/ChatContainer.jsx#L32) calls `scrollIntoView({ behavior: "smooth" })` on every change to the array.

**Why it matters:** a long conversation renders thousands of DOM nodes at once, and each new message triggers a smooth scroll over the whole list. Depends on **BE-I-05** for the server half.

**Do:** load recent messages with "load older" on scroll; use `behavior: "auto"` for the initial jump and reserve smooth scrolling for incremental appends.

---

## FE-I-05 **P2** The chats list does not refresh after messaging a new contact — ✅ Done

**Files:** [ChatsList.jsx:12-14](client/src/components/ChatsList.jsx#L12-L14), [useChatStore.js:65](client/src/store/useChatStore.js#L65)

`getMyChatPartners()` runs once on mount. Sending a first message to someone from the Contacts tab does not add them to Chats until the component remounts.

**Do:** re-fetch partners after a successful send, or optimistically insert the recipient into `chats`.

---

## FE-I-06 **P2** The layout is not responsive — ✅ Done

**Files:** [ChatPage.jsx:14-16](client/src/pages/ChatPage.jsx#L14-L16)

The shell is a fixed `h-[800px]` with a fixed `w-80` sidebar and the conversation pane side by side, with no breakpoint handling. On a phone the sidebar consumes most of the width and the chat is unusable; on a short viewport the container overflows.

Both auth pages *do* handle breakpoints ([LoginPage.jsx:19](client/src/pages/LoginPage.jsx#L19)), so this is an inconsistency rather than a deliberate desktop-only choice.

**Do:** collapse to a single pane below `md`, switching between list and conversation on selection. Replace the fixed height with `h-[100dvh]` bounded by `max-h`.

---

## FE-I-07 **P2** Audio objects are constructed at module scope — ⬜ Open

**Files:** [useKeyboardSound.jsx:2-7](client/src/hooks/useKeyboardSound.jsx#L2-L7), [ProfileHeader.jsx:6](client/src/components/ProfileHeader.jsx#L6)

Five `new Audio(...)` instances are created when the modules are imported, before any user interaction. Because each is a single shared instance, `currentTime = 0` cuts off the previous playback — noticeable when typing quickly.

**Do:** lazily construct on first interaction, or preload with `<link rel="preload">` and clone the node per playback. Also worth handling the case where autoplay policy blocks playback entirely — currently swallowed by a `.catch(console.log)`.

---

## FE-I-08 **P3** Strip debug logging from the stores — ✅ Done

**Files:** [axios.js:4](client/src/lib/axios.js#L4), [useAuthStore.js:22](client/src/store/useAuthStore.js#L22), [useAuthStore.js:51](client/src/store/useAuthStore.js#L51), [useAuthStore.js:77](client/src/store/useAuthStore.js#L77), [useChatStore.js:97](client/src/store/useChatStore.js#L97)

Left-over `console.log` calls ship to production, including `console.log("res", res)` on login and `console.log("data", data)` in `updateProfile` — both of which print a full base64 image or user object to the browser console.

**Do:** remove them. One of these (`useAuthStore.js:53`) is not merely noise but an active defect — see **FE-01** in bugs.md.

---

## FE-I-09 **P3** Accessibility gaps — ✅ Done

- [ContactList.jsx:26](client/src/components/ContactList.jsx#L26) — avatar `<img>` has no `alt`
- [ChatsList.jsx:29](client/src/components/ChatsList.jsx#L29), [ChatHeader.jsx:34](client/src/components/ChatHeader.jsx#L34) — icon-only buttons have no `aria-label`
- [ContactList.jsx:18](client/src/components/ContactList.jsx#L18), [ChatsList.jsx:21](client/src/components/ChatsList.jsx#L21) — list rows are clickable `<div>`s, not keyboard-focusable
- [LoginPage.jsx:40](client/src/pages/LoginPage.jsx#L40) — labels are not associated with inputs via `htmlFor`/`id`
- Online/offline status is conveyed by colour alone

**Do:** the row-as-div issue is the significant one — the contact and chat lists are unreachable by keyboard.

---

## FE-I-10 **P3** Expand the lint configuration — ⬜ Open

**File:** [client/.oxlintrc.json](client/.oxlintrc.json)

Only two rules are enabled. `react-hooks/exhaustive-deps` and `no-undef` are both off — and `no-undef` would have caught **FE-01**, the broken login, before it was ever committed.

**Do:** enable the `correctness` and `react-hooks` rule sets, and wire lint into CI (**X-04**).

---

## FE-I-11 **P3** Set the document title and metadata — ✅ Done

**File:** [client/index.html:6](client/index.html#L6)

`<title>client</title>` is the Vite default. No description, no Open Graph tags, no theme colour.

---

## FE-I-12 **P3** `ContactList` has no empty state — ✅ Done

**File:** [client/src/components/ContactList.jsx:16](client/src/components/ContactList.jsx#L16)

`ChatsList` renders `<NoChatsFound />` when empty ([ChatsList.jsx:17](client/src/components/ChatsList.jsx#L17)); `ContactList` renders nothing at all. The first user on a fresh deployment sees a blank panel with no explanation.

---

## Still open

Ten items were deliberately left out of the bug-fix pass. None is blocked — each is
either a project in its own right, adds a dependency, or changes behaviour in a way
that should be decided rather than assumed.

The **Blocks** column names the roadmap work that cannot proceed without the item. Those
IDs live in [docs/prd/chatify-prd.md](docs/prd/chatify-prd.md), which owns product
capability; this file owns hardening of what already exists.

| ID | Item | Why it was not bundled in | Blocks |
|---|---|---|---|
| **X-03** | Automated tests | *Done for the server* — 69 tests, mutation-checked. The client half is untouched. | `PLT-01` is now unblocked |
| **X-04** | CI pipeline | Now worth doing: `npm test` in `server/` is real. | — |
| **X-05** | Zod request validation | Adds a dependency and rewrites validation across both controllers — a refactor that would obscure the bug fixes in the same diff. | `PLT-02`, `MSG-04`, `MED-01` |
| **BE-I-05** | Paginate conversation history | Changes the API contract. Without the matching client UI (FE-I-04) it would silently truncate history, which looks like data loss. | `MSG-08` |
| **BE-I-06** | Central error handler | *Partly done* — the handler is registered and every response now uses `{ message }`. Controllers still carry their own `try/catch`; collapsing them into an `asyncHandler` is the remaining half. | — |
| **BE-I-07** | Structured logging (pino) | Adds a dependency and touches every log line. The noisiest offenders were cleaned up meanwhile: per-connection socket logs that printed user names and ids are gone, and `console.log` on error paths is now `console.error`. | — |
| **FE-I-02** | Explicit auth guard for protected components | The underlying crash risk is closed by the FE-02 fix and the new error boundary. A `ProtectedRoute` wrapper is a structural change worth making deliberately. | — |
| **FE-I-04** | Message list windowing | Pairs with BE-I-05; needs a "load older" interaction designed. | `MSG-08` |
| **FE-I-07** | Audio playback refactor | Cosmetic; the shared-instance cutoff is minor next to everything else here. | `MED-04`, `NTF-06` |
| **FE-I-10** | Expand lint rules | Turning on `correctness` and `react-hooks` will surface pre-existing warnings across the codebase. Worth doing, but as its own cleanup so the noise is separable. | — |

Recommended next step: **X-04**. The server suite exists and passes, so wiring it into CI
is now cheap and stops it rotting. After that, **X-05** — it is a stated dependency of
three PRD features, and the inbound socket contract currently hand-validates because Zod
was not available to it.
