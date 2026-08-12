# Chatify — Client

The React single-page app for Chatify. For the project overview, environment variables, and API reference, see the [root README](../README.md).

## Stack

| Concern | Choice |
|---|---|
| Framework | React 19 |
| Build tool | Vite 8 |
| Routing | React Router 8 (`react-router`) |
| State | Zustand 5 |
| Styling | Tailwind CSS 3 + daisyUI 4 |
| HTTP | Axios (`withCredentials: true`) |
| Real-time | socket.io-client 4 |
| Icons | lucide-react |
| Toasts | react-hot-toast |
| Linting | oxlint |

## Running locally

The client needs the API server running on port `8000`. See the [root README](../README.md#getting-started) for backend setup.

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | Description |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run oxlint |

## Structure

```
src/
├── components/          # Presentational + container components
├── hooks/
│   └── useKeyboardSound.jsx
├── lib/
│   └── axios.js         # Configured Axios instance
├── pages/
│   ├── ChatPage.jsx     # Authenticated shell: sidebar + conversation
│   ├── LoginPage.jsx
│   └── SignupPage.jsx
├── store/
│   ├── useAuthStore.js  # Session, socket lifecycle, presence
│   └── useChatStore.js  # Contacts, chats, messages, UI prefs
├── App.jsx              # Routes and auth guards
├── main.jsx             # Entry point
└── index.css            # Tailwind layers + shared component classes
```

## Architecture

### State — two Zustand stores

State is split by domain, with no context providers and no prop drilling. Components subscribe directly.

**`useAuthStore`** owns the session and the socket connection.

| State | Purpose |
|---|---|
| `authUser` | Current user, or `null`. Drives every route guard. |
| `isCheckingAuth` | True during the initial `/auth/get-user` call on app load |
| `isSigningUp`, `isLoggingIn` | Per-action loading flags for button states |
| `socket` | The socket.io client instance |
| `onlineUsers` | Array of user ids, refreshed by the `getOnlineUsers` event |

Actions: `checkAuth`, `signup`, `login`, `logout`, `updateProfile`, `connectSocket`, `disconnectSocket`.

**`useChatStore`** owns everything conversation-related.

| State | Purpose |
|---|---|
| `allContacts` | Every user except yourself (Contacts tab) |
| `chats` | Users you have exchanged messages with (Chats tab) |
| `messages` | The open conversation |
| `selectedUser` | Who you are talking to, or `null` |
| `activeTab` | `"chats"` or `"contacts"` |
| `isSoundEnabled` | Persisted to `localStorage` |
| `unreadCounts` | `{ [partnerId]: number }`. Kept outside `chats` so a sidebar refetch cannot clobber a live increment. |
| `receipts` | `{ [partnerId]: { deliveredAt, readAt } }` — see [Read receipts](#read-receipts) |

Actions: `getAllContacts`, `getMyChatPartners`, `getMessagesByUserId`, `sendMessage`, `applyMessageToChats`, `markConversationAsRead`, `subscribeToInbox`, `unsubscribeFromInbox`, `setSelectedUser`, `setActiveTab`, `toggleSound`.

`useChatStore` reaches into `useAuthStore` via `useAuthStore.getState()` for the socket and the current user id — a one-way dependency. Keep it that way: `useAuthStore` must not import `useChatStore`.

### Authentication

The JWT lives in an `httpOnly` cookie set by the server, so it is never readable from JavaScript and never stored by hand. The Axios instance in [src/lib/axios.js](src/lib/axios.js) sets `withCredentials: true`, and the socket connection does the same, so the browser attaches the cookie automatically to both.

On mount, `App.jsx` calls `checkAuth()`, which hits `/auth/get-user` to restore the session and then opens the socket. Route guards in [src/App.jsx](src/App.jsx) redirect on `authUser`: `/` requires a session, `/login` and `/signup` redirect away from one.

### Real-time

`connectSocket()` runs after a successful `checkAuth`, `login`, or `signup`. The server pushes:

- **`getOnlineUsers`** — an array of connected user ids, handled in `useAuthStore` and read by the avatar indicators
- **`newMessage`** — the message document, for any conversation. Also echoed back to the sender's own tabs.
- **`messagesDelivered`** / **`messagesRead`** — receipt watermarks for messages *you* sent
- **`conversationRead`** — another of your own tabs read a conversation; clear its badge

**There is one inbox listener for the whole session**, subscribed in `ChatPage` and owned by `useChatStore` (`subscribeToInbox` / `unsubscribeFromInbox`). It is deliberately *not* per-conversation: unread badges have to update for chats that are not open, and a per-conversation listener discards exactly those messages. `ChatContainer` no longer subscribes to anything.

A user may have several sockets open at once (multiple tabs), and the server pushes to all of them — so every handler is written to be idempotent, and `newMessage` dedupes on `_id`.

### Read receipts

Receipts are **watermarks, not id lists**. `receipts[partnerId]` holds `{ deliveredAt, readAt }`, and `applyReceipt` re-applies them at every point a message enters state. This is what makes a receipt that overtakes its own message harmless — an id list could only patch messages already in the store, so a receipt arriving while a send is still in flight would strand that bubble on the wrong tick permanently.

Optimistic messages are skipped by `applyReceipt` on purpose: their `createdAt` comes from the browser clock and must never be compared against a server timestamp.

A conversation is marked read when it is **open and the tab is visible** — not on scroll. `ChatContainer` re-checks on `visibilitychange`.

### API base URL

URLs are relative in every mode. In development the Vite dev server proxies `/api` and `/socket.io` to the API server; in production the API is served from the same origin as the SPA, so no branch is needed.

The proxy target defaults to `http://localhost:8000` and can be overridden with `VITE_API_TARGET`. See [vite.config.js](vite.config.js).

## Styling

Tailwind utilities are used inline. Repeated patterns are extracted into component classes with `@apply` in [src/index.css](src/index.css):

| Class | Used for |
|---|---|
| `.input` | Auth form text inputs |
| `.auth-input-label` | Form labels |
| `.auth-input-icon` | Leading icon inside an input |
| `.auth-btn` | Primary submit button |
| `.auth-link` | Secondary navigation link |
| `.auth-badge` | Feature pills on the auth illustrations |

daisyUI supplies `chat`, `chat-bubble`, `avatar`, `tabs`, and the `online`/`offline` indicator classes.

The animated gradient border in `BorderAnimatedContainer` uses a custom `--border-angle` CSS property registered via `@property`, animated by the `border` keyframes in [tailwind.config.js](tailwind.config.js). It needs both pieces to work — the `@property` declaration and the keyframe.

The palette is slate + cyan on a dark background. New surfaces should use `bg-slate-800/50` with `border-slate-700/50`, and cyan for accents and interactive states.

## Assets

`public/` holds the auth illustrations (`login.png`, `signup.png`), the default `avatar.png`, and `sounds/` — four keystroke samples plus a notification and a mouse click. Sound is opt-in and persisted in `localStorage` under `isSoundEnabled`.

Audio playback is wrapped in `.catch()` because browsers block it until the user has interacted with the page.

## Conventions

- **Components** are function declarations with a default export; one component per file, named to match the file.
- **Data fetching** belongs in store actions, never in components. Components call actions from `useEffect`.
- **Loading states** get a skeleton (`UsersLoadingSkeleton`, `MessagesLoadingSkeleton`), not a spinner.
- **Empty states** get a dedicated placeholder component rather than an inline conditional.
- **Errors** surface through `react-hot-toast`. Always read the message defensively — `error.response?.data?.message || "Something went wrong"` — since `error.response` is undefined on network failures.

## Known issues

The ten frontend defects recorded in [bugs.md](../bugs.md) have been fixed. Remaining frontend work is tracked in [improvements.md](../improvements.md); the notable open items:

- **FE-I-04** — the message list renders every message with no windowing
- **FE-I-07** — audio objects are constructed at module scope, so rapid playback clips
- **FE-I-10** — only two lint rules are enabled; `correctness` and `react-hooks` are off

Planned features live in [docs/prd/chatify-prd.md](../docs/prd/chatify-prd.md).
