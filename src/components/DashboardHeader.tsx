import React, { useEffect, useRef } from 'react';
import { Search, Sparkles, RefreshCw, Bell, BellOff, Menu, X, Mail, WifiOff } from 'lucide-react';
import type { SessionUser } from '../types.ts';
import { relativeTime, iconButton, Kbd } from './ui.tsx';

interface HeaderProps {
  user: SessionUser | null;
  search: string;
  onSearchChange: (v: string) => void;
  aiSearch: boolean;
  onToggleAiSearch: () => void;
  onSubmitSearch: () => void;
  onClearSearch: () => void;
  isSmartSearching: boolean;
  aiAvailable: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  online: boolean;
  liveMode: 'push' | 'poll';
  now: number;
  onSyncNow: () => void;
  notificationsOn: boolean;
  onToggleNotifications: () => void;
  onOpenMobileNav: () => void;
  onOpenHealth: () => void;
}

export function DashboardHeader(p: HeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const lastIso = p.lastSyncAt ? new Date(p.lastSyncAt).toISOString() : null;

  return (
    <header className="h-[68px] flex-shrink-0 flex items-center gap-3 md:gap-5 px-4 md:px-6 border-b border-[#161922] bg-[#0b0d12]/70 backdrop-blur-xl z-20">
      <button className={`${iconButton} md:hidden`} onClick={p.onOpenMobileNav} aria-label="Menu">
        <Menu className="w-5 h-5" />
      </button>

      <div className="hidden md:flex items-center gap-3 w-[230px] flex-shrink-0">
        <div className="relative">
          <div className="absolute inset-0 blur-lg bg-cyan-500/30 rounded-xl" />
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center">
            <Mail className="w-[18px] h-[18px] text-zinc-950" strokeWidth={2.4} />
          </div>
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-zinc-50">AetherMail</div>
          <div className="text-[11px] text-zinc-500 truncate">{p.user?.domain || 'command center'}</div>
        </div>
      </div>

      <form
        className="flex-1 max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          p.onSubmitSearch();
        }}
      >
        <div className={`group flex items-center gap-2 rounded-2xl border px-3.5 h-11 transition ${p.aiSearch ? 'border-violet-500/40 bg-violet-500/[0.06]' : 'border-[#1f2331] bg-[#0f1117] focus-within:border-cyan-500/40'}`}>
          {p.isSmartSearching ? <RefreshCw className="w-4 h-4 text-violet-300 animate-spin" /> : p.aiSearch ? <Sparkles className="w-4 h-4 text-violet-300" /> : <Search className="w-4 h-4 text-zinc-500" />}
          <input
            ref={inputRef}
            value={p.search}
            onChange={(e) => p.onSearchChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (p.onClearSearch(), inputRef.current?.blur())}
            placeholder={p.aiSearch ? 'Ask: "unpaid invoices from last week", "anything urgent from clients"…' : 'Search sender, subject, recipients…'}
            className="flex-1 bg-transparent outline-none text-sm text-zinc-100 placeholder:text-zinc-600 min-w-0"
          />
          {p.search && (
            <button type="button" onClick={p.onClearSearch} className="p-1 rounded-md text-zinc-500 hover:text-zinc-200">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {!p.search && <span className="hidden lg:block"><Kbd>/</Kbd></span>}
          <button
            type="button"
            onClick={p.onToggleAiSearch}
            disabled={!p.aiAvailable}
            title={p.aiAvailable ? 'Natural-language search (Gemini)' : 'Set GEMINI_API_KEY to enable AI search'}
            className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-lg border transition disabled:opacity-40 ${
              p.aiSearch ? 'border-violet-400/50 bg-violet-500/15 text-violet-200' : 'border-[#262b3a] text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3 h-3" /> AI
          </button>
        </div>
      </form>

      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={p.onOpenHealth}
          className="hidden lg:flex items-center gap-2 h-9 px-3 rounded-xl border border-[#1f2331] bg-[#0f1117] text-xs hover:border-[#2a3042] transition"
          title="Sync health"
        >
          {!p.online ? (
            <>
              <WifiOff className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-rose-300">Offline</span>
            </>
          ) : (
            <>
              <span className="relative flex w-2 h-2">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${p.syncing ? 'bg-cyan-400 animate-ping' : 'bg-emerald-400 animate-ping [animation-duration:2.5s]'}`} />
                <span className={`relative inline-flex w-2 h-2 rounded-full ${p.syncing ? 'bg-cyan-400' : 'bg-emerald-400'}`} />
              </span>
              <span className="text-zinc-300 font-medium">{p.liveMode === 'push' ? 'Live push' : 'Live'}</span>
              <span className="text-zinc-500 font-mono">{p.syncing ? 'syncing…' : relativeTime(lastIso, p.now)}</span>
            </>
          )}
        </button>
        <button className={iconButton} onClick={p.onSyncNow} title="Sync now (Shift+R)" disabled={p.syncing}>
          <RefreshCw className={`w-[18px] h-[18px] ${p.syncing ? 'animate-spin text-cyan-300' : ''}`} />
        </button>
        <button className={iconButton} onClick={p.onToggleNotifications} title={p.notificationsOn ? 'Desktop alerts on' : 'Enable desktop alerts'}>
          {p.notificationsOn ? <Bell className="w-[18px] h-[18px] text-cyan-300" /> : <BellOff className="w-[18px] h-[18px]" />}
        </button>
        {p.user && (
          <div className="hidden sm:flex items-center gap-2.5 pl-2 ml-1 border-l border-[#1a1d27]">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-800 border border-white/5 flex items-center justify-center text-sm font-semibold text-zinc-200">
              {p.user.displayName[0]?.toUpperCase()}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
