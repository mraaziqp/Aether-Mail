import React, { useState } from 'react';
import { 
  Inbox, 
  AlertTriangle, 
  Briefcase, 
  DollarSign, 
  User, 
  Mail, 
  Bot, 
  Plus, 
  RefreshCw, 
  Sparkles, 
  Send,
  Database,
  Radio,
  Terminal,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Activity,
  CheckCircle2
} from 'lucide-react';
import type { Account, EmailCategory, EmailItem } from '../types.ts';

interface SidebarProps {
  accounts: Account[];
  emails: EmailItem[];
  selectedAccountId: string;
  selectedCategory: string;
  alertFilterOnly: boolean;
  onSelectAccount: (accountId: string) => void;
  onSelectCategory: (category: string) => void;
  onToggleAlertFilter: () => void;
  onOpenComposeModal?: () => void;
  onOpenWebhookModal: () => void;
  onOpenAccountModal: () => void;
  onOpenDeveloperModal: () => void;
  onRefresh: () => void;
  onSeedData: () => void;
  loading: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  currentView?: 'feed' | 'developer';
  onSelectView?: (view: 'feed' | 'developer') => void;
}

const CATEGORIES: { 
  id: string; 
  label: string; 
  icon: React.ComponentType<{ className?: string }>; 
  categoryKey?: EmailCategory;
  accentColor: string;
}[] = [
  { id: 'all', label: 'All Inboxes', icon: Inbox, accentColor: 'text-zinc-300' },
  { id: 'urgent', label: 'Urgent Action', icon: AlertTriangle, categoryKey: 'urgent', accentColor: 'text-rose-400' },
  { id: 'work', label: 'Work & Projects', icon: Briefcase, categoryKey: 'work', accentColor: 'text-blue-400' },
  { id: 'financial', label: 'Financial & Invoices', icon: DollarSign, categoryKey: 'financial', accentColor: 'text-amber-400' },
  { id: 'personal', label: 'Personal', icon: User, categoryKey: 'personal', accentColor: 'text-emerald-400' },
  { id: 'newsletter', label: 'Newsletters', icon: Mail, categoryKey: 'newsletter', accentColor: 'text-purple-400' },
  { id: 'automated', label: 'Automated & System', icon: Bot, categoryKey: 'automated', accentColor: 'text-cyan-400' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  accounts,
  emails,
  selectedAccountId,
  selectedCategory,
  alertFilterOnly,
  onSelectAccount,
  onSelectCategory,
  onToggleAlertFilter,
  onOpenComposeModal,
  onOpenWebhookModal,
  onOpenAccountModal,
  onOpenDeveloperModal,
  onRefresh,
  onSeedData,
  loading,
  isCollapsed = false,
  onToggleCollapse,
  currentView = 'feed',
  onSelectView,
}) => {
  const alertCount = emails.filter((e) => e.requires_alert && !e.is_read).length;
  const unreadCount = emails.filter((e) => !e.is_read).length;

  const getCategoryCount = (catId: string) => {
    if (catId === 'all') return unreadCount;
    return emails.filter((e) => e.category === catId && !e.is_read).length;
  };

  const getAccountUnread = (accId: string) => {
    return emails.filter((e) => e.account_id === accId && !e.is_read).length;
  };

  return (
    <aside 
      id="command-sidebar"
      className={`${
        isCollapsed ? 'w-16' : 'w-64 xl:w-72'
      } bg-[#0c0e14] border-r border-[#1a1d27] flex flex-col h-full select-none text-zinc-300 transition-all duration-200 flex-shrink-0 relative z-10`}
    >
      {/* Brand Header */}
      <div className="p-3.5 border-b border-[#1a1d27] bg-[#11131a] flex items-center justify-between">
        {!isCollapsed ? (
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#1a1d27] border border-[#262b3a] flex items-center justify-center text-amber-400 shadow-sm flex-shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xs font-semibold text-zinc-100 tracking-tight flex items-center gap-1.5 truncate">
                <span>AetherMail</span>
                <span className="text-[9px] uppercase font-mono px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  OBSIDIAN
                </span>
              </h1>
              <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>POSTGRES + GEMINI</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-[#1a1d27] border border-[#262b3a] flex items-center justify-center text-amber-400 mx-auto shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
        )}

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1 rounded-md hover:bg-[#1a1d27] text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Real-time Sync Heartbeat Badge */}
      {!isCollapsed && (
        <div className="px-3 pt-3 pb-1">
          <div className="px-2.5 py-1.5 rounded-lg bg-[#11131a] border border-[#1a1d27] flex items-center justify-between text-[10px]">
            <div className="flex items-center space-x-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-mono text-zinc-300 font-medium tracking-wide">SYNC: ONLINE</span>
            </div>
            <span className="font-mono text-emerald-400 text-[9px] bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
              0.02s LATENCY
            </span>
          </div>
        </div>
      )}

      {/* Quick Compose Dispatch Button */}
      <div className="px-3 pt-2 pb-1">
        <button
          onClick={onOpenComposeModal}
          title="Compose New Dispatch"
          className={`w-full flex items-center ${
            isCollapsed ? 'justify-center p-2' : 'justify-center space-x-2 px-3 py-2'
          } bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold rounded-lg text-xs shadow-md transition-all active:scale-[0.98]`}
        >
          <Send className="w-3.5 h-3.5 flex-shrink-0" />
          {!isCollapsed && <span>Compose Dispatch</span>}
        </button>
      </div>

      {/* Alert Priority Filter Banner */}
      <div className="p-3">
        <button
          onClick={onToggleAlertFilter}
          title="Filter Urgent Attention"
          className={`w-full flex items-center ${
            isCollapsed ? 'justify-center py-2.5' : 'justify-between px-3 py-2'
          } rounded-lg text-xs font-medium border transition-all ${
            alertFilterOnly
              ? 'bg-rose-950/60 border-rose-700/80 text-rose-200 shadow-sm'
              : 'bg-[#11131a] border-[#1a1d27] text-zinc-300 hover:border-rose-900/50 hover:bg-rose-950/20'
          }`}
        >
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              {alertCount > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${alertCount > 0 ? 'bg-rose-500' : 'bg-zinc-600'}`}></span>
            </span>
            {!isCollapsed && <span className="font-medium">Needs Attention</span>}
          </div>
          {!isCollapsed && alertCount > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] font-bold font-mono rounded bg-rose-900/80 text-rose-300 border border-rose-700/60">
              {alertCount}
            </span>
          )}
        </button>
      </div>

      {/* Smart Categories */}
      <div className="px-2 py-1 flex-1 overflow-y-auto space-y-4">
        <div>
          {!isCollapsed && (
            <div className="px-2 pb-1.5 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase font-mono">
              Smart Categories
            </div>
          )}
          <nav className="space-y-0.5">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = selectedCategory === cat.id && !alertFilterOnly;
              const count = getCategoryCount(cat.id);
              const isUrgent = cat.id === 'urgent';

              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    if (alertFilterOnly) onToggleAlertFilter();
                    onSelectCategory(cat.id);
                  }}
                  title={isCollapsed ? `${cat.label} (${count})` : undefined}
                  className={`w-full flex items-center ${
                    isCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'
                  } rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-[#1c202d] text-zinc-100 border border-[#2b3247] shadow-sm'
                      : 'text-zinc-400 hover:bg-[#151821] hover:text-zinc-200 border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${cat.accentColor}`} />
                    {!isCollapsed && <span className="truncate">{cat.label}</span>}
                  </div>
                  {!isCollapsed && count > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                      isUrgent 
                        ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60 font-bold' 
                        : 'bg-[#151821] text-zinc-300 border border-[#262b3a]'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Connected Accounts */}
        <div>
          {!isCollapsed && (
            <div className="px-2 pb-1.5 flex items-center justify-between text-[10px] font-semibold tracking-wider text-zinc-400 uppercase font-mono">
              <span>Mail Profiles</span>
              <button
                onClick={onOpenAccountModal}
                title="Connect New Account"
                className="text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="space-y-0.5">
            <button
              onClick={() => onSelectAccount('all')}
              title={isCollapsed ? 'All Accounts' : undefined}
              className={`w-full flex items-center ${
                isCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'
              } rounded-lg text-xs transition-colors ${
                selectedAccountId === 'all'
                  ? 'bg-[#1c202d] text-zinc-100 font-medium border border-[#2b3247]'
                  : 'text-zinc-400 hover:bg-[#151821] hover:text-zinc-200 border border-transparent'
              }`}
            >
              <div className="flex items-center space-x-2 truncate">
                <Radio className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                {!isCollapsed && <span className="truncate text-xs font-medium">All Inboxes (Unified)</span>}
              </div>
              {!isCollapsed && (
                <span className="text-[10px] text-zinc-400 font-mono px-1 py-0.2 rounded bg-[#11131a]">
                  {accounts.length}
                </span>
              )}
            </button>

            {/* Section 1: Business Accounts */}
            {!isCollapsed && accounts.some((a) => a.email_address.includes('arpcloudsolutions.co.za')) && (
              <div className="pt-2 pb-1 px-2 text-[9px] font-mono text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <span>🏢 ARP Cloud Solutions</span>
              </div>
            )}
            {accounts
              .filter((a) => a.email_address.includes('arpcloudsolutions.co.za') && !a.email_address.includes('jarvis'))
              .map((acc) => {
                const isActive = selectedAccountId === acc.id;
                const unread = getAccountUnread(acc.id);

                return (
                  <button
                    key={acc.id}
                    onClick={() => onSelectAccount(acc.id)}
                    title={isCollapsed ? acc.email_address : undefined}
                    className={`w-full flex items-center ${
                      isCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'
                    } rounded-lg text-xs transition-colors ${
                      isActive
                        ? 'bg-emerald-950/40 text-emerald-200 font-medium border border-emerald-500/40'
                        : 'text-zinc-400 hover:bg-[#151821] hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                      {!isCollapsed && (
                        <span className="truncate text-[11px] font-mono text-zinc-200">
                          {acc.email_address}
                        </span>
                      )}
                    </div>
                    {!isCollapsed && unread > 0 && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950 text-emerald-300 font-mono border border-emerald-800">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}

            {/* Section 2: Google Personal Accounts */}
            {!isCollapsed && accounts.some((a) => a.email_address.includes('@gmail.com')) && (
              <div className="pt-2 pb-1 px-2 text-[9px] font-mono text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                <span>📬 Google Accounts</span>
              </div>
            )}
            {accounts
              .filter((a) => a.email_address.includes('@gmail.com'))
              .map((acc) => {
                const isActive = selectedAccountId === acc.id;
                const unread = getAccountUnread(acc.id);

                return (
                  <button
                    key={acc.id}
                    onClick={() => onSelectAccount(acc.id)}
                    title={isCollapsed ? acc.email_address : undefined}
                    className={`w-full flex items-center ${
                      isCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'
                    } rounded-lg text-xs transition-colors ${
                      isActive
                        ? 'bg-blue-950/40 text-blue-200 font-medium border border-blue-500/40'
                        : 'text-zinc-400 hover:bg-[#151821] hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                      {!isCollapsed && (
                        <span className="truncate text-[11px] font-mono text-zinc-200">
                          {acc.email_address}
                        </span>
                      )}
                    </div>
                    {!isCollapsed && unread > 0 && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-blue-950 text-blue-300 font-mono border border-blue-800">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}

            {/* Section 3: Jarvis & Agent Identities */}
            {!isCollapsed && accounts.some((a) => a.email_address.includes('jarvis')) && (
              <div className="pt-2 pb-1 px-2 text-[9px] font-mono text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <span>🤖 Autonomous Agents</span>
              </div>
            )}
            {accounts
              .filter((a) => a.email_address.includes('jarvis'))
              .map((acc) => {
                const isActive = selectedAccountId === acc.id;
                const unread = getAccountUnread(acc.id);

                return (
                  <button
                    key={acc.id}
                    onClick={() => onSelectAccount(acc.id)}
                    title={isCollapsed ? acc.email_address : undefined}
                    className={`w-full flex items-center ${
                      isCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1.5'
                    } rounded-lg text-xs transition-colors ${
                      isActive
                        ? 'bg-amber-950/40 text-amber-200 font-medium border border-amber-500/40'
                        : 'text-zinc-400 hover:bg-[#151821] hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <Bot className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      {!isCollapsed && (
                        <span className="truncate text-[11px] font-mono text-amber-300">
                          {acc.email_address}
                        </span>
                      )}
                    </div>
                    {!isCollapsed && unread > 0 && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950 text-amber-300 font-mono border border-amber-800">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      {/* Command Actions Footer */}
      <div className="p-3 border-t border-[#1a1d27] space-y-2 bg-[#090a0f]">
        {/* Developer & Bot Engine Button */}
        <button
          onClick={() => {
            if (onSelectView) {
              onSelectView(currentView === 'developer' ? 'feed' : 'developer');
            } else {
              onOpenDeveloperModal();
            }
          }}
          title="Developer & Bot REST API (Root Access)"
          className={`w-full flex items-center ${
            isCollapsed ? 'justify-center p-2' : 'space-x-2 px-3 py-2'
          } rounded-lg text-xs font-medium transition-all ${
            currentView === 'developer'
              ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/50 shadow-sm'
              : 'bg-[#11131a] hover:bg-[#151821] text-amber-300/90 hover:text-amber-300 border border-amber-500/30'
          }`}
        >
          <Terminal className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
          {!isCollapsed && (
            <span className="flex items-center justify-between w-full font-mono text-[11px]">
              <span>Developer &amp; Agents</span>
              <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300">
                ROOT API
              </span>
            </span>
          )}
        </button>

        {/* Simulate Webhook */}
        {!isCollapsed && (
          <button
            onClick={onOpenWebhookModal}
            className="w-full flex items-center justify-center space-x-2 px-3 py-1.5 rounded-lg bg-[#11131a] hover:bg-[#151821] text-zinc-300 hover:text-zinc-100 border border-[#1a1d27] text-[11px] transition-all"
          >
            <Send className="w-3 h-3 text-amber-400" />
            <span>Simulate Ingestion</span>
          </button>
        )}

        {/* Seed button */}
        {!isCollapsed && (
          <button
            onClick={onSeedData}
            disabled={loading}
            className="w-full flex items-center justify-center space-x-1.5 px-3 py-1 rounded-md bg-[#0e1017] hover:bg-[#151821] text-zinc-400 hover:text-zinc-300 border border-[#1a1d27] text-[10px] font-mono transition-all disabled:opacity-50"
          >
            <Database className="w-2.5 h-2.5" />
            <span>Reset Demo Data</span>
          </button>
        )}

        {/* Cloud SQL connection status */}
        {!isCollapsed && (
          <div className="pt-1 px-1 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
            <span>Cloud SQL PostgreSQL</span>
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Connected
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
