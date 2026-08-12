import { useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import BorderAnimatedContainer from "../components/BorderAnimatedContainer";
import { MessageCircleIcon, MailIcon, LoaderIcon, LockIcon } from "lucide-react";
import { Link } from "react-router";

function LoginPage() {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const { login, isLoggingIn } = useAuthStore();

  const handleSubmit = (e) => {
    e.preventDefault();
    login(formData);
  };

  return (
    <div className="relative z-10 flex w-full items-center justify-center p-3 sm:p-4">
      <div className="relative w-full max-w-6xl md:h-[800px] md:max-h-[calc(100dvh-2rem)]">
        <BorderAnimatedContainer>
          <div className="w-full flex flex-col md:flex-row">
            {/* FORM CLOUMN - LEFT SIDE */}
            <div className="w-full md:w-1/2 p-6 sm:p-8 flex items-center justify-center md:border-r border-line/10">
              <div className="w-full max-w-md">
                {/* HEADING TEXT */}
                <div className="text-center mb-8">
                  <MessageCircleIcon className="w-12 h-12 mx-auto text-muted mb-4" />
                  <h2 className="text-2xl font-bold text-ink mb-2">Welcome Back</h2>
                  <p className="text-muted">Login to access to your account</p>
                </div>

                {/* FORM */}
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* EMAIL INPUT */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-ink/90" htmlFor="login-email">Email</label>
                    <div className="relative">
                      <MailIcon className="field-icon" />

                      <input
                        type="email"
                        id="login-email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="field pl-10"
                        placeholder="johndoe@gmail.com"
                      />
                    </div>
                  </div>

                  {/* PASSWORD INPUT */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-ink/90" htmlFor="login-password">Password</label>
                    <div className="relative">
                      <LockIcon className="field-icon" />

                      <input
                        type="password"
                        id="login-password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="field pl-10"
                        placeholder="Enter your password"
                      />
                    </div>
                  </div>

                  {/* SUBMIT BUTTON */}
                  <button className="btn-primary w-full" type="submit" disabled={isLoggingIn}>
                    {isLoggingIn ? (
                      <LoaderIcon className="mx-auto size-5 animate-spin" />
                    ) : (
                      "Sign In"
                    )}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <Link to="/signup" className="btn-ghost text-sm">
                    Don't have an account? Sign Up
                  </Link>
                </div>
              </div>
            </div>

            {/* FORM ILLUSTRATION - RIGHT SIDE */}
            <div className="hidden md:w-1/2 md:flex items-center justify-center p-6 bg-gradient-to-bl from-accent/[0.07] to-transparent">
              <div>
                <img
                  src="/login.png"
                  alt="People using mobile devices"
                  className="w-full h-auto object-contain"
                />
                <div className="mt-6 text-center">
                  <h3 className="text-xl font-medium text-accent-soft">Connect anytime, anywhere</h3>

                  <div className="mt-4 flex justify-center gap-4">
                    <span className="pill">Free</span>
                    <span className="pill">Easy Setup</span>
                    <span className="pill">Private</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </BorderAnimatedContainer>
      </div>
    </div>
  );
}
export default LoginPage;