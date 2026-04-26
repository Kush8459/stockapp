import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Wallet2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/api";
import { useAuth } from "@/store/auth";

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();

  const [email, setEmail] = useState("demo@stockapp.dev");
  const [password, setPassword] = useState("demo1234");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "Could not sign in"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex items-center gap-2.5">
          <Wallet2 className="h-5 w-5 text-brand" />
          <span className="text-sm text-fg-muted">Stockapp</span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight">Welcome back.</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Sign in to track your portfolio in real time.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <div className="space-y-1.5">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Sign in
          </button>
        </form>

        <p className="mt-6 text-sm text-fg-muted">
          Don&apos;t have an account?{" "}
          <Link to="/register" className="text-brand hover:underline">
            Create one
          </Link>
        </p>

        <div className="mt-8 rounded-lg border border-border/80 bg-bg-soft/70 p-3 text-xs text-fg-muted">
          <span className="text-fg">Demo:</span> demo@stockapp.dev / demo1234 (run{" "}
          <code className="kbd">go run ./cmd/seed</code> first)
        </div>
      </motion.div>
    </AuthLayout>
  );
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
      {/* decorative grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      {children}
    </div>
  );
}
