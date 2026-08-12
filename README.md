# Chatify

A real-time one-to-one chat application. React + Vite on the front end, Express + MongoDB + Socket.IO on the back end, with image sharing via Cloudinary, transactional email via Resend, and bot/rate-limit protection via Arcjet.

## Features

- **Email + password auth** with bcrypt hashing and JWTs stored in `httpOnly` cookies
- **One-to-one messaging** with text and image attachments
- **Read receipts** — sent, delivered and read states on every message you send
- **Unread badges** — per-conversation counts, with a last-message preview and most-recent-first ordering
- **Live presence** — online/offline indicators pushed over Socket.IO
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
│       └── index.js             # Express app entry
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
```

`.env` is gitignored — never commit real credentials.

> The server does not currently validate these at startup. A missing variable will surface as a runtime error on the first request that needs it, not at boot.

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

In development the client talks to the API at `http://localhost:8000/api` (hardcoded in `client/src/lib/axios.js`). In production it uses the relative path `/api`, since the server serves the built SPA from the same origin.

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

**`server/`**

| Command | Description |
|---|---|
| `npm run dev` | Start with `node --watch` |
| `npm start` | Start the server |

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

### Messages — `/api/messages`

All message routes require authentication and pass through Arcjet.

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `GET` | `/contacts` | — | All users except yourself. |
| `GET` | `/chats` | — | Users you have exchanged messages with, most recent first. Each carries `unreadCount` and a `lastMessage` summary alongside the user fields. |
| `GET` | `/:id` | — | The full conversation between you and user `:id`. |
| `POST` | `/send/:id` | `{ text?, image? }` | Send a message. At least one of `text` or `image` is required; `image` is a base64 data URI uploaded to Cloudinary. |
| `PATCH` | `/read/:id` | — | Mark every message from user `:id` to you as read. Returns `{ modifiedCount }`. Only ever affects messages addressed to the caller. |

### Socket.IO events

The socket handshake authenticates using the same `token` cookie.

| Event | Direction | Payload | Description |
|---|---|---|---|
| `getOnlineUsers` | server → client | `string[]` of user ids | Broadcast whenever anyone connects or disconnects. |
| `newMessage` | server → client | message document | Sent to the recipient's sockets **and echoed to the sender's own**, so a second tab sees its outgoing messages too. The originating tab dedupes on `_id`. |
| `messagesDelivered` | server → client | `{ partnerId, deliveredAt }` | Sent to the original sender when the recipient reconnects and their pending messages flush to `delivered`. |
| `messagesRead` | server → client | `{ partnerId, readAt }` | Sent to the original sender when the recipient reads the conversation. `partnerId` is the reader. |
| `conversationRead` | server → client | `{ partnerId, readAt }` | Sent to the reader's *own* other sockets so every tab clears the unread badge. `partnerId` is the sender they read. |

There are no client → server events. Marking a conversation read goes over REST
(`PATCH /api/messages/read/:id`) so it inherits the Arcjet and auth middleware.

`deliveredAt` and `readAt` are watermarks, not lists of message ids: the client applies them
to every message older than the timestamp, including ones that arrive after the receipt did.

## Data models

**User**

| Field | Type | Notes |
|---|---|---|
| `name` | String | Required |
| `email` | String | Required, unique |
| `password` | String | Required, bcrypt hash, min length 6 |
| `profilePic` | String | Cloudinary URL, defaults to `""` |

**Message**

| Field | Type | Notes |
|---|---|---|
| `senderId` | ObjectId → User | Required |
| `receiverId` | ObjectId → User | Required |
| `text` | String | Trimmed, max 2000 characters |
| `image` | String | Cloudinary URL |
| `status` | String | `sent` \| `delivered` \| `read`, defaults to `sent`. Monotonic — never moves backwards. `delivered` means it reached a live client, not that anyone saw it. |

Both include `createdAt` / `updatedAt` timestamps.

Messages written before `status` existed have no value for it. They are excluded from unread
counts by design, so old conversations do not light up as unread.

## Deployment

The root `package.json` builds both workspaces and starts the server. When `NODE_ENV=production`, Express serves `client/dist` as static files and falls back to `index.html` for client-side routes, so the whole app runs from a single origin.

```bash
npm run build
npm start
```

Set every variable from the [Environment variables](#environment-variables) section on your host, with `NODE_ENV=production` and `CLIENT_URL` pointing at your deployed URL.

## Roadmap

Where the product is going — features, phasing and the decisions behind the order — is in
[docs/prd/chatify-prd.md](docs/prd/chatify-prd.md). Engineering hardening of what already
exists stays in [improvements.md](improvements.md); the two do not overlap, and the PRD
explains the split.

## Known limitations

The 23 defects recorded in [bugs.md](bugs.md) have been fixed. What remains, tracked in [improvements.md](improvements.md):

- **No automated tests.** `npm test` in `server/` is still the placeholder that exits with an error. This is the largest remaining gap.
- **Conversation history is unpaginated.** Opening a chat loads every message in it and renders them all — fine for small conversations, not for long ones.
- **Request bodies are validated by hand**, so types are not checked as rigorously as a schema validator would.
- **Presence is a full-roster broadcast.** Every connect and disconnect sends the complete list of online user ids to every client, which is both wasteful and more disclosure than it needs to be. Tracked as `DEC-05` in the PRD.

## License

ISC
