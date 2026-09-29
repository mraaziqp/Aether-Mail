import React, { useEffect, useState } from 'react';
import { Lock, Mail, ShieldCheck, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { api, ApiError } from '../client/api.ts';
import type { SessionUser } from '../types.ts';
import { buttonPrimary, inputClass } from './ui.tsx';

export function LoginScreen({ onLoginSuccess }: { onLoginSuccess: (user: SessionUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    api<{ configured: boolean }>('/api/auth/session').then((s) => setConfigured(s.configured)).catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: SessionUser }>('/api/auth/login', { method: 'POST', json: { username, password } });
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-aurora min-h-screen w-full flex items-center justify-center p-6">
      <div className="w-full max-w-[420px] animate-pop-in">
        <div className="flex flex-col items-center text-center mb-10">
          <div className="relative mb-5">
            <div className="absolute inset-0 blur-2xl bg-cyan-500/30 rounded-full" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center shadow-2xl">
              <Mail className="w-8 h-8 text-zinc-950" strokeWidth={2.2} />
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">AetherMail</h1>
          <p className="text-sm text-zinc-400 mt-1.5">Unified mail command center</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-[#1f2331] bg-[#0d0f15]/90 backdrop-blur p-7 space-y-5 shadow-[0_30px_120px_-30px_rgba(0,0,0,0.9)]">
          {!configured && (
            <div className="flex gap-3 p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>
                Sign-in is not configured on this server. Set <code className="font-mono">ADMIN_PASSWORD</code> and{' '}
                <code className="font-mono">APP_SECRET</code> in the environment and redeploy.
              </span>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-zinc-400">Username</span>
            <input
              className={`${inputClass} mt-1.5`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-400">Password</span>
            <div className="relative mt-1.5">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                className={`${inputClass} pl-10`}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          </label>

          {error && <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5">{error}</div>}

          <button type="submit" disabled={busy || !configured} className={`${buttonPrimary} w-full py-3`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 pt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/80" />
            Encrypted session · HttpOnly cookie
          </div>
        </form>
      </div>
    </div>
  );
}
