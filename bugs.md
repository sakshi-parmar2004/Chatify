# Known Bugs

Defects found in a full read of the codebase. Each entry is something that is **broken or unsafe today** — not a preference. Enhancements and hardening work live in [improvements.md](improvements.md).

Severity key:

| Level | Meaning |
|---|---|
| 🔴 **Critical** | Breaks a core feature, or exposes credentials / unmetered abuse |
| 🟠 **High** | Wrong behaviour or a real security weakness under normal use |
| 🟡 **Medium** | Fails on an edge case, race, or malformed input |
| 🔵 **Low** | Dead code, inconsistency, cosmetic defect |

**Summary**

| Area | 🔴 | 🟠 | 🟡 | 🔵 | Total |
|---|---|---|---|---|---|
| Backend | 3 | 4 | 4 | 2 | 13 |
| Frontend | 2 | 2 | 5 | 1 | 10 |
| **Total** | **5** | **6** | **9** | **3** | **23** |

---

# Backend

## BE-01 🔴 Real-time message delivery is disabled

**File:** [server/src/controller/message.controller.js:71-74](server/src/controller/message.controller.js#L71-L74)

The Socket.IO emit that pushes a new message to the recipient is commented out:

```js
// const receiverSocketId = getReceiverSocketId(receiverId);
// if (receiverSocketId) {
//   io.to(receiverSocketId).emit("newMessage", newMessage);
// }
```

The client subscribes to `newMessage` in [useChatStore.js:87](client/src/store/useChatStore.js#L87), but nothing ever emits it. `getReceiverSocketId` is exported from [socket.js:19](server/src/lib/socket.js#L19) and imported nowhere in the project.

**Impact:** Messages persist correctly, but the recipient sees nothing until they re-select the conversation. The application's headline feature does not work.

**Fix:** Import `{ io, getReceiverSocketId }` from `../lib/socket.js` and restore the emit after `newMessage.save()`.

---

## BE-02 🔴 Password hashes are returned to the client

**File:** [server/src/controller/auth.controller.js:38](server/src/controller/auth.controller.js#L38), [auth.controller.js:65](server/src/controller/auth.controller.js#L65)

```js
res.status(201).json({ message: "User registered successfully", user: newUser });
res.status(200).json({ message: "Login successful", user });
```

Both hand back the full Mongoose document including the bcrypt `password` field. `protectRoute` correctly applies `.select("-password")`; these two paths bypass it entirely.

**Impact:** The hash reaches browser memory, any response logging, and any error-reporting tool the client uses. It gives an attacker with partial access an offline cracking target.

**Fix:** Strip it before responding — `const { password: _, ...safeUser } = user.toObject();` — or add a `toJSON` transform on the schema so it can never leak from any route.

---

## BE-03 🔴 `/register` has no rate limiting

**File:** [server/src/routes/auth.route.js:14](server/src/routes/auth.route.js#L14)

`arcjetProtection` is applied to `/login` and to every route in [message.route.js:10](server/src/routes/message.route.js#L10), but **not** to `/register` or `/logout`.

**Impact:** Registration is the most expensive endpoint in the app — it writes to MongoDB, runs bcrypt at cost 10, and sends a Resend email. Unthrottled, it is a denial-of-wallet vector (Resend quota, Mongo storage) and lets an attacker flood the user table.

**Fix:** Add `arcjetProtection` to the `/register` route. Consider a stricter dedicated rate limit for account creation than the global 100/60s.

---

## BE-04 🟠 SSRF through the profile picture upload

**File:** [server/src/controller/auth.controller.js:82](server/src/controller/auth.controller.js#L82)

```js
const { secure_url } = await cloudinary.uploader.upload(profilePic, { folder: "profile_pics" });
```

`profilePic` comes straight from the request body with no validation. Cloudinary's `upload()` accepts **remote URLs** and fetches them server-side.

**Impact:** A user can submit `http://169.254.169.254/latest/meta-data/` or an internal hostname and have Cloudinary fetch it. The response body is not returned to the attacker, but timing and success/failure still leak internal network topology.

**Fix:** Require the value to match `^data:image\/(png|jpe?g|webp|gif);base64,` before uploading, and enforce a decoded size cap.

---

## BE-05 🟠 Email addresses are not normalized

**File:** [server/src/models/user.model.js:7](server/src/models/user.model.js#L7), [auth.controller.js:23](server/src/controller/auth.controller.js#L23)

The schema has `unique: true` but no `lowercase` or `trim`, and the controller does not normalize before `findOne` or `create`.

**Impact:** `Alice@Example.com` and `alice@example.com` become two separate accounts. A user who registers with capitals and later types their email in lowercase gets "Invalid Credentials" and cannot log in. Trailing whitespace has the same effect.

**Fix:** Add `lowercase: true, trim: true` to the schema field and normalize in the controller before querying.

---

## BE-06 🟠 Arcjet fails open on error

**File:** [server/src/middleware/arcjet.middleware.js:31-33](server/src/middleware/arcjet.middleware.js#L31-L33)

```js
} catch (error) {
  console.log("Arcjet Protection Error:", error);
  next();
}
```

Any exception — bad API key, network blip, Arcjet outage, quota exhaustion — silently allows the request through.

**Impact:** All rate limiting, bot detection, and shield protection can disappear without any alert. A misconfigured `ARCJET_KEY` in production means the app *appears* protected while being completely open.

**Fix:** At minimum log at error level with enough context to alert on. Preferably fail closed on auth routes and fail open on read-only routes.

---

## BE-07 🟠 No startup validation of environment variables

**File:** [server/src/lib/env.js](server/src/lib/env.js)

Every variable is read with `process.env.X` and exported as-is. Nothing checks that any of them exist.

**Impact:** A missing `JWT_SECRET` does not fail at boot — the server starts healthily, passes health checks, and then throws on the first login attempt. Same for `MONGO_URI` (fails at connect), Cloudinary keys (fails on first upload), and Resend (fails on first signup). Deploys look successful and break in production.

**Fix:** Validate required keys at module load and `process.exit(1)` with a clear message listing what's missing.

---

## BE-08 🟡 Messages are returned in unspecified order

**File:** [server/src/controller/message.controller.js:22-27](server/src/controller/message.controller.js#L22-L27)

`Message.find({ $or: [...] })` has no `.sort()`. MongoDB does not guarantee ordering without one.

**Impact:** Currently works by accident because natural order matches insertion order. This breaks silently after a document moves on disk, an index is added, or the collection is migrated — messages then render out of order with no error.

**Fix:** Add `.sort({ createdAt: 1 })`.

---

## BE-09 🟡 Route params are not validated as ObjectIds

**File:** [server/src/controller/message.controller.js:20](server/src/controller/message.controller.js#L20), [message.controller.js:38](server/src/controller/message.controller.js#L38)

`req.params.id` is passed directly to `Message.find`, `User.exists`, and `senderId.equals()`.

**Impact:** A malformed id (`/api/messages/abc`) throws a Mongoose `CastError`, caught by the generic handler and returned as **500 Internal Server Error** when it should be a 400. Noisy in logs, and it turns client bugs into false server alerts.

**Fix:** Guard with `mongoose.Types.ObjectId.isValid(id)` and return 400 early.

---

## BE-10 🟡 One socket per user breaks multi-tab presence

**File:** [server/src/lib/socket.js:26-42](server/src/lib/socket.js#L26-L42)

```js
const userSocketMap = {}; // {userId:socketId}
userSocketMap[userId] = socket.id;
```

A second connection from the same user overwrites the first. When either tab disconnects, `delete userSocketMap[userId]` removes the mapping entirely.

**Impact:** Open the app in two tabs and close one — the user shows as **offline to everyone** while still connected, and (once BE-01 is fixed) messages route to whichever socket happens to be stored, so one tab silently misses them.

**Fix:** Store a `Set` of socket ids per user; only remove the user from the map when the set empties.

---

## BE-11 🟡 Duplicate-email race returns 500 instead of 400

**File:** [server/src/controller/auth.controller.js:23-27](server/src/controller/auth.controller.js#L23-L27)

`findOne({ email })` followed by `User.create()` is a check-then-act race. Two concurrent signups with the same email both pass the check; the second hits the unique index.

**Impact:** The `E11000 duplicate key` error falls through to the generic catch and returns "Server error" — the user is told something broke rather than that the email is taken.

**Fix:** Catch `error.code === 11000` and return the 400 "User already exists" response.

---

## BE-12 🟡 `sameSite: "strict"` will break a split-domain deployment

**File:** [server/src/lib/generateToken.js:9](server/src/lib/generateToken.js#L9)

The auth cookie is `sameSite: "strict"`, while CORS is configured for a separate `CLIENT_URL` with `credentials: true` ([index.js:16-19](server/src/index.js#L16-L19)).

**Impact:** This works today only because production serves the SPA from the same origin as the API. The moment the client is hosted on a different domain, the browser stops sending the cookie on cross-site requests and **every authenticated request 401s** — including the Socket.IO handshake, which reads the same cookie ([socket.auth.middleware.js:7-11](server/src/middleware/socket.auth.middleware.js#L7-L11)). The failure is silent and looks like broken auth, not a cookie policy issue.

**Fix:** Use `sameSite: "none"` with `secure: true` when the client is cross-site, driven by config rather than hardcoded.

---

## BE-13 🔵 Dead code and inconsistencies

**File:** [server/src/controller/auth.controller.js](server/src/controller/auth.controller.js)

- **Line 29** — `if(!newUser)` is unreachable. `User.create()` throws on failure; it never resolves falsy.
- **Lines 33-37** — the `try/catch` around `sendWelcomeEmail` is redundant; [email.js:6-12](server/src/lib/email.js#L6-L12) already swallows and logs its own errors.
- **Line 73** — `logoutUser` reads `process.env.NODE_ENV` directly instead of `env_variable.NODE_ENV` used everywhere else. It works, but it bypasses the config module and will drift if that module ever gains defaults.

---

# Frontend

## FE-01 🔴 `login` throws a `ReferenceError` on every successful login

**File:** [client/src/store/useAuthStore.js:53](client/src/store/useAuthStore.js#L53)

```js
set({ authUser: res.data.user });
console.log("authUser", authUser)   // ← not defined in this scope
```

`authUser` is store state, not a local binding. This throws every time.

**Impact:** Execution jumps to `catch`, where `error.response.data.message` throws a **second** error because a `ReferenceError` has no `.response`. The success toast never fires, `connectSocket()` at line 58 **never runs** — so the user logs in with no socket connection and no presence — and an unhandled promise rejection is logged. It only looks like it works because `set()` already ran on the previous line, so the redirect happens.

**Fix:** Delete the line. (It also means `connectSocket` has never been exercised on the login path — verify presence works after removing it.)

---

## FE-02 🔴 `PageLoader` is never rendered — logged-in users get bounced to `/login`

**File:** [client/src/App.jsx:21-24](client/src/App.jsx#L21-L24)

```js
if(isCheckingAuth)
{
<PageLoader/>     // ← evaluated and discarded, no return
}
```

**Impact:** While `checkAuth()` is in flight, `authUser` is still `null`, so the guard at [App.jsx:33](client/src/App.jsx#L33) redirects to `/login`, then bounces back once the request resolves. Every page load flashes the login screen. On a slow connection the user can start typing credentials before being yanked away.

**Fix:** `return <PageLoader />;`

---

## FE-03 🟠 Cancelling the file picker crashes the message composer

**File:** [client/src/components/MessageInput.jsx:31-32](client/src/components/MessageInput.jsx#L31-L32)

```js
const file = e.target.files[0];
if (!file.type.startsWith("image/")) {   // TypeError when files is empty
```

**Impact:** Opening the image picker and pressing Cancel throws `Cannot read properties of undefined (reading 'type')`. With no error boundary in the app ([main.jsx](client/src/main.jsx)), this can take down the React tree.

**Fix:** Add `if (!file) return;` — exactly the guard [ProfileHeader.jsx:20](client/src/components/ProfileHeader.jsx#L20) already has.

---

## FE-04 🟠 Socket listeners crash when the socket is null

**File:** [client/src/store/useChatStore.js:87](client/src/store/useChatStore.js#L87), [useChatStore.js:107](client/src/store/useChatStore.js#L107)

```js
const socket = useAuthStore.getState().socket;
socket.on("newMessage", ...)   // socket may be null
```

`socket` starts as `null` ([useAuthStore.js:13](client/src/store/useAuthStore.js#L13)) and is only set by `connectSocket`. Because of **FE-01**, `connectSocket` never runs on the login path — so a user who logs in and immediately opens a chat hits `Cannot read properties of null (reading 'on')`.

**Fix:** Guard both `subscribeToMessages` and `unsubscribeFromMessages` with `if (!socket) return;`.

---

## FE-05 🟡 Optimistic send drops concurrently received messages

**File:** [client/src/store/useChatStore.js:73-79](client/src/store/useChatStore.js#L73-L79)

```js
set({ messages: [...messages, optimisticMessage] });
try {
  const res = await axiosInstance.post(...);
  set({ messages: messages.concat(res.data) });   // `messages` is the pre-optimistic snapshot
} catch (error) {
  set({ messages: messages });                     // same stale snapshot
}
```

`messages` is captured before the optimistic append and reused after the `await`.

**Impact:** Any message that arrives over the socket while the POST is in flight is silently erased on both the success and failure paths. Also affects rapid consecutive sends.

**Fix:** Use the functional form — `set((state) => ({ messages: [...state.messages, ...] }))` — and remove the optimistic entry by `tempId` rather than replacing the whole array.

---

## FE-06 🟡 Sound toggle has no effect until you switch conversations

**File:** [client/src/store/useChatStore.js:83](client/src/store/useChatStore.js#L83)

```js
const { selectedUser, isSoundEnabled } = get();   // captured once at subscribe time
socket.on("newMessage", (newMessage) => {
  if (isSoundEnabled) { ... }                     // stale closure
});
```

**Impact:** Toggling the speaker icon updates the store and the icon, but the already-registered listener keeps using the value from when it subscribed. The setting appears to do nothing until the user selects a different chat and the effect re-runs.

**Fix:** Read `get().isSoundEnabled` inside the handler.

---

## FE-07 🟡 Socket and listener leak on logout

**File:** [client/src/store/useAuthStore.js:111-113](client/src/store/useAuthStore.js#L111-L113)

```js
disconnectSocket : () => {
  if (get().socket?.connected) get().socket.disconnect();
},
```

The socket is disconnected but never cleared from the store, and the `getOnlineUsers` listener registered at [useAuthStore.js:103](client/src/store/useAuthStore.js#L103) is never removed.

**Impact:** The stale instance and its listener stay in memory. Logging out and back in accumulates a new socket each cycle, and `onlineUsers` keeps whatever value it held at logout instead of resetting.

**Fix:** `socket.off()`, then `set({ socket: null, onlineUsers: [] })`.

---

## FE-08 🟡 Unguarded `error.response.data.message` in five handlers

**Files:** [useAuthStore.js:38](client/src/store/useAuthStore.js#L38), [useAuthStore.js:61](client/src/store/useAuthStore.js#L61), [useAuthStore.js:83](client/src/store/useAuthStore.js#L83), [useChatStore.js:34](client/src/store/useChatStore.js#L34), [useChatStore.js:46](client/src/store/useChatStore.js#L46)

```js
toast.error(error.response.data.message);
```

`error.response` is undefined for network failures, timeouts, CORS rejections, and any non-Axios error.

**Impact:** The error handler itself throws, so the user gets **no toast at all** — the app just appears frozen. The original error is replaced by a `TypeError`, making the real cause invisible in logs. `getMessagesByUserId` at [useChatStore.js:59](client/src/store/useChatStore.js#L59) already does this correctly with optional chaining and a fallback.

**Fix:** `error.response?.data?.message || "Something went wrong"` everywhere.

---

## FE-09 🟡 Empty-conversation placeholder shows "undefined"

**File:** [client/src/components/ChatContainer.jsx:72](client/src/components/ChatContainer.jsx#L72)

```jsx
<NoChatHistoryPlaceholder name={selectedUser.fullName} />
```

The User model field is `name` ([user.model.js:6](server/src/models/user.model.js#L6)); `fullName` does not exist anywhere in the schema or API.

**Impact:** Every new conversation opens with "Start your conversation with **undefined**".

**Fix:** `selectedUser.name`.

---

## FE-10 🔵 Tailwind directives are duplicated

**File:** [client/src/index.css:1-6](client/src/index.css#L1-L6)

`@tailwind base; @tailwind components; @tailwind utilities;` appears twice, the first set on a single unterminated line.

**Impact:** Cosmetic and build noise rather than broken output, but it signals a bad merge and can double-emit base styles depending on the PostCSS pipeline.

**Fix:** Delete the first three lines.

---

## Suggested fix order

The five 🔴 issues are each a small, self-contained change and together move the app from "core feature broken" to "working":

1. **BE-01** — restore the socket emit (real-time messaging)
2. **FE-01** — delete the stray `console.log` (unblocks `connectSocket`, and FE-04 with it)
3. **BE-02** — strip passwords from auth responses
4. **BE-03** — add `arcjetProtection` to `/register`
5. **FE-02** — `return <PageLoader />`

Then the 🟠 set (BE-04 through BE-07, FE-03, FE-04), which is where the remaining security exposure sits.
