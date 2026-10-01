import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Bell } from 'lucide-react';
import { DashboardHeader } from './components/DashboardHeader.tsx';
import { Sidebar, type Folder } from './components/Sidebar.tsx';
import { EmailList } from './components/EmailList.tsx';
import { EmailDetail, type ComposePrefill } from './components/EmailDetail.tsx';
import { ComposeModal } from './components/ComposeModal.tsx';
import { ConnectMailboxModal } from './components/ConnectMailboxModal.tsx';
import { SyncHealthModal } from './components/SyncHealthModal.tsx';
import { DeveloperConsole } from './components/DeveloperConsole.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { ThemeManagerModal, type ThemeId } from './components/ThemeManagerModal.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { api, onUnauthorized } from './client/api.ts';
import { CATEGORY_META, parseSender } from './components/ui.tsx';
import type { EmailItem, EmailCategory, ParsedSearchIntent, SessionUser, StatusPayload } from './types.ts';

const PAGE = 100;
const STATUS_POLL_MS = 10_000;
const SYNC_POLL_MS = 30_000;

const readPref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const writePref = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
};

interface Toast { id: number; title: string; body: string; emailId?: string }

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [folder, setFolder] = useState<Folder>('inbox');
  const [accountId, setAccountId] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [aiSearch, setAiSearch] = useState(false);
  const [parsedIntent, setParsedIntent] = useState<ParsedSearchIntent | null>(null);
  const [isSmartSearching, setIsSmartSearching] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmailItem | null>(null);
  const [thread, setThread] = useState<EmailItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(Date.now());

  const [view, setView] = useState<'mail' | 'developer'>('mail');
  const [composeOpen, setComposeOpen] = useState(false);
  const [composePrefill, setComposePrefill] = useState<ComposePrefill | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectEmail, setConnectEmail] = useState('');
  const [healthOpen, setHealthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readPref('am.sidebarCollapsed', false));
  const [theme, setTheme] = useState<ThemeId>(() => readPref<ThemeId>('am.theme', 'obsidian'));
  const [notificationsOn, setNotificationsOn] = useState(() => readPref('am.notify', false) && typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [replyFocus, setReplyFocus] = useState(0);

  const knownIds = useRef<Set<string>>(new Set());
  const listReq = useRef(0);
  const detailCache = useRef<Map<string, EmailItem>>(new Map());
  const latestSeen = useRef<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const accounts = status?.accounts ?? [];
  const caps = status?.capabilities;

  // ---------------------------------------------------------------- session
  useEffect(() => {
    api<{ authenticated: boolean; user: SessionUser | null }>('/api/auth/session')
      .then((s) => setUser(s.authenticated ? s.user : null))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
    return onUnauthorized(() => setUser(null));
  }, []);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    writePref('am.theme', theme);
  }, [theme]);
  useEffect(() => writePref('am.sidebarCollapsed', collapsed), [collapsed]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // ---------------------------------------------------------------- alerts
  const chime = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!audioRef.current || audioRef.current.state === 'closed') audioRef.current = new Ctx();
      const ctx = audioRef.current;
      void ctx.resume();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(660, t);
      o.frequency.exponentialRampToValueAtTime(990, t + 0.14);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.36);
    } catch { /* audio blocked */ }
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 8000);
  }, []);

  const announce = useCallback(
    (fresh: EmailItem[]) => {
      const inbound = fresh.filter((e) => e.direction !== 'outbound' && e.category !== 'spam');
      if (!inbound.length) return;
      const top = inbound[0];
      const who = parseSender(top.sender).name;
      toast({ title: inbound.length > 1 ? `${inbound.length} new messages` : `New mail from ${who}`, body: top.subject, emailId: top.id });
      if (notificationsOn) {
        chime();
        try {
          new Notification(inbound.length > 1 ? `${inbound.length} new messages` : who, { body: `${top.subject}\n${top.account_email ?? ''}`, tag: top.id });
        } catch { /* ignore */ }
      }
    },
    [notificationsOn, chime, toast]
  );

  // ---------------------------------------------------------------- data
  const buildParams = useCallback(
    (before?: string) => {
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (accountId !== 'all') q.set('accountId', accountId);
      if (folder === 'unread') { q.set('unread', 'true'); q.set('direction', 'inbound'); }
      else if (folder === 'alerts') q.set('alertOnly', 'true');
      else if (folder === 'sent') q.set('category', 'sent');
      else if (folder === 'spam') q.set('category', 'spam');
      else if (folder.startsWith('cat:')) q.set('category', folder.slice(4));
      else q.set('direction', 'inbound');
      if (debouncedSearch.trim() && !aiSearch) q.set('search', debouncedSearch.trim());
      if (before) q.set('before', before);
      return q.toString();
    },
    [accountId, folder, debouncedSearch, aiSearch]
  );

  const fetchEmails = useCallback(
    async (silent = false) => {
      if (!user || parsedIntent) return;
      const req = ++listReq.current;
      if (!silent) setLoading(true);
      try {
        const rows = await api<EmailItem[]>(`/api/emails?${buildParams()}`);
        if (req !== listReq.current) return;
        setEmails(rows);
        setHasMore(rows.length === PAGE);
        setOnline(true);
      } catch {
        if (req === listReq.current) setOnline(false);
      } finally {
        if (req === listReq.current && !silent) setLoading(false);
      }
    },
    [user, parsedIntent, buildParams]
  );

  const loadMore = async () => {
    const last = emails[emails.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const rows = await api<EmailItem[]>(`/api/emails?${buildParams(last.received_at)}`);
      setEmails((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]);
      setHasMore(rows.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  /** Announces mail that arrived since the last check, whichever view is open. */
  const checkNewMail = useCallback(async (announceIt: boolean) => {
    const latest = await api<EmailItem[]>('/api/emails?limit=15&direction=inbound').catch(() => [] as EmailItem[]);
    const fresh = latest.filter((e) => !knownIds.current.has(e.id));
    latest.forEach((e) => knownIds.current.add(e.id));
    if (announceIt && fresh.length) announce(fresh);
  }, [announce]);

  const fetchStatus = useCallback(async () => {
    if (!user) return null;
    try {
      const s = await api<StatusPayload>('/api/status', { timeoutMs: 15_000 });
      setStatus(s);
      setOnline(true);
      if (s.latestEmailId !== latestSeen.current) {
        const first = latestSeen.current === null;
        latestSeen.current = s.latestEmailId;
        await checkNewMail(!first);
        if (!first) void fetchEmails(true);
      }
      return s;
    } catch {
      setOnline(false);
      return null;
    }
  }, [user, fetchEmails, checkNewMail]);

  const syncNow = useCallback(
    async (force = false) => {
      if (!user) return;
      setSyncing(true);
      try {
        await api(`/api/sync/all${force ? '?force=1' : ''}`, { method: 'POST', timeoutMs: 60_000 });
      } catch { /* status shows per-account errors */ }
      finally {
        setSyncing(false);
        await fetchStatus();
        await fetchEmails(true);
      }
    },
    [user, fetchStatus, fetchEmails]
  );

  useEffect(() => {
    if (!user) return;
    void fetchEmails(false);
  }, [user, fetchEmails]);

  // Timers below must always call the current callbacks, not the ones captured
  // when the timer was created (which would refresh a stale folder/filter).
  const fetchStatusRef = useRef(fetchStatus);
  const syncNowRef = useRef(syncNow);
  fetchStatusRef.current = fetchStatus;
  syncNowRef.current = syncNow;
  const serverPush = status?.capabilities.backgroundSync;

  // Live loop: cheap status poll always; client-driven IMAP sync only when the
  // server cannot hold IDLE connections itself (serverless). Paused in
  // background tabs, caught up immediately on return.
  useEffect(() => {
    if (!user || serverPush === undefined) {
      if (user) void fetchStatusRef.current();
      return;
    }
    if (!serverPush) void syncNowRef.current();
    const statusTimer = setInterval(() => document.visibilityState === 'visible' && void fetchStatusRef.current(), STATUS_POLL_MS);
    const syncTimer = setInterval(() => {
      if (!serverPush && document.visibilityState === 'visible') void syncNowRef.current();
    }, SYNC_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchStatusRef.current();
      if (!serverPush) void syncNowRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(statusTimer);
      clearInterval(syncTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [user, serverPush]);

  // ---------------------------------------------------------------- selection
  const selectedIdRef = useRef<string | null>(null);
  const openEmail = useCallback(async (e: EmailItem) => {
    selectedIdRef.current = e.id;
    setSelectedId(e.id);
    setMobileDetail(true);
    const cached = detailCache.current.get(e.id);
    setDetail(cached ?? null);
    setThread([]);
    if (!e.is_read) {
      setEmails((prev) => prev.map((x) => (x.id === e.id ? { ...x, is_read: true } : x)));
      void api(`/api/emails/${encodeURIComponent(e.id)}/read`, { method: 'PATCH', json: { is_read: true } }).then(() => fetchStatus());
    }
    if (!cached) setLoadingDetail(true);
    try {
      const [full, th] = await Promise.all([
        cached ? Promise.resolve(cached) : api<EmailItem>(`/api/emails/${encodeURIComponent(e.id)}`),
        api<EmailItem[]>(`/api/threads/${encodeURIComponent(e.thread_id)}`).catch(() => [] as EmailItem[]),
      ]);
      detailCache.current.set(e.id, full);
      if (detailCache.current.size > 60) detailCache.current.delete(detailCache.current.keys().next().value!);
      if (selectedIdRef.current === e.id) {
        setDetail({ ...full, is_read: true });
        setThread(th);
      }
    } finally {
      setLoadingDetail(false);
    }
  }, [fetchStatus]);

  const selected = useMemo(() => emails.find((e) => e.id === selectedId) ?? null, [emails, selectedId]);

  const toggleRead = async (e: EmailItem) => {
    const next = !e.is_read;
    setEmails((prev) => prev.map((x) => (x.id === e.id ? { ...x, is_read: next } : x)));
    setDetail((d) => (d && d.id === e.id ? { ...d, is_read: next } : d));
    await api(`/api/emails/${encodeURIComponent(e.id)}/read`, { method: 'PATCH', json: { is_read: next } }).catch(() => undefined);
    void fetchStatus();
  };

  const removeEmail = async (e: EmailItem) => {
    const idx = emails.findIndex((x) => x.id === e.id);
    setEmails((prev) => prev.filter((x) => x.id !== e.id));
    const nextSel = emails[idx + 1] ?? emails[idx - 1] ?? null;
    if (nextSel) void openEmail(nextSel);
    else { selectedIdRef.current = null; setSelectedId(null); setDetail(null); }
    await api(`/api/emails/${encodeURIComponent(e.id)}`, { method: 'DELETE' }).catch(() => undefined);
    void fetchStatus();
  };

  const setCategory = async (e: EmailItem, category: EmailCategory) => {
    setEmails((prev) => prev.map((x) => (x.id === e.id ? { ...x, category } : x)));
    setDetail((d) => (d && d.id === e.id ? { ...d, category } : d));
    await api(`/api/emails/${encodeURIComponent(e.id)}`, { method: 'PATCH', json: { category } }).catch(() => undefined);
    toast({ title: `Labelled ${CATEGORY_META[category].label}`, body: e.subject });
    void fetchStatus();
  };

  const batch = async (action: 'mark_read' | 'mark_unread' | 'delete') => {
    const ids = [...selectedIds];
    setBatchBusy(true);
    try {
      await api('/api/emails/batch', { method: 'POST', json: { emailIds: ids, action } });
      if (action === 'delete') setEmails((prev) => prev.filter((e) => !selectedIds.has(e.id)));
      else setEmails((prev) => prev.map((e) => (selectedIds.has(e.id) ? { ...e, is_read: action === 'mark_read' } : e)));
      setSelectedIds(new Set());
      void fetchStatus();
    } finally {
      setBatchBusy(false);
    }
  };

  const markAllRead = async () => {
    await api('/api/emails/mark-all-read', { method: 'POST', json: { accountId } });
    setEmails((prev) => prev.map((e) => ({ ...e, is_read: true })));
    void fetchStatus();
  };

  const runSmartSearch = async () => {
    if (!aiSearch || !search.trim()) return;
    setIsSmartSearching(true);
    try {
      const r = await api<{ emails: EmailItem[]; parsedIntent?: ParsedSearchIntent }>('/api/smart-search', { method: 'POST', json: { query: search, accountId } });
      setEmails(r.emails);
      setParsedIntent(r.parsedIntent ?? null);
      setHasMore(false);
    } catch (err) {
      toast({ title: 'AI search failed', body: (err as Error).message });
    } finally {
      setIsSmartSearching(false);
    }
  };

  const clearSearch = () => {
    setSearch('');
    setParsedIntent(null);
  };

  const openCompose = (prefill: ComposePrefill | null = null) => {
    setComposePrefill(prefill);
    setComposeOpen(true);
  };

  const toggleNotifications = async () => {
    if (typeof Notification === 'undefined') return toast({ title: 'Not supported', body: 'This browser has no desktop notifications.' });
    if (notificationsOn) { setNotificationsOn(false); writePref('am.notify', false); return; }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm === 'granted') {
      setNotificationsOn(true);
      writePref('am.notify', true);
      chime();
      toast({ title: 'Desktop alerts on', body: 'You will be notified the moment new mail arrives.' });
    }
  };

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    if (!user) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable || composeOpen || connectOpen || healthOpen) return;
      const idx = emails.findIndex((e) => e.id === selectedId);
      if (ev.key === 'j' || ev.key === 'ArrowDown') { const n = emails[Math.min(emails.length - 1, idx + 1)]; if (n) { ev.preventDefault(); void openEmail(n); } }
      else if (ev.key === 'k' || ev.key === 'ArrowUp') { const n = emails[Math.max(0, idx - 1)]; if (n) { ev.preventDefault(); void openEmail(n); } }
      else if (ev.key === 'c') { ev.preventDefault(); openCompose(); }
      else if (ev.key === 'r' && !ev.shiftKey && selected) { ev.preventDefault(); setReplyFocus((n) => n + 1); }
      else if (ev.key === 'R' && ev.shiftKey) { ev.preventDefault(); void syncNow(true); }
      else if (ev.key === 'u' && selected) void toggleRead(selected);
      else if ((ev.key === '#' || ev.key === 'Delete') && selected) void removeEmail(selected);
      else if (ev.key === 'Escape') { setSelectedIds(new Set()); setMobileDetail(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- render
  if (!authChecked) return <div className="app-aurora h-screen w-screen" />;
  if (!user) return <LoginScreen onLoginSuccess={setUser} />;

  const title = parsedIntent
    ? 'AI search'
    : debouncedSearch && !aiSearch
      ? `Search · “${debouncedSearch}”`
      : folder === 'inbox' ? 'Inbox'
      : folder === 'unread' ? 'Unread'
      : folder === 'alerts' ? 'Needs action'
      : folder === 'sent' ? 'Sent'
      : folder === 'spam' ? 'Spam'
      : CATEGORY_META[folder.slice(4) as EmailCategory]?.label ?? 'Mail';
  const lastSyncAt = accounts.reduce<number | null>((m, a) => {
    const t = a.last_synced_at ? new Date(a.last_synced_at).getTime() : 0;
    return t && (!m || t > m) ? t : m;
  }, null);

  const sidebarProps = {
    status,
    accounts,
    selectedAccountId: accountId,
    folder,
    collapsed,
    user,
    now,
    onToggleCollapse: () => setCollapsed((v) => !v),
    onSelectAccount: (id: string) => { setAccountId(id); setView('mail'); setParsedIntent(null); setMobileNav(false); },
    onSelectFolder: (f: Folder) => { setFolder(f); setView('mail'); setParsedIntent(null); setMobileNav(false); },
    onCompose: () => { openCompose(); setMobileNav(false); },
    onConnect: () => { setConnectEmail(''); setConnectOpen(true); setMobileNav(false); },
    onOpenHealth: () => { setHealthOpen(true); setMobileNav(false); },
    onOpenSettings: () => { setSettingsOpen(true); setMobileNav(false); },
    onOpenDeveloper: () => { setView('developer'); setMobileNav(false); },
    onOpenTheme: () => setThemeOpen(true),
    onLogout: async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined); setUser(null); },
  };

  return (
    <div className="app-aurora h-screen w-screen flex flex-col text-zinc-100 overflow-hidden antialiased">
      <DashboardHeader
        user={user}
        search={search}
        onSearchChange={(v) => { setSearch(v); if (!v) setParsedIntent(null); }}
        aiSearch={aiSearch}
        onToggleAiSearch={() => { setAiSearch((v) => !v); setParsedIntent(null); }}
        onSubmitSearch={runSmartSearch}
        onClearSearch={clearSearch}
        isSmartSearching={isSmartSearching}
        aiAvailable={Boolean(caps?.ai)}
        syncing={syncing || accounts.some((a) => a.sync_status === 'syncing')}
        lastSyncAt={lastSyncAt}
        online={online}
        liveMode={caps?.backgroundSync ? 'push' : 'poll'}
        now={now}
        onSyncNow={() => void syncNow(true)}
        notificationsOn={notificationsOn}
        onToggleNotifications={toggleNotifications}
        onOpenMobileNav={() => setMobileNav(true)}
        onOpenHealth={() => setHealthOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar {...sidebarProps} />

        {mobileNav && (
          <div className="fixed inset-0 z-40 md:hidden flex" onClick={() => setMobileNav(false)}>
            <div className="absolute inset-0 bg-black/60 animate-fade-in" />
            <div className="relative h-full animate-slide-down" onClick={(e) => e.stopPropagation()}>
              <Sidebar {...sidebarProps} mobile />
            </div>
          </div>
        )}

        {view === 'developer' ? (
          <DeveloperConsole onReturnToFeed={() => setView('mail')} onEmailIngested={() => { void fetchStatus(); void fetchEmails(true); }} />
        ) : (
          <div className="flex-1 flex overflow-hidden">
            <div className={`${mobileDetail ? 'hidden md:flex' : 'flex'} w-full md:w-auto`}>
              <EmailList
                emails={emails}
                title={title}
                selectedEmailId={selectedId}
                selectedIds={selectedIds}
                loading={loading}
                showAccount={accountId === 'all' && accounts.length > 1}
                hasMore={hasMore && !parsedIntent}
                loadingMore={loadingMore}
                parsedIntent={parsedIntent}
                onSelect={(e) => void openEmail(e)}
                onToggleSelect={(id) => setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                onSelectAll={() => setSelectedIds(new Set(emails.map((e) => e.id)))}
                onClearSelection={() => setSelectedIds(new Set())}
                onBatch={batch}
                onMarkAllRead={markAllRead}
                onLoadMore={loadMore}
                onClearIntent={clearSearch}
                batchBusy={batchBusy}
              />
            </div>
            <div className={`${mobileDetail ? 'flex' : 'hidden md:flex'} flex-1 min-w-0`}>
              <EmailDetail
                email={selected}
                detail={detail && detail.id === selectedId ? detail : null}
                thread={thread}
                loadingDetail={loadingDetail}
                aiAvailable={Boolean(caps?.ai)}
                now={now}
                onBack={() => setMobileDetail(false)}
                onToggleRead={toggleRead}
                onDelete={removeEmail}
                onSetCategory={setCategory}
                onOpenCompose={openCompose}
                onSent={() => { void fetchStatus(); void fetchEmails(true); }}
                replyFocusSignal={replyFocus}
              />
            </div>
          </div>
        )}
      </div>

      {/* Toasts */}
      <div className="fixed bottom-5 right-5 z-50 space-y-2 w-[340px] max-w-[calc(100vw-2.5rem)]">
        {toasts.map((t) => (
          <div key={t.id} className="flex gap-3 rounded-2xl border border-[#243049] bg-[#0f131c]/95 backdrop-blur px-4 py-3.5 shadow-2xl animate-pop-in">
            <Bell className="w-4 h-4 text-cyan-300 mt-0.5 flex-shrink-0" />
            <button
              className="flex-1 min-w-0 text-left"
              onClick={() => {
                const e = emails.find((x) => x.id === t.emailId);
                if (e) void openEmail(e);
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
              }}
            >
              <div className="text-sm font-medium text-zinc-100 truncate">{t.title}</div>
              <div className="text-xs text-zinc-400 truncate mt-0.5">{t.body}</div>
            </button>
            <button onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="text-zinc-500 hover:text-zinc-200"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>

      <ComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        accounts={accounts}
        defaultAccountId={accountId}
        prefill={composePrefill}
        onEmailSent={() => { void fetchStatus(); void fetchEmails(true); }}
      />
      <ConnectMailboxModal
        isOpen={connectOpen}
        onClose={() => setConnectOpen(false)}
        defaultEmail={connectEmail}
        onConnected={() => { void fetchStatus(); void fetchEmails(false); }}
      />
      <SyncHealthModal
        isOpen={healthOpen}
        onClose={() => setHealthOpen(false)}
        status={status}
        now={now}
        onChanged={() => { void fetchStatus(); void fetchEmails(true); }}
        onReconnect={(email) => { setConnectEmail(email); setHealthOpen(false); setConnectOpen(true); }}
      />
      <ThemeManagerModal isOpen={themeOpen} onClose={() => setThemeOpen(false)} currentTheme={theme} onSelectTheme={setTheme} />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} user={user} onMailboxesChanged={() => { void fetchStatus(); void fetchEmails(true); }} />
    </div>
  );
}
