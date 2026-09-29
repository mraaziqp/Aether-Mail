import React from 'react';
import {
  Inbox, Send, AlertOctagon, ShieldAlert, MailOpen, PenSquare, Plus, Layers, Terminal, Palette, LogOut,
  ChevronsLeft, ChevronsRight, Activity,
} from 'lucide-react';
import type { Account, StatusPayload, SessionUser } from '../types.ts';
import { CATEGORY_META, relativeTime } from './ui.tsx';

export type Folder = 'inbox' | 'unread' | 'alerts' | 'sent' | 'spam' | `cat:${string}`;

interface SidebarProps {
  status: StatusPayload | null;
  accounts: Account[];
  selectedAccountId: string;
  folder: Folder;
  collapsed: boolean;
  user: SessionUser | null;
  now: number;
  onToggleCollapse: () => void;
  onSelectAccount: (id: string) => void;
  onSelectFolder: (f: Folder) => void;
  onCompose: () => void;
  onConnect: () => void;
  onOpenHealth: () => void;
  onOpenDeveloper: () => void;
  onOpenTheme: () => void;
  onLogout: () => void;
  /** Rendered inside the mobile drawer. */
  mobile?: boolean;
}

export function accountHealth(a: Account, now = Date.now()): { tone: string; label: string } {
  if (a.sync_status === 'error' || a.last_sync_error) return { tone: 'bg-rose-400', label: a.last_sync_error || 'Sync error' };
  if (a.sync_status === 'syncing') return { tone: 'bg-cyan-400 animate-pulse', label: 'Syncing now' };
  if (!a.settings?.has_password && a.provider !== 'resend') return { tone: 'bg-amber-400', label: 'No password saved — reconnect to sync' };
  if (!a.last_synced_at) return { tone: a.provider === 'resend' ? 'bg-emerald-400' : 'bg-zinc-500', label: a.provider === 'resend' ? 'Receives via Resend webhook' : 'Not synced yet' };
  const age = now - new Date(a.last_synced_at).getTime();
  if (age > 15 * 60_000) return { tone: 'bg-amber-400', label: `Last synced ${relativeTime(a.last_synced_at, now)}` };
  return { tone: 'bg-emerald-400', label: `Synced ${relativeTime(a.last_synced_at, now)}` };
}

interface NavItemProps {
  icon: React.ReactNode; label: string; count?: number; active: boolean; collapsed: boolean; onClick: () => void; accent?: string;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, count, active, collapsed, onClick, accent }) => {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition relative ${
        active ? 'bg-[#161a24] text-zinc-50 border border-[#232838]' : 'text-zinc-400 hover:text-zinc-100 hover:bg-[#12151d] border border-transparent'
      } ${collapsed ? 'justify-center px-0' : ''}`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-cyan-400" />}
      <span className={`flex-shrink-0 ${active ? accent ?? 'text-cyan-300' : ''}`}>{icon}</span>
      {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
      {!collapsed && !!count && (
        <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded-md ${active ? 'bg-cyan-500/15 text-cyan-200' : 'bg-[#1a1d27] text-zinc-400'}`}>{count}</span>
      )}
      {collapsed && !!count && <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-cyan-400" />}
    </button>
  );
};

export function Sidebar(props: SidebarProps) {
  const { status, accounts, selectedAccountId, folder, now } = props;
  const collapsed = props.mobile ? false : props.collapsed;
  const cat = (k: string) => status?.categories.find((c) => c.category === k);
  const totalUnread = accounts.reduce((n, a) => n + (a.unread ?? 0), 0);
  const selectedUnread = selectedAccountId === 'all' ? totalUnread : accounts.find((a) => a.id === selectedAccountId)?.unread ?? 0;
  const anyError = accounts.some((a) => a.sync_status === 'error' || a.last_sync_error);

  return (
    <aside className={`${props.mobile ? 'flex' : 'hidden md:flex'} flex-col h-full border-r border-[#161922] bg-[#0b0d12]/80 backdrop-blur transition-[width] duration-200 ${collapsed ? 'w-[76px]' : 'w-[280px]'}`}>
      <div className={`flex items-center gap-2 p-4 ${collapsed ? 'flex-col' : ''}`}>
        <button
          onClick={props.onCompose}
          className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-zinc-950 bg-gradient-to-r from-cyan-400 to-sky-400 hover:from-cyan-300 hover:to-sky-300 shadow-[0_10px_30px_-10px_rgba(34,211,238,0.7)] transition ${collapsed ? 'w-11 h-11 flex-none p-0' : 'px-4'}`}
          title="Compose (c)"
        >
          <PenSquare className="w-4 h-4" />
          {!collapsed && 'Compose'}
        </button>
        <button onClick={props.onToggleCollapse} className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-[#161a24]" title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-6">
        <div className="space-y-1">
          <NavItem icon={<Inbox className="w-[18px] h-[18px]" />} label="Inbox" count={selectedUnread} active={folder === 'inbox'} collapsed={collapsed} onClick={() => props.onSelectFolder('inbox')} />
          <NavItem icon={<MailOpen className="w-[18px] h-[18px]" />} label="Unread" active={folder === 'unread'} collapsed={collapsed} onClick={() => props.onSelectFolder('unread')} />
          <NavItem icon={<AlertOctagon className="w-[18px] h-[18px]" />} label="Needs action" count={status?.alertCount} accent="text-amber-300" active={folder === 'alerts'} collapsed={collapsed} onClick={() => props.onSelectFolder('alerts')} />
          <NavItem icon={<Send className="w-[18px] h-[18px]" />} label="Sent" active={folder === 'sent'} collapsed={collapsed} onClick={() => props.onSelectFolder('sent')} />
          <NavItem icon={<ShieldAlert className="w-[18px] h-[18px]" />} label="Spam" count={cat('spam')?.unread} accent="text-orange-300" active={folder === 'spam'} collapsed={collapsed} onClick={() => props.onSelectFolder('spam')} />
        </div>

        <div>
          {!collapsed && (
            <div className="flex items-center justify-between px-3 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-zinc-500">Mailboxes</span>
              <button onClick={props.onConnect} className="p-1 rounded-md text-zinc-500 hover:text-cyan-300 hover:bg-[#161a24]" title="Connect mailbox">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="space-y-1">
            <NavItem icon={<Layers className="w-[18px] h-[18px]" />} label="All mailboxes" count={totalUnread} active={selectedAccountId === 'all'} collapsed={collapsed} onClick={() => props.onSelectAccount('all')} />
            {accounts.map((a) => {
              const h = accountHealth(a, now);
              const active = selectedAccountId === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => props.onSelectAccount(a.id)}
                  title={`${a.email_address}\n${h.label}`}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition border ${
                    active ? 'bg-[#161a24] border-[#232838]' : 'border-transparent hover:bg-[#12151d]'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  <span className="relative flex-shrink-0">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold border border-white/5 ${active ? 'bg-cyan-500/15 text-cyan-200' : 'bg-[#141821] text-zinc-300'}`}>
                      {a.email_address[0]?.toUpperCase()}
                    </span>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#0b0d12] ${h.tone}`} />
                  </span>
                  {!collapsed && (
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[13px] truncate ${active ? 'text-zinc-50' : 'text-zinc-300'}`}>{a.display_name || a.email_address.split('@')[0]}</span>
                      <span className="block text-[11px] text-zinc-500 truncate">{a.email_address}</span>
                    </span>
                  )}
                  {!collapsed && !!a.unread && <span className="text-[11px] font-mono text-zinc-400">{a.unread}</span>}
                </button>
              );
            })}
            {!collapsed && accounts.length === 0 && (
              <button onClick={props.onConnect} className="w-full rounded-xl border border-dashed border-[#262b3a] px-3 py-4 text-sm text-zinc-400 hover:text-cyan-200 hover:border-cyan-500/40 transition">
                Connect your first mailbox
              </button>
            )}
          </div>
        </div>

        <div>
          {!collapsed && <div className="px-3 mb-2 text-[11px] font-mono uppercase tracking-[0.14em] text-zinc-500">Smart labels</div>}
          <div className="space-y-1">
            {(['urgent', 'financial', 'work', 'personal', 'newsletter', 'automated'] as const).map((k) => (
              <NavItem
                key={k}
                icon={<span className={`block w-2.5 h-2.5 rounded-full ${CATEGORY_META[k].dot}`} />}
                label={CATEGORY_META[k].label}
                count={cat(k)?.unread}
                active={folder === `cat:${k}`}
                collapsed={collapsed}
                onClick={() => props.onSelectFolder(`cat:${k}`)}
              />
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t border-[#161922] p-3 space-y-1">
        <NavItem
          icon={<Activity className={`w-[18px] h-[18px] ${anyError ? 'text-rose-400' : 'text-emerald-400'}`} />}
          label={anyError ? 'Sync issues' : 'Sync health'}
          active={false}
          collapsed={collapsed}
          onClick={props.onOpenHealth}
        />
        <NavItem icon={<Terminal className="w-[18px] h-[18px]" />} label="Developer & API" active={false} collapsed={collapsed} onClick={props.onOpenDeveloper} />
        <NavItem icon={<Palette className="w-[18px] h-[18px]" />} label="Theme" active={false} collapsed={collapsed} onClick={props.onOpenTheme} />
        <NavItem icon={<LogOut className="w-[18px] h-[18px]" />} label={props.user ? `Sign out ${props.user.username}` : 'Sign out'} active={false} collapsed={collapsed} onClick={props.onLogout} />
      </div>
    </aside>
  );
}
