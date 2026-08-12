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

Actions: `getAllContacts`, `getMyChatPartners`, `getMessagesByUserId`, `sendMessage`, `subscribeToMessages`, `unsubscribeFromMessages`, `setSelectedUser`, `setActiveTab`, `toggleSound`.

`useChatStore` reaches into `useAuthStore` via `useAuthStore.getState()` for the socket and the current user id — a one-way dependency. Keep it that way: `useAuthStore` must not import `useChatStore`.

### Authentication

The JWT lives in an `httpOnly` cookie set by the server, so it is never readable from JavaScript and never stored by hand. The Axios instance in [src/lib/axios.js](src/lib/axios.js) sets `withCredentials: true`, and the socket connection does the same, so the browser attaches the cookie automatically to both.

On mount, `App.jsx` calls `checkAuth()`, which hits `/auth/get-user` to restore the session and then opens the socket. Route guards in [src/App.jsx](src/App.jsx) redirect on `authUser`: `/` requires a session, `/login` and `/signup` redirect away from one.

### Real-time

`connectSocket()` runs after a successful `checkAuth`, `login`, or `signup`. The server pushes:

- **`getOnlineUsers`** — an array of connected user ids, handled in `useAuthStore` and read by the avatar indicators
- **`newMessage`** — appended to `messages` if it came from the selected user, subscribed per-conversation in `ChatContainer`

`ChatContainer` subscribes on mount and unsubscribes on cleanup, so the listener is scoped to the open conversation.

> ⚠️ The server's `newMessage` emit is currently commented out, so incoming messages do not arrive live. See **BE-01** in [bugs.md](../bugs.md).

### API base URL

[src/lib/axios.js](src/lib/axios.js) switches on `import.meta.env.MODE`:

- **development** → `http://localhost:8000/api`
- **production** → `/api` (the server serves the built SPA from the same origin)

`useAuthStore` duplicates the same conditional for the socket URL. Adding a Vite dev proxy would remove both — see **FE-I-03** in [improvements.md](../improvements.md).

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

Ten frontend defects are documented in [bugs.md](../bugs.md), including two that break normal use:

- **FE-01** — a stray `console.log` in `login` throws on every successful login, so `connectSocket()` never runs on that path
- **FE-02** — `PageLoader` is never returned, so logged-in users flash the login screen on load

Twelve frontend enhancements are tracked in [improvements.md](../improvements.md). The highest-value ones: adding an error boundary, a Vite dev proxy, and responsive breakpoints for the chat shell.
