import React, { useState } from 'react';
import { 
  Sparkles, 
  Search, 
  X, 
  BellRing, 
  Database, 
  Send, 
  ArrowRight,
  Terminal,
  Menu,
  Key,
  Activity,
  RefreshCw
} from 'lucide-react';
import type { ParsedSearchIntent, Account } from '../types.ts';

interface DashboardHeaderProps {
  accounts: Account[];
  selectedAccountId: string;
  onExecuteSmartSearch: (query: string) => Promise<void>;
  isSmartSearching: boolean;
  parsedIntent: ParsedSearchIntent | null;
  onClearSmartSearch: () => void;
  onOpenWebhookModal: () => void;
  onOpenDeveloperModal: () => void;
  onToggleSidebar?: () => void;
  activeSearchQuery: string;
  setActiveSearchQuery: (query: string) => void;
  currentView?: 'feed' | 'developer';
  onSelectView?: (view: 'feed' | 'developer') => void;
  alertCount?: number;
  onRefresh?: () => void;
  loading?: boolean;
}

const SAMPLE_QUERIES = [
  'Find urgent server alerts',
  'Term sheets or investment letters',
  'Receipts and cloud invoices',
];

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  accounts,
  selectedAccountId,
  onExecuteSmartSearch,
  isSmartSearching,
  parsedIntent,
  onClearSmartSearch,
  onOpenWebhookModal,
  onOpenDeveloperModal,
  onToggleSidebar,
  activeSearchQuery,
  setActiveSearchQuery,
  currentView = 'feed',
  onSelectView,
  alertCount = 0,
  onRefresh,
  loading = false,
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeSearchQuery.trim()) {
      onExecuteSmartSearch(activeSearchQuery);
    }
  };

  const handleSelectSample = (sample: string) => {
    setActiveSearchQuery(sample);
    onExecuteSmartSearch(sample);
  };

  const activeAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <header 
      id="dashboard-header"
      className="h-14 bg-[#090a0f] border-b border-[#1a1d27] flex items-center justify-between px-4 z-20 flex-shrink-0 select-none"
    >
      {/* Left: Brand Identity & Toggle */}
      <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title="Toggle Sidebar"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-[#151821] transition-colors"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-xs tracking-tight text-zinc-100 hidden sm:flex items-center gap-1.5">
            <span>AetherMail</span>
            <span className="text-[9px] uppercase font-mono px-1.5 py-0.2 rounded bg-[#11131a] text-amber-400 border border-amber-500/20">
              OBSIDIAN
            </span>
          </span>
        </div>

        {activeAccount && (
          <div className="hidden xl:flex items-center gap-1.5 text-[10px] text-zinc-400 border-l border-[#1a1d27] pl-2.5 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span className="truncate max-w-[110px] text-zinc-300">
              {activeAccount.email_address}
            </span>
          </div>
        )}
      </div>

      {/* Center: Gemini Natural Language Smart Search */}
      <div className="flex-1 max-w-2xl mx-1 sm:mx-4">
        <form onSubmit={handleSubmit} className="relative">
          <div
            className={`flex items-center bg-[#11131a] border rounded-xl px-3 py-1.5 transition-all shadow-sm ${
              isFocused
                ? 'border-amber-500/60 ring-1 ring-amber-500/20 bg-[#151821]'
                : 'border-[#1a1d27] hover:border-[#262b3a]'
            }`}
          >
            <div className="flex items-center space-x-1.5 text-amber-400 mr-2 flex-shrink-0">
              <Sparkles className={`w-4 h-4 ${isSmartSearching ? 'animate-spin' : ''}`} />
            </div>

            <input
              type="text"
              value={activeSearchQuery}
              onChange={(e) => setActiveSearchQuery(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Search with Gemini: 'Find urgent server alerts', 'Invoices due soon'..."
              className="flex-1 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
            />

            {activeSearchQuery && (
              <button
                type="button"
                onClick={() => {
                  setActiveSearchQuery('');
                  onClearSmartSearch();
                }}
                className="p-1 text-zinc-500 hover:text-zinc-300 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="submit"
              disabled={isSmartSearching || !activeSearchQuery.trim()}
              className="ml-2 flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-[10px] uppercase font-mono transition-all disabled:opacity-40 flex-shrink-0"
            >
              <span>{isSmartSearching ? 'Parsing...' : 'Search'}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </form>
      </div>

      {/* Right: Telemetry & View Mode Switcher */}
      <div className="flex items-center space-x-2 flex-shrink-0">
        {onSelectView && (
          <div className="flex items-center p-0.5 rounded-lg bg-[#11131a] border border-[#1a1d27]">
            <button
              onClick={() => onSelectView('feed')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                currentView === 'feed'
                  ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Incident Feed</span>
              {alertCount > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
              )}
            </button>

            <button
              onClick={() => onSelectView('developer')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                currentView === 'developer'
                  ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Developer &amp; Agents</span>
            </button>
          </div>
        )}

        {/* ntfy.sh status badge */}
        <div 
          className="hidden md:flex items-center space-x-1.5 px-2 py-1 rounded-md bg-[#11131a] border border-[#1a1d27] text-[10px] text-zinc-400 font-mono"
          title="ntfy.sh instant push alerts active"
        >
          <BellRing className="w-3 h-3 text-rose-400 animate-pulse" />
          <span className="text-zinc-300">ntfy.sh</span>
        </div>

        {/* Sync / Refresh button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-[#11131a] hover:bg-[#151821] border border-[#1a1d27] hover:border-[#262b3a] text-zinc-300 hover:text-zinc-100 text-xs transition-colors disabled:opacity-50"
            title="Sync & Pull Latest Emails"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${loading ? 'animate-spin' : ''}`} />
            <span className="text-[11px] font-mono hidden sm:inline">{loading ? 'Syncing...' : 'Sync'}</span>
          </button>
        )}

        {/* Ingestion webhook shortcut */}
        <button
          onClick={onOpenWebhookModal}
          className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-[#11131a] hover:bg-[#151821] border border-[#1a1d27] hover:border-[#262b3a] text-zinc-300 hover:text-zinc-100 text-xs transition-colors"
          title="Simulate External Ingestion Webhook"
        >
          <Send className="w-3 h-3 text-amber-400" />
          <span className="text-[11px]">Webhook</span>
        </button>
      </div>
    </header>
  );
};
