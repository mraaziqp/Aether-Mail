import React from 'react';
import { Square, Paperclip, AlertTriangle, CheckCheck, Mail, MailOpen, Trash2, X, Sparkles, Loader2, Inbox, ArrowUpRight } from 'lucide-react';
import type { EmailItem, ParsedSearchIntent } from '../types.ts';
import { Avatar, CategoryBadge, listTime, parseSender, iconButton } from './ui.tsx';

export { getCategoryBadgeStyle } from './ui.tsx';

interface EmailListProps {
  emails: EmailItem[];
  title: string;
  selectedEmailId: string | null;
  selectedIds: Set<string>;
  loading: boolean;
  showAccount: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  parsedIntent: ParsedSearchIntent | null;
  onSelect: (email: EmailItem) => void;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBatch: (action: 'mark_read' | 'mark_unread' | 'delete') => void;
  onMarkAllRead: () => void;
  onLoadMore: () => void;
  onClearIntent: () => void;
  batchBusy: boolean;
}

export function EmailList(p: EmailListProps) {
  const unread = p.emails.filter((e) => !e.is_read).length;
  const selecting = p.selectedIds.size > 0;

  return (
    <section className="h-full w-full md:w-[440px] xl:w-[500px] flex-shrink-0 flex flex-col border-r border-[#161922] bg-[#0a0b10]/60">
      <div className="px-5 pt-5 pb-3 border-b border-[#14171f]">
        {selecting ? (
          <div className="flex items-center gap-2 h-9 animate-slide-down">
            <button className={iconButton} onClick={p.onClearSelection} title="Clear selection"><X className="w-4 h-4" /></button>
            <span className="text-sm text-zinc-200 font-medium flex-1">{p.selectedIds.size} selected</span>
            <button className="text-xs text-zinc-400 hover:text-zinc-100 px-2" onClick={p.onSelectAll}>Select all</button>
            <button className={iconButton} disabled={p.batchBusy} onClick={() => p.onBatch('mark_read')} title="Mark read"><MailOpen className="w-4 h-4" /></button>
            <button className={iconButton} disabled={p.batchBusy} onClick={() => p.onBatch('mark_unread')} title="Mark unread"><Mail className="w-4 h-4" /></button>
            <button className={`${iconButton} hover:text-rose-300`} disabled={p.batchBusy} onClick={() => p.onBatch('delete')} title="Delete from AetherMail"><Trash2 className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="flex items-center justify-between h-9">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-zinc-50 truncate">{p.title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-zinc-500">
                {p.emails.length}{p.hasMore ? '+' : ''} · <span className="text-cyan-300/90">{unread} unread</span>
              </span>
              {unread > 0 && (
                <button className={iconButton} onClick={p.onMarkAllRead} title="Mark all as read">
                  <CheckCheck className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {p.parsedIntent && (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-violet-500/25 bg-violet-500/[0.07] px-3 py-2.5 animate-slide-down">
            <Sparkles className="w-4 h-4 text-violet-300 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-violet-100/90 flex-1 leading-relaxed">{p.parsedIntent.intent_explanation}</p>
            <button onClick={p.onClearIntent} className="text-violet-300 hover:text-violet-100"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {p.loading && p.emails.length === 0 ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex gap-3.5 p-3">
                <div className="w-10 h-10 rounded-xl skeleton" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded skeleton" />
                  <div className="h-3 w-3/4 rounded skeleton" />
                  <div className="h-3 w-2/3 rounded skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : p.emails.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-10 py-16">
            <div className="w-14 h-14 rounded-2xl bg-[#11131a] border border-[#1a1d27] flex items-center justify-center mb-4">
              <Inbox className="w-6 h-6 text-zinc-500" />
            </div>
            <p className="text-sm font-medium text-zinc-300">Nothing here</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-xs">New mail appears automatically — no refresh needed.</p>
          </div>
        ) : (
          <ul className="py-2">
            {p.emails.map((e) => {
              const active = e.id === p.selectedEmailId;
              const checked = p.selectedIds.has(e.id);
              const outbound = e.direction === 'outbound';
              const who = outbound ? `To: ${(e.recipients || '').split(',')[0] || 'recipient'}` : parseSender(e.sender).name;
              return (
                <li key={e.id} className="px-2.5">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => p.onSelect(e)}
                    onKeyDown={(ev) => ev.key === 'Enter' && p.onSelect(e)}
                    className={`group relative flex gap-3.5 rounded-2xl px-3.5 py-3.5 cursor-pointer transition border ${
                      active
                        ? 'bg-gradient-to-r from-[#141a26] to-[#121620] border-[#243049] shadow-[0_0_0_1px_rgba(34,211,238,0.08)]'
                        : 'border-transparent hover:bg-[#10131a]'
                    }`}
                  >
                    {!e.is_read && <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />}
                    <div
                      className="relative"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        p.onToggleSelect(e.id);
                      }}
                    >
                      <div className={`${selecting || checked ? 'hidden' : 'group-hover:hidden'}`}>
                        <Avatar label={outbound ? (e.recipients || '?') : parseSender(e.sender).name} />
                      </div>
                      <div className={`${selecting || checked ? 'flex' : 'hidden group-hover:flex'} w-10 h-10 rounded-xl border items-center justify-center ${checked ? 'bg-cyan-500/20 border-cyan-400/60' : 'border-[#2a3042] bg-[#11131a]'}`}>
                        {checked ? <CheckCheck className="w-4 h-4 text-cyan-200" /> : <Square className="w-4 h-4 text-zinc-500" />}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className={`flex-1 truncate text-[14px] ${e.is_read ? 'text-zinc-300' : 'text-zinc-50 font-semibold'}`}>
                          {outbound && <ArrowUpRight className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-zinc-500" />}
                          {who}
                        </span>
                        <span className={`text-[11px] font-mono flex-shrink-0 ${e.is_read ? 'text-zinc-500' : 'text-cyan-300/90'}`}>{listTime(e.received_at)}</span>
                      </div>
                      <div className={`truncate text-[13px] mt-0.5 ${e.is_read ? 'text-zinc-400' : 'text-zinc-200 font-medium'}`}>{e.subject}</div>
                      <div className="truncate text-[12.5px] text-zinc-500 mt-0.5">{e.ai_summary || e.body_snippet}</div>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {e.requires_alert && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono uppercase tracking-wider text-amber-300">
                            <AlertTriangle className="w-3 h-3" /> Action
                          </span>
                        )}
                        <CategoryBadge category={e.category} />
                        {e.has_attachments && <Paperclip className="w-3.5 h-3.5 text-zinc-500" />}
                        {p.showAccount && e.account_email && (
                          <span className="ml-auto text-[10px] font-mono text-zinc-500 truncate max-w-[170px]">{e.account_email}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
            {p.hasMore && (
              <li className="px-5 py-4">
                <button onClick={p.onLoadMore} disabled={p.loadingMore} className="w-full rounded-xl border border-[#1f2331] py-2.5 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-[#10131a] transition inline-flex items-center justify-center gap-2">
                  {p.loadingMore && <Loader2 className="w-4 h-4 animate-spin" />} Load older messages
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
