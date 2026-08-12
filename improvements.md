# Improvements

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

## X-01 **P1** Remove the `chatify: "file:.."` self-dependency

**Files:** [client/package.json:14](client/package.json#L14), [server/package.json:31](server/package.json#L31)

Both workspaces declare the **root package as a dependency of themselves**:

```json
"chatify": "file:.."
```

This produces `client/node_modules/chatify -> ../..` — a symlink pointing at the project root from inside its own `node_modules`. Almost certainly the residue of an `npm install chatify` run in the wrong directory.

**Why it matters:** recursive symlinks confuse file watchers, glob-based tooling, and bundler module resolution; some CI environments and Docker builds fail outright on cyclic `file:` links. It also inflates both lockfiles with a meaningless entry.

**Do:** delete both lines, then regenerate `package-lock.json` in each workspace.

---

## X-02 **P1** Add `.env.example`

There is no template for the 15 environment variables the server needs. `server/.env` is correctly gitignored and untracked, but a new contributor has no way to discover what to set beyond reading [env.js](server/src/lib/env.js) and grepping for usages.

**Do:** commit `server/.env.example` with every key present and values blank or clearly placeholder. Pair it with **BE-07** in bugs.md (startup validation) so a missing key fails loudly at boot rather than mid-request.

---

## X-03 **P1** No automated tests anywhere

`server/package.json` still carries the placeholder `"test": "echo \"Error: no test specified\" && exit 1"`. The client has no test script at all.

Given that [bugs.md](bugs.md) lists 23 defects — several of them one-line mistakes in auth and messaging — the absence of any regression net is the single largest risk to the codebase.

**Do:** start narrow, not comprehensive. Vitest + Supertest covering the auth flow (register → login → `/get-user` → logout) and the message round-trip would have caught BE-01, BE-02, BE-05, and BE-11 outright.

---

## X-04 **P2** No CI pipeline

Nothing runs lint, build, or tests on push. `oxlint` exists but must be run by hand, and only two rules are enabled.

**Do:** a GitHub Actions workflow running `npm run lint` and `npm run build` for the client and (once X-03 lands) `npm test` for the server.

---

## X-05 **P2** Introduce schema validation for request bodies

Validation is hand-rolled and inconsistent — [auth.controller.js](server/src/controller/auth.controller.js) checks presence, length, and a regex inline; [message.controller.js](server/src/controller/message.controller.js) checks only that one of `text`/`image` exists. Nothing validates types, so a non-string `password` or an array `text` reaches Mongoose.

**Do:** define Zod schemas per endpoint and validate in middleware. Removes ~20 lines of scattered `if` blocks and closes the type-confusion gap in one move.

---

---

# Backend

## BE-I-01 **P1** Add `helmet`

**File:** [server/src/index.js](server/src/index.js)

`app.disable("x-powered-by")` is in place, but that is the only security header set. Missing: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a CSP for the SPA served in production.

**Do:** `app.use(helmet())` before the routes, with `contentSecurityPolicy` tuned to allow Cloudinary image origins.

---

## BE-I-02 **P1** Validate and bound image uploads

**Files:** [auth.controller.js:82](server/src/controller/auth.controller.js#L82), [message.controller.js:58-61](server/src/controller/message.controller.js#L58-L61)

The body limit is `5mb` ([index.js:14](server/src/index.js#L14)), which after base64 overhead permits roughly a 3.7 MB image. Beyond that ceiling there is no check on MIME type, actual decoded size, or dimensions before the payload is forwarded to Cloudinary.

**Why it matters:** every upload costs Cloudinary quota, and an authenticated user can burn it in a loop. This is the same code path as the SSRF issue in **BE-04** of bugs.md — fix them together.

**Do:** assert the `data:image/*;base64,` prefix, cap the decoded byte length, and pass Cloudinary transformation limits (`max_bytes`, `width`/`height` caps).

---

## BE-I-03 **P1** Index the `Message` collection

**File:** [server/src/models/message.model.js](server/src/models/message.model.js)

No indexes are declared. Every conversation load ([message.controller.js:22](server/src/controller/message.controller.js#L22)) and every chat-partner lookup ([message.controller.js:87](server/src/controller/message.controller.js#L87)) is a full collection scan.

**Do:**

```js
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: -1 });
```

Cheap now, effectively mandatory past a few thousand messages.

---

## BE-I-04 **P1** Rewrite `getChatPartners` — it loads every message into memory

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

## BE-I-05 **P2** Paginate conversation history

**File:** [server/src/controller/message.controller.js:22](server/src/controller/message.controller.js#L22)

`GET /api/messages/:id` returns the **entire** conversation with no `limit` or `skip`. Opening a long-running chat transfers every message ever exchanged, and the client renders all of them ([ChatContainer.jsx:44](client/src/components/ChatContainer.jsx#L44)).

**Do:** default to the most recent ~50 with cursor-based pagination on `createdAt`. Pairs with **FE-I-04**.

---

## BE-I-06 **P2** Add a centralized error handler

Every controller repeats the same `try/catch` → `console.log` → generic 500 block, and the response shape is inconsistent: some return `{ message }` ([auth.controller.js:45](server/src/controller/auth.controller.js#L45)), others `{ error }` ([message.controller.js:32](server/src/controller/message.controller.js#L32)). The client only ever reads `.message`, so `{ error }` responses surface as the fallback string.

**Do:** an Express error middleware plus an `asyncHandler` wrapper. Removes the boilerplate and makes one response shape enforceable.

---

## BE-I-07 **P2** Replace `console.log` with structured logging

**Files:** throughout — [socket.js:29](server/src/lib/socket.js#L29), [socket.auth.middleware.js:37](server/src/middleware/socket.auth.middleware.js#L37), [emailHandler.js:20](server/src/emails/emailHandler.js#L20), every controller

Logging is `console.log`/`console.error` with no levels, no request correlation, and no structure. Some of it is noisy per-connection chatter; some logs user names and ids on every socket event.

**Do:** `pino` with request ids, levels, and redaction. Then errors like **BE-06** in bugs.md (Arcjet failing open) become alertable instead of invisible.

---

## BE-I-08 **P2** Add a health check endpoint

Nothing exposes liveness or DB connectivity. A platform health check against `/` in development gets a 404 (the root handler was removed in `78bb21c`).

**Do:** `GET /api/health` returning status plus `mongoose.connection.readyState`.

---

## BE-I-09 **P2** Handle DB connection loss after startup

**File:** [server/src/lib/db.js](server/src/lib/db.js)

`connectDB` exits the process if the *initial* connection fails, but there are no handlers for `disconnected` / `error` events afterwards. A mid-flight Mongo outage leaves the server accepting requests that hang until the Mongoose buffer timeout.

**Do:** register connection event handlers and surface the state through the health check from BE-I-08.

---

## BE-I-10 **P3** Graceful shutdown

`server.listen` has no `SIGTERM` handler ([index.js:38](server/src/index.js#L38)). On deploy the process is killed with sockets open and requests in flight.

**Do:** close the HTTP server and Socket.IO, drain, then close the Mongoose connection.

---

## BE-I-11 **P3** `connectDB` is called after the server starts listening

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

## BE-I-12 **P3** Move the email link out of the email handler

**File:** [server/src/emails/emailHandler.js:17](server/src/emails/emailHandler.js#L17)

The welcome email hardcodes `https://chatify-km3zy.sevalla.app/` while `CLIENT_URL` already exists in config. Anyone self-hosting sends new users to someone else's deployment.

**Do:** pass `env_variable.CLIENT_URL`. Also note the template hardcodes the product name as "Messenger" in the body, footer, and signature while the subject says "Chatify" ([emailTemplate.js](server/src/emails/emailTemplate.js)).

---

# Frontend

## FE-I-01 **P1** Add an error boundary

**File:** [client/src/main.jsx](client/src/main.jsx)

There is no error boundary anywhere in the tree. Any render-time throw — and [bugs.md](bugs.md) documents four that are reachable through normal use (FE-03, FE-04, FE-08, FE-09) — unmounts the entire application and leaves a blank page with no recovery path.

**Do:** wrap `<App />` in an error boundary with a reload affordance.

---

## FE-I-02 **P1** Guard against a missing `authUser` in protected components

**Files:** [ProfileHeader.jsx:50](client/src/components/ProfileHeader.jsx#L50), [ChatContainer.jsx:47](client/src/components/ChatContainer.jsx#L47)

Both dereference `authUser` directly (`authUser.profilePic`, `authUser._id`). They are only reachable when `authUser` is set, so this holds — but it holds by routing accident, and **FE-02** in bugs.md shows that guard is already broken once.

**Do:** either make the guarantee explicit with a route-level `ProtectedRoute` wrapper, or use optional chaining at the point of use.

---

## FE-I-03 **P2** Configure a Vite dev proxy

**Files:** [client/vite.config.js](client/vite.config.js), [client/src/lib/axios.js:6](client/src/lib/axios.js#L6), [useAuthStore.js:5](client/src/store/useAuthStore.js#L5)

The dev API base URL is hardcoded to `http://localhost:8000` in two separate places, and the socket URL duplicates the same conditional.

**Do:** add a `server.proxy` entry for `/api` and `/socket.io`, then use relative URLs in both modes. This removes the mode conditional, removes CORS from development entirely, and eliminates the duplicated constant.

---

## FE-I-04 **P2** The message list has no windowing or pagination

**File:** [client/src/components/ChatContainer.jsx:44](client/src/components/ChatContainer.jsx#L44)

`messages.map(...)` renders every message in the conversation, and the effect at [line 32](client/src/components/ChatContainer.jsx#L32) calls `scrollIntoView({ behavior: "smooth" })` on every change to the array.

**Why it matters:** a long conversation renders thousands of DOM nodes at once, and each new message triggers a smooth scroll over the whole list. Depends on **BE-I-05** for the server half.

**Do:** load recent messages with "load older" on scroll; use `behavior: "auto"` for the initial jump and reserve smooth scrolling for incremental appends.

---

## FE-I-05 **P2** The chats list does not refresh after messaging a new contact

**Files:** [ChatsList.jsx:12-14](client/src/components/ChatsList.jsx#L12-L14), [useChatStore.js:65](client/src/store/useChatStore.js#L65)

`getMyChatPartners()` runs once on mount. Sending a first message to someone from the Contacts tab does not add them to Chats until the component remounts.

**Do:** re-fetch partners after a successful send, or optimistically insert the recipient into `chats`.

---

## FE-I-06 **P2** The layout is not responsive

**Files:** [ChatPage.jsx:14-16](client/src/pages/ChatPage.jsx#L14-L16)

The shell is a fixed `h-[800px]` with a fixed `w-80` sidebar and the conversation pane side by side, with no breakpoint handling. On a phone the sidebar consumes most of the width and the chat is unusable; on a short viewport the container overflows.

Both auth pages *do* handle breakpoints ([LoginPage.jsx:19](client/src/pages/LoginPage.jsx#L19)), so this is an inconsistency rather than a deliberate desktop-only choice.

**Do:** collapse to a single pane below `md`, switching between list and conversation on selection. Replace the fixed height with `h-[100dvh]` bounded by `max-h`.

---

## FE-I-07 **P2** Audio objects are constructed at module scope

**Files:** [useKeyboardSound.jsx:2-7](client/src/hooks/useKeyboardSound.jsx#L2-L7), [ProfileHeader.jsx:6](client/src/components/ProfileHeader.jsx#L6)

Five `new Audio(...)` instances are created when the modules are imported, before any user interaction. Because each is a single shared instance, `currentTime = 0` cuts off the previous playback — noticeable when typing quickly.

**Do:** lazily construct on first interaction, or preload with `<link rel="preload">` and clone the node per playback. Also worth handling the case where autoplay policy blocks playback entirely — currently swallowed by a `.catch(console.log)`.

---

## FE-I-08 **P3** Strip debug logging from the stores

**Files:** [axios.js:4](client/src/lib/axios.js#L4), [useAuthStore.js:22](client/src/store/useAuthStore.js#L22), [useAuthStore.js:51](client/src/store/useAuthStore.js#L51), [useAuthStore.js:77](client/src/store/useAuthStore.js#L77), [useChatStore.js:97](client/src/store/useChatStore.js#L97)

Left-over `console.log` calls ship to production, including `console.log("res", res)` on login and `console.log("data", data)` in `updateProfile` — both of which print a full base64 image or user object to the browser console.

**Do:** remove them. One of these (`useAuthStore.js:53`) is not merely noise but an active defect — see **FE-01** in bugs.md.

---

## FE-I-09 **P3** Accessibility gaps

- [ContactList.jsx:26](client/src/components/ContactList.jsx#L26) — avatar `<img>` has no `alt`
- [ChatsList.jsx:29](client/src/components/ChatsList.jsx#L29), [ChatHeader.jsx:34](client/src/components/ChatHeader.jsx#L34) — icon-only buttons have no `aria-label`
- [ContactList.jsx:18](client/src/components/ContactList.jsx#L18), [ChatsList.jsx:21](client/src/components/ChatsList.jsx#L21) — list rows are clickable `<div>`s, not keyboard-focusable
- [LoginPage.jsx:40](client/src/pages/LoginPage.jsx#L40) — labels are not associated with inputs via `htmlFor`/`id`
- Online/offline status is conveyed by colour alone

**Do:** the row-as-div issue is the significant one — the contact and chat lists are unreachable by keyboard.

---

## FE-I-10 **P3** Expand the lint configuration

**File:** [client/.oxlintrc.json](client/.oxlintrc.json)

Only two rules are enabled. `react-hooks/exhaustive-deps` and `no-undef` are both off — and `no-undef` would have caught **FE-01**, the broken login, before it was ever committed.

**Do:** enable the `correctness` and `react-hooks` rule sets, and wire lint into CI (**X-04**).

---

## FE-I-11 **P3** Set the document title and metadata

**File:** [client/index.html:6](client/index.html#L6)

`<title>client</title>` is the Vite default. No description, no Open Graph tags, no theme colour.

---

## FE-I-12 **P3** `ContactList` has no empty state

**File:** [client/src/components/ContactList.jsx:16](client/src/components/ContactList.jsx#L16)

`ChatsList` renders `<NoChatsFound />` when empty ([ChatsList.jsx:17](client/src/components/ChatsList.jsx#L17)); `ContactList` renders nothing at all. The first user on a fresh deployment sees a blank panel with no explanation.

---

## Suggested sequencing

1. **X-01** — remove the self-dependency; it is a one-line change that de-risks every subsequent install and build.
2. **X-02 + BE-07** (bugs.md) — env template and boot-time validation, so misconfiguration fails loudly.
3. **BE-I-01, BE-I-02** — headers and upload bounds, closing out the security work started in [bugs.md](bugs.md).
4. **BE-I-03, BE-I-04** — the two changes that determine whether the app survives its first thousand messages.
5. **X-03** — tests, scoped to the auth and messaging round-trips.

Everything else is genuinely incremental and can be picked up opportunistically.
