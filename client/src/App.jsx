import { Routes,Route, Navigate } from 'react-router'
import { useEffect } from 'react'

import ChatPage from './pages/ChatPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import { useAuthStore } from './store/useAuthStore'
import PageLoader from './components/PageLoader'
import { Toaster } from 'react-hot-toast'

const App = () => {
const{checkAuth , isCheckingAuth, authUser} = useAuthStore();

useEffect(()=>
{
  checkAuth();

},[checkAuth]);

// authUser is still null while the session is being restored, so rendering the
// routes here would bounce a logged-in user to /login and back
if (isCheckingAuth) {
  return <PageLoader/>;
}

  return (
    // full-bleed on phones so the chat can use the whole viewport; overflow-x
    // only, so tall content can still scroll instead of being clipped
    <div className="min-h-[100dvh] bg-slate-900 relative flex items-center justify-center p-0 sm:p-4 overflow-x-hidden">
      {/* DECORATORS - GRID BG & GLOW SHAPES */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f2e_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f2e_1px,transparent_1px)] bg-[size:14px_24px]" />
      <div className="absolute top-0 -left-4 size-96 bg-pink-500 opacity-20 blur-[100px]" />
      <div className="absolute bottom-0 -right-4 size-96 bg-cyan-500 opacity-20 blur-[100px]" />

       <Routes>
                <Route path="/" element={authUser ? <ChatPage /> : <Navigate to={"/login"} />} />
        <Route path="/login" element={!authUser ? <LoginPage /> : <Navigate to={"/"} />} />
        <Route path="/signup" element={!authUser ? <SignupPage /> : <Navigate to={"/"} />} />

      </Routes>
      <Toaster/>
    </div>
  )
}

export default App
