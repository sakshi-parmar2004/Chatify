# Chatify

A real-time one-to-one chat application. React + Vite on the front end, Express + MongoDB + Socket.IO on the back end, with image sharing via Cloudinary, transactional email via Resend, and bot/rate-limit protection via Arcjet.

## Features

- **Email + password auth** with bcrypt hashing and JWTs stored in `httpOnly` cookies
- **One-to-one messaging** with text and image attachments
- **Group conversations** with admin roles, member management and @mentions
- **Read receipts** — sent, delivered and read, from per-participant cursors
- **Unread badges** — per-conversation counts, last-message preview, most-recent-first
- **Typing indicators** — throttled, rate-limited, and self-expiring so they never stick
- **Reply, edit, delete and reactions**, with a one-hour edit window and tombstoned deletes
- **Message search** across every conversation you are in
- **Voice notes, video, images and files** uploaded straight to Cloudinary with real progress
- **Link previews**, unfurled server-side behind SSRF guards
- **Web push and desktop notifications**, with per-conversation mute and quiet hours
- **Scoped presence** — only people you share a conversation with see you online
- **Contacts and chats tabs** — browse all users, or just the ones you've talked to
- **Profile pictures** uploaded to Cloudinary
- **Welcome email** sent on registration
- **Optimistic UI** — sent messages appear immediately
- **Sound effects** for keystrokes and notifications, toggleable and persisted

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router, Zustand, Tailwind CSS, daisyUI, lucide-react |
| Backend | Node.js ≥ 20, Express 4, Socket.IO 4 |
| Database | MongoDB (Mongoose 8) |
| Auth | JWT (`jsonwebtoken`), bcryptjs, `httpOnly` cookies |
| Media | Cloudinary |
| Email | Resend |
| Security | Arcjet (shield, bot detection, sliding-window rate limit) |

## Project structure

```
Chatify/
├── client/                      # React SPA (Vite)
│   ├── public/                  # Static assets, sounds, images
│   └── src/
│       ├── components/          # UI components (chat list, message input, headers…)
│       ├── hooks/               # useKeyboardSound
│       ├── lib/axios.js         # Axios instance (withCredentials)
│       ├── pages/               # ChatPage, LoginPage, SignupPage
│       ├── store/               # Zustand stores: useAuthStore, useChatStore
│       ├── test/                # Vitest + Testing Library suites
│       ├── App.jsx              # Routing + auth guards
│       └── main.jsx             # Entry point
│
├── server/
│   └── src/
│       ├── controller/          # auth.controller.js, message.controller.js
│       ├── emails/              # Resend handler + HTML template
│       ├── lib/                 # db, env, socket, cloudinary, arcjet, generateToken
│       ├── middleware/          # protectRoute, arcjetProtection, socketAuth
│       ├── models/              # user.model.js, message.model.js
│       ├── routes/              # auth.route.js, message.route.js
│       ├── test/                # Vitest suites (in-memory MongoDB)
│       ├── app.js               # Express pipeline — middleware, routes, error handler
│       └── index.js             # Process entry — connect, listen, graceful shutdown
│
└── package.json                 # Root build/start scripts for deployment
```

## Prerequisites

- **Node.js ≥ 20**
- A **MongoDB** database (local or Atlas)
- Accounts for **Cloudinary**, **Resend**, and **Arcjet** (all have free tiers)

## Environment variables

Create `server/.env`:

```bash
# Server
PORT=8000
NODE_ENV=development
CLIENT_URL=http://localhost:5173

# Database
MONGO_URI=mongodb://localhost:27017/chatify

# Auth — use a long random string
JWT_SECRET=your_jwt_secret

# Email (Resend)
RESEND_API_KEY=re_xxxxxxxx
EMAIL_FROM=onboarding@yourdomain.com
EMAIL_FROM_NAME=Chatify

# Media (Cloudinary)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Security (Arcjet)
ARCJET_KEY=ajkey_xxxxxxxx
ARCJET_ENV=development

# Web push (optional) — without these, push notifications are skipped and
# everything else works unchanged. Generate a pair with:
#   npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@yourdomain.com
```

`.env` is gitignored — never commit real credentials.

> The server validates these at startup and exits with the list of missing keys, so a misconfiguration fails at boot rather than on the first request that needs it.

## Getting started

```bash
git clone https://github.com/sakshi-parmar2004/Chatify.git
cd Chatify

# Backend
cd server
npm install
npm run dev          # http://localhost:8000 — node --watch

# Frontend (in a second terminal)
cd client
npm install
npm run dev          # http://localhost:5173
```

The client uses relative URLs in every mode. In development the Vite dev server proxies `/api` and `/socket.io` to the API (override the target with `VITE_API_TARGET`); in production the server serves the built SPA from the same origin, so there is no dev/prod branch to keep in sync.

## Scripts

**Root** — used by the deployment platform:

| Command | Description |
|---|---|
| `npm run build` | Installs both workspaces and builds the client |
| `npm start` | Starts the server (which serves the built client in production) |

**`client/`**

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `client/dist` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run oxlint |
| `npm test` | Run the Vitest + Testing Library suite |
| `npm run test:watch` | Same, in watch mode |

**`server/`**

| Command | Description |
|---|---|
| `npm run dev` | Start with `node --watch` |
| `npm start` | Start the server |
| `npm test` | Run the Vitest suite against an in-memory MongoDB |
| `npm run test:watch` | Same, in watch mode |

## API reference

All endpoints are prefixed with `/api`. Authenticated routes read the JWT from the `token` cookie; the browser sends it automatically because the Axios instance sets `withCredentials: true`.

### Auth — `/api/auth`

| Method | Endpoint | Auth | Body | Description |
|---|---|---|---|---|
| `POST` | `/register` | — | `{ name, email, password }` | Create an account, set the auth cookie, send a welcome email. Password must be ≥ 6 characters. |
| `POST` | `/login` | — | `{ email, password }` | Log in and set the auth cookie. Rate-limited by Arcjet. |
| `POST` | `/logout` | — | — | Clear the auth cookie. |
| `GET` | `/get-user` | ✅ | — | Return the current user. Used on app load to restore the session. |
| `PUT` | `/update-profile` | ✅ | `{ profilePic }` | Upload a base64 image to Cloudinary and save the URL. |

### Conversations — `/api/conversations`

The primary surface. Every route proves membership first, and answers `404` rather than
`403` for a conversation you are not in — confirming one exists is itself a disclosure.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Your conversations, newest first, each with participants, last message and unread count. |
| `POST` | `/direct/:userId` | Open (or create) the one-to-one thread with a user. Idempotent. |
| `POST` | `/groups` | Create a group. Body `{ name, participantIds }`. The creator becomes the first admin. |
| `GET` | `/search?q=&conversationId=` | Search messages. Scoped server-side to conversations you are in; `conversationId` narrows that, never widens it. |
| `POST` | `/uploads/sign` | Issue a short-lived Cloudinary signature. Body `{ kind, bytes }`. |
| `GET` | `/:id/messages?before=&limit=` | A page of history, newest first, chronological within the page. |
| `POST` | `/:id/messages` | Send. Body `{ text?, image?, attachment?, replyTo? }`. |
| `PATCH` | `/:id/read` | Advance your read cursor. One write regardless of message count. |
| `PATCH` | `/:id/messages/:messageId` | Edit your own message, within one hour. |
| `DELETE` | `/:id/messages/:messageId` | Tombstone it. Sender within the window, or a group admin at any age. |
| `PUT` | `/:id/messages/:messageId/reactions` | Toggle a reaction. Body `{ emoji }`. |
| `PUT` | `/:id/mute` | Mute for `{ minutes }`, or `null` to clear. |
| `GET` | `/:id/media` | Attachments shared in the conversation, paginated. |
| `PUT` | `/:id/pins/:messageId` | Toggle a pinned message. |
| `PATCH` | `/:id/group` | Rename or re-image. **Admin only.** |
| `POST` | `/:id/participants` | Add members. **Admin only.** |
| `DELETE` | `/:id/participants/:userId` | Remove someone (admin) or leave (yourself). |
| `PUT` / `DELETE` | `/:id/admins/:userId` | Promote or demote. **Admin only.** |

### Notifications — `/api/notifications`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/config` | Whether push is configured, and the VAPID public key. |
| `POST` | `/subscribe` | Register a browser for push. Idempotent per endpoint. |
| `DELETE` | `/subscribe` | Unregister one. |
| `GET` / `PUT` | `/do-not-disturb` | Read or set quiet hours. |

### Messages — `/api/messages` (legacy)

The pre-`PLT-01` surface. `/contacts` is still the only way to list users; the rest is a
compatibility layer and goes when the contract step lands.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/contacts` | All users except yourself. |
| `GET` | `/chats` | Direct chat partners with unread counts. Superseded by `GET /api/conversations`. |
| `GET` | `/:id` | The full conversation with a user, unpaginated. |
| `POST` | `/send/:id` | Send by user id. |
| `PATCH` | `/read/:id` | Mark a direct conversation read. |

### Socket.IO events

The handshake authenticates using the same `token` cookie. Delivery is by
conversation room, and **room membership is the authorization boundary** — a client
that is not in a room neither receives its traffic nor can emit into it.

| Event | Direction | Payload | Description |
|---|---|---|---|
| `getOnlineUsers` | server → client | `string[]` | On connect: which of *your own contacts* are online. Not a global roster. |
| `presence` | server → client | `{ userId, online }` | One delta, sent only to people who share a conversation with that user. |
| `newMessage` | server → client | message | To the conversation room, which includes the sender's own other tabs. |
| `messageUpdated` | server → client | message | An edit, a delete, a reaction, or a resolved link preview. |
| `conversationRead` | server → client | `{ conversationId, userId, lastReadAt }` | Someone advanced their read cursor. |
| `conversationDelivered` | server → client | `{ conversationId, userId, lastDeliveredAt }` | Someone's delivery cursor advanced. |
| `conversationUpdated` | server → client | conversation | Renamed, members changed, pinned, muted. |
| `removedFromConversation` | server → client | `{ conversationId }` | You were removed; the client drops it. |
| `notify` | server → client | `{ conversationId, title, body }` | Routed through mute and quiet hours already. |
| `userTyping` / `userStoppedTyping` | server → client | `{ conversationId, userId }` | Expires client-side after 5s. |
| `typing` / `stopTyping` | **client → server** | `{ conversationId }` | Validated and rate-limited by the inbound registry. |

Client → server events go through one registry (`server/src/lib/socketEvents.js`) that
owns payload validation, a per-socket token bucket, and identity. Arcjet guards HTTP
only, so anything added outside that registry is unvalidated and unbounded — add events
to it, not to `socket.js`. The sender's identity always comes from the authenticated
socket; a payload never says who sent it.

Receipts are **cursors, not per-message flags**. A message is delivered once every other
participant's delivery cursor has passed it, and read once every read cursor has —
"every" rather than "any", so one person reading a group message is not the group
reading it.

## Data models

**User** — `name`, `email` (unique, normalised), `password` (bcrypt), `profilePic`,
`pushSubscriptions`, `doNotDisturb`, `lastSeenAt`, `lastDigestAt`. `password` and
`pushSubscriptions` are stripped on serialisation regardless of what a route selects.

**Conversation** — the spine of the model.

| Field | Notes |
|---|---|
| `type` | `direct` \| `group` |
| `participants` | User ids |
| `participantKey` | Sorted ids, direct only, under a **partial unique index**. Two groups may share membership; two people cannot have two one-to-one threads. |
| `participantState[]` | Per participant: `lastReadAt`, `lastDeliveredAt`, `mutedUntil`. Receipts and unread counts come from here — one write per read event regardless of participant count. |
| `lastMessageAt` | Denormalised so the sidebar sorts without touching messages |
| `name`, `image`, `admins`, `createdBy` | Group only |
| `pinnedMessageIds` | Group or direct |

**Message**

| Field | Notes |
|---|---|
| `conversationId` | What everything is keyed on |
| `senderId` | `null` for system messages ("X added Y") |
| `type` | `user` \| `system`. System messages are excluded from unread counts. |
| `text`, `image` | `image` is the legacy inline path |
| `attachment` | `kind`, `url`, `publicId`, `name`, `bytes`, dimensions, duration |
| `linkPreview` | Filled in asynchronously after send |
| `replyTo`, `replySnapshot` | The snapshot is denormalised so a reply survives its parent being deleted |
| `reactions[]`, `mentions[]` | |
| `editedAt`, `deletedAt`, `deletedBy` | Deletes are tombstones, not removals |
| `receiverId`, `status` | **Legacy.** Still written, no longer read. Removed at the contract step. |

Both include `createdAt` / `updatedAt`.

## Deployment

The root `package.json` builds both workspaces and starts the server. When `NODE_ENV=production`, Express serves `client/dist` as static files and falls back to `index.html` for client-side routes, so the whole app runs from a single origin.

```bash
npm run build
npm start
```

Set every variable from the [Environment variables](#environment-variables) section on your host, with `NODE_ENV=production` and `CLIENT_URL` pointing at your deployed URL.

## Migrating an existing database

Conversations became a first-class collection in `PLT-01`. An existing database
needs its messages linked to one, once:

```bash
cd server
node src/scripts/backfillConversations.js --dry-run   # reports, writes nothing
node src/scripts/backfillConversations.js
```

It is safe to re-run — it only looks at messages that have no conversation yet, and
conversation creation is an atomic upsert. It refuses to report success unless the
message count is unchanged and nothing is left unlinked. **Take a snapshot first anyway.**

## Roadmap

Where the product is going — features, phasing and the decisions behind the order — is in
[docs/prd/chatify-prd.md](docs/prd/chatify-prd.md). Engineering hardening of what already
exists stays in [improvements.md](improvements.md); the two do not overlap, and the PRD
explains the split.

## Known limitations

The 23 defects recorded in [bugs.md](bugs.md) have been fixed. What remains, tracked in [improvements.md](improvements.md):

- **Request bodies are validated by hand**, so types are not checked as rigorously as a schema validator would (`X-05`).
- **The unread digest has no scheduler.** `buildDigestFor` is written and tested, but nothing runs it on a timer — that is a hosting decision (`NTF-03`).
- **`Message.receiverId` is still written but never read.** The contract step of `PLT-01` that removes it is deliberately deferred: dropping a column is irreversible and should follow a verified backfill.
- **One Node process only.** The socket map is in memory, so a second process would not share presence or rooms. Deferred, not rejected — the answer is the Socket.IO Redis adapter, and the tripwire is needing a second process.

## License

ISC
