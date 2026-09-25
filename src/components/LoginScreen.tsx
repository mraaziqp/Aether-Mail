import React, { useState } from 'react';
import { Shield, Lock, User, Eye, EyeOff, ArrowRight, Sparkles, Key, CheckCircle2 } from 'lucide-react';

interface LoginScreenProps {
  onLoginSuccess: (user: {
    username: string;
    displayName: string;
    role: string;
    primaryEmail: string;
  }) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('mraaziqp');
  const [password, setPassword] = useState('114477');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        localStorage.setItem('aethermail_auth_token', data.token);
        localStorage.setItem('aethermail_user', JSON.stringify(data.user));
        onLoginSuccess(data.user);
      } else {
        setError(data.error || 'Authentication failed. Please verify credentials.');
      }
    } catch (err) {
      // Fallback client validation in case of offline/network blip
      if (username.trim() === 'mraaziqp' && password === '114477') {
        const fallbackUser = {
          username: 'mraaziqp',
          displayName: 'Mohamed Raaziq',
          role: 'Super Admin',
          primaryEmail: 'mraaziqp@gmail.com',
        };
        localStorage.setItem('aethermail_auth_token', 'local_tok_' + Date.now());
        localStorage.setItem('aethermail_user', JSON.stringify(fallbackUser));
        onLoginSuccess(fallbackUser);
      } else {
        setError('Network error or server unreachable. Please retry.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = () => {
    setUsername('mraaziqp');
    setPassword('114477');
    setError(null);
  };

  return (
    <div className="min-h-screen w-screen bg-[#07080c] flex items-center justify-center p-4 relative overflow-hidden select-none font-sans">
      {/* Background ambient radial glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-gradient-to-b from-amber-500/10 via-amber-600/5 to-transparent blur-3xl pointer-events-none rounded-full" />
      <div className="absolute -bottom-10 left-1/4 w-[400px] h-[300px] bg-emerald-500/5 blur-3xl pointer-events-none rounded-full" />

      {/* Main Terminal Card */}
      <div className="w-full max-w-md bg-[#0c0e14] border border-[#1e2330] rounded-2xl p-6 sm:p-8 shadow-2xl relative z-10 space-y-6">
        {/* Terminal Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/5 border border-amber-500/40 shadow-inner mb-2 text-amber-400">
            <Shield className="w-7 h-7" />
          </div>

          <div className="flex items-center justify-center gap-1.5">
            <h1 className="text-xl font-bold tracking-tight text-zinc-100 font-mono">
              AETHER<span className="text-amber-400">MAIL</span>
            </h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
              SECURE NOC
            </span>
          </div>

          <p className="text-xs text-zinc-400 font-mono tracking-tight">
            Network Operations Center // Identity Sentry
          </p>
        </div>

        {/* Security Notice Pill */}
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#11131a] border border-[#1a1d27] text-[11px] font-mono text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Terminal Gateway: Secure</span>
          </div>
          <span className="text-zinc-500">v2.5</span>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs font-mono space-y-1 animate-fade-in">
              <div className="font-bold flex items-center gap-1.5">
                <span>⚠️</span>
                <span>Authentication Denied</span>
              </div>
              <p className="text-[11px] text-rose-400/90">{error}</p>
            </div>
          )}

          {/* Username Field */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 flex items-center justify-between">
              <span>Admin Username</span>
              <span className="text-zinc-600 text-[10px]">ID: mraaziqp</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                <User className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#11131a] border border-[#1e2330] focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 text-xs text-zinc-100 placeholder-zinc-600 font-mono outline-none transition-all"
                placeholder="Enter username"
              />
            </div>
          </div>

          {/* Password Field */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 flex items-center justify-between">
              <span>Master Password</span>
              <span className="text-zinc-600 text-[10px]">PIN: 114477</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-[#11131a] border border-[#1e2330] focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 text-xs text-zinc-100 placeholder-zinc-600 font-mono outline-none transition-all tracking-wider"
                placeholder="Enter password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-zinc-300 transition-colors"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-mono font-bold text-xs tracking-wider uppercase transition-all shadow-lg hover:shadow-amber-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span>Verifying Credentials...</span>
            ) : (
              <>
                <span>Authenticate Terminal</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Quick Admin Helper */}
        <div className="pt-2 border-t border-[#1a1d27] flex items-center justify-between text-[11px] font-mono text-zinc-500">
          <span>Admin Credentials:</span>
          <button
            type="button"
            onClick={handleQuickFill}
            className="text-amber-400/80 hover:text-amber-300 underline underline-offset-2 flex items-center gap-1 transition-colors"
          >
            <span>Fill mraaziqp // 114477</span>
          </button>
        </div>
      </div>
    </div>
  );
};
