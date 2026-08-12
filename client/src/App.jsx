import { Routes, Route, Navigate } from 'react-router'
import { useEffect } from 'react'

import ChatPage from './pages/ChatPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import AdminPage from './pages/AdminPage'
import { useAuthStore } from './store/useAuthStore'
import { useThemeStore } from './store/useThemeStore'
import PageLoader from './components/PageLoader'
import { Toaster } from 'react-hot-toast'

const App = () => {
  const { checkAuth, isCheckingAuth, authUser } = useAuthStore();
  const syncThemeFromAccount = useThemeStore((state) => state.syncFromAccount);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // The inline script in index.html already painted the cached theme. This
  // reconciles it with the account once auth resolves, so a theme set on
  // another device follows the user here.
  useEffect(() => {
    if (authUser) syncThemeFromAccount(authUser);
  }, [authUser, syncThemeFromAccount]);

  // authUser is still null while the session is being restored, so rendering the
  // routes here would bounce a logged-in user to /login and back
  if (isCheckingAuth) {
    return <PageLoader />;
  }

  return (
    // full-bleed on phones so the chat can use the whole viewport; overflow-x
    // only, so tall content can still scroll instead of being clipped
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-x-hidden bg-bg p-0 sm:p-4">
      {/* BACKDROP — the surface every glass panel blurs. Without something
          textured behind them, backdrop-filter has nothing to work with and the
          panels read as flat. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(var(--line) / 0.07) 1px, transparent 1px)," +
            "linear-gradient(to bottom, rgb(var(--line) / 0.07) 1px, transparent 1px)",
          backgroundSize: "14px 24px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-4 top-0 size-96 rounded-full bg-glow-a opacity-20 blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-4 bottom-0 size-96 rounded-full bg-glow-b opacity-20 blur-[100px]"
      />

      <Routes>
        <Route path="/" element={authUser ? <ChatPage /> : <Navigate to={"/login"} />} />
        <Route path="/login" element={!authUser ? <LoginPage /> : <Navigate to={"/"} />} />
        <Route path="/signup" element={!authUser ? <SignupPage /> : <Navigate to={"/"} />} />
        {/* OBS-04. This guard only hides the page — every admin route is
            independently gated server-side, because a client-side check stops
            nothing that matters. */}
        <Route
          path="/admin"
          element={authUser?.role === "admin" ? <AdminPage /> : <Navigate to={"/"} />}
        />
      </Routes>

      {/* Unconfigured, this renders white toasts on a dark UI. */}
      <Toaster
        position="top-center"
        toastOptions={{
          className: "glass-raised",
          style: {
            background: "rgb(var(--surface-raised) / 0.92)",
            color: "rgb(var(--text))",
            border: "1px solid rgb(var(--line) / 0.2)",
          },
          error: { iconTheme: { primary: "rgb(var(--danger))", secondary: "rgb(var(--surface))" } },
          success: { iconTheme: { primary: "rgb(var(--success))", secondary: "rgb(var(--surface))" } },
        }}
      />
    </div>
  )
}

export default App
