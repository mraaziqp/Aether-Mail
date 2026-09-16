import React from 'react';
import { 
  Sparkles, 
  AlertCircle, 
  Mail, 
  MailOpen, 
  Trash2,
  Check,
  X,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Zap
} from 'lucide-react';
import type { EmailItem, EmailCategory, ParsedSearchIntent, BatchActionType } from '../types.ts';

interface EmailListProps {
  emails: EmailItem[];
  selectedEmailId: string | null;
  onSelectEmail: (email: EmailItem) => void;
  onToggleRead: (email: EmailItem, e: React.MouseEvent) => void;
  onDeleteEmail: (id: string, e: React.MouseEvent) => void;
  selectedEmailIds: Set<string>;
  onToggleSelectEmail: (id: string, e: React.MouseEvent) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBatchAction: (action: BatchActionType) => Promise<void>;
  isBatchLoading: boolean;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  activeCategoryLabel: string;
  loading: boolean;
  parsedIntent?: ParsedSearchIntent | null;
  onClearSmartSearch?: () => void;
}

export const getCategoryBadgeStyle = (category: EmailCategory) => {
  switch (category) {
    case 'urgent':
      return 'bg-rose-950/70 text-rose-300 border-rose-800/80';
    case 'financial':
      return 'bg-amber-950/70 text-amber-300 border-amber-800/80';
    case 'work':
      return 'bg-blue-950/70 text-blue-300 border-blue-800/80';
    case 'personal':
      return 'bg-purple-950/70 text-purple-300 border-purple-800/80';
    case 'newsletter':
      return 'bg-emerald-950/70 text-emerald-300 border-emerald-800/80';
    case 'automated':
    default:
      return 'bg-[#151821] text-zinc-400 border-[#262b3a]';
  }
};

export const formatRelativeTime = (dateString: string | undefined): string => {
  if (!dateString) return '';
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Generates 2-letter initials from sender name
const getInitials = (sender: string): string => {
  const clean = sender.replace(/<.*>/, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || 'EM';
};

// Deterministic background avatar color
const getAvatarColor = (sender: string): string => {
  const colors = [
    'bg-blue-600/20 text-blue-400 border-blue-500/30',
    'bg-purple-600/20 text-purple-400 border-purple-500/30',
    'bg-amber-600/20 text-amber-400 border-amber-500/30',
    'bg-emerald-600/20 text-emerald-400 border-emerald-500/30',
    'bg-rose-600/20 text-rose-400 border-rose-500/30',
    'bg-cyan-600/20 text-cyan-400 border-cyan-500/30',
  ];
  let hash = 0;
  for (let i = 0; i < sender.length; i++) {
    hash = (hash + sender.charCodeAt(i)) % colors.length;
  }
  return colors[hash];
};

export const EmailList: React.FC<EmailListProps> = ({
  emails,
  selectedEmailId,
  onSelectEmail,
  onToggleRead,
  onDeleteEmail,
  selectedEmailIds,
  onToggleSelectEmail,
  onSelectAll,
  onClearSelection,
  onBatchAction,
  isBatchLoading,
  activeCategoryLabel,
  loading,
  parsedIntent,
  onClearSmartSearch,
}) => {
  const allSelected = emails.length > 0 && emails.every((e) => selectedEmailIds.has(e.id));
  const isAnySelected = selectedEmailIds.size > 0;

  return (
    <div 
      id="email-feed-column"
      className="w-96 xl:w-[440px] bg-[#090a0f] border-r border-[#1a1d27] flex flex-col h-full flex-shrink-0 select-none"
    >
      {/* Header Bar */}
      <div className="p-3 border-b border-[#1a1d27] bg-[#11131a] sticky top-0 z-10 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            {/* Select All Checkbox */}
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  if (allSelected) {
                    onClearSelection();
                  } else {
                    onSelectAll();
                  }
                }}
                className="w-3.5 h-3.5 rounded bg-[#090a0f] border-[#262b3a] text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                title={allSelected ? 'Deselect all' : 'Select all'}
              />
            </label>

            <h2 className="text-xs font-semibold text-zinc-100 tracking-tight flex items-center gap-1.5">
              <span>{activeCategoryLabel}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#151821] text-zinc-400 font-mono border border-[#262b3a]">
                {emails.length}
              </span>
            </h2>
          </div>

          <div className="flex items-center space-x-1">
            <span className="text-[10px] text-zinc-500 font-mono">
              COMMAND FEED
            </span>
          </div>
        </div>

        {/* Smart Search Intent Banner */}
        {parsedIntent && (
          <div className="p-2.5 rounded-lg bg-[#151821] border border-amber-500/30 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-amber-300 font-medium text-[11px]">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>AI Intent Parsed</span>
              </div>
              {onClearSmartSearch && (
                <button
                  onClick={onClearSmartSearch}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-0.5"
                >
                  <X className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-300 italic">
              &quot;{parsedIntent.intent_explanation}&quot;
            </p>
          </div>
        )}

        {/* Batch Action Bar */}
        {isAnySelected && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-[#151821] border border-[#262b3a] shadow-md animate-fade-in">
            <div className="flex items-center space-x-1.5">
              <Check className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-semibold text-zinc-100 font-mono">
                {selectedEmailIds.size} selected
              </span>
            </div>

            <div className="flex items-center space-x-1">
              <button
                onClick={() => onBatchAction('mark_read')}
                disabled={isBatchLoading}
                title="Mark selected as Read"
                className="p-1 px-2 rounded bg-[#1c202d] hover:bg-[#252b3d] text-zinc-200 text-[10px] flex items-center gap-1 font-mono transition-colors disabled:opacity-50"
              >
                <MailOpen className="w-3 h-3 text-amber-400" />
                <span>Read</span>
              </button>

              <button
                onClick={() => onBatchAction('mark_unread')}
                disabled={isBatchLoading}
                title="Mark selected as Unread"
                className="p-1 px-2 rounded bg-[#1c202d] hover:bg-[#252b3d] text-zinc-200 text-[10px] flex items-center gap-1 font-mono transition-colors disabled:opacity-50"
              >
                <Mail className="w-3 h-3 text-zinc-400" />
                <span>Unread</span>
              </button>

              <button
                onClick={() => onBatchAction('delete')}
                disabled={isBatchLoading}
                title="Delete or archive selected"
                className="p-1 px-2 rounded bg-rose-950/70 hover:bg-rose-900/80 border border-rose-800/80 text-rose-200 text-[10px] flex items-center gap-1 font-mono transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3 text-rose-400" />
                <span>Delete</span>
              </button>

              <button
                onClick={onClearSelection}
                disabled={isBatchLoading}
                title="Cancel selection"
                className="p-1 rounded text-zinc-500 hover:text-zinc-300 ml-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Emails Stream */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#151821]">
        {loading && emails.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 space-y-2">
            <div className="inline-block animate-spin text-amber-400 mb-1">
              <Sparkles className="w-5 h-5" />
            </div>
            <p className="text-xs font-mono">Syncing Cloud SQL...</p>
          </div>
        ) : emails.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 space-y-3">
            <div className="w-10 h-10 rounded-full bg-[#11131a] border border-[#1a1d27] flex items-center justify-center mx-auto text-zinc-400">
              <Mail className="w-5 h-5" />
            </div>
            <p className="text-xs font-medium text-zinc-300">No emails matched this filter</p>
            <p className="text-[11px] text-zinc-500 max-w-[220px] mx-auto">
              Try a different natural language search query or simulate an ingestion webhook!
            </p>
          </div>
        ) : (
          emails.map((email) => {
            const isSelected = selectedEmailId === email.id;
            const isChecked = selectedEmailIds.has(email.id);
            const initials = getInitials(email.sender);
            const avatarStyle = getAvatarColor(email.sender);
            const categoryStyle = getCategoryBadgeStyle(email.category);

            // Determine Command Center Status Tag: URGENT, ACTION NEEDED, PROCESSED
            let statusTag: { label: string; bg: string; text: string; border: string; pulse?: boolean } = {
              label: 'PROCESSED',
              bg: 'bg-zinc-800/40',
              text: 'text-zinc-400',
              border: 'border-zinc-700/50',
            };

            if (email.requires_alert || email.category === 'urgent') {
              statusTag = {
                label: 'URGENT',
                bg: 'bg-rose-950/80',
                text: 'text-rose-300',
                border: 'border-rose-700',
                pulse: true,
              };
            } else if (!email.is_read && (email.category === 'financial' || email.category === 'work')) {
              statusTag = {
                label: 'ACTION NEEDED',
                bg: 'bg-amber-950/70',
                text: 'text-amber-300',
                border: 'border-amber-700/60',
              };
            } else if (!email.is_read) {
              statusTag = {
                label: 'NEW',
                bg: 'bg-blue-950/60',
                text: 'text-blue-300',
                border: 'border-blue-700/60',
              };
            }

            return (
              <div
                key={email.id}
                onClick={() => onSelectEmail(email)}
                className={`p-3 transition-all cursor-pointer relative group border-l-2 ${
                  isSelected
                    ? 'bg-[#151821] border-l-amber-400 text-zinc-100 shadow-md'
                    : isChecked
                    ? 'bg-[#12141c] border-l-amber-500/70 text-zinc-200'
                    : !email.is_read
                    ? 'bg-[#0e1017] hover:bg-[#131620] border-l-amber-400/40 text-zinc-200'
                    : 'bg-[#090a0f] hover:bg-[#0f1118] border-l-transparent text-zinc-400'
                }`}
              >
                {/* Top Row: Checkbox, Sender Avatar, Sender Name, Status Tag & Time Badge */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center space-x-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleSelectEmail(email.id, e as any);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded bg-[#090a0f] border-[#262b3a] text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer flex-shrink-0"
                    />

                    {/* Sender Avatar */}
                    <div 
                      className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0 ${avatarStyle}`}
                      title={email.sender}
                    >
                      {initials}
                    </div>

                    <span
                      className={`text-xs truncate ${
                        !email.is_read ? 'font-semibold text-zinc-100' : 'font-normal text-zinc-300'
                      }`}
                    >
                      {email.sender.replace(/<.*>/, '').trim() || email.sender}
                    </span>
                  </div>

                  {/* Status Tag & Time Badge */}
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    <span 
                      className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border flex items-center gap-1 ${statusTag.bg} ${statusTag.text} ${statusTag.border}`}
                    >
                      {statusTag.pulse && (
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                      )}
                      {statusTag.label}
                    </span>

                    <span className="text-[10px] text-zinc-400 font-mono px-1 py-0.2 rounded bg-[#11131a] border border-[#1a1d27]">
                      {formatRelativeTime(email.received_at)}
                    </span>
                  </div>
                </div>

                {/* Subject Line */}
                <div className="mb-1.5 pl-6">
                  <h3
                    className={`text-xs truncate ${
                      !email.is_read ? 'font-medium text-zinc-100' : 'text-zinc-300'
                    }`}
                  >
                    {email.subject}
                  </h3>
                </div>

                {/* Gemini 1-Sentence Summary Highlight Card */}
                <div className="ml-6 p-2 rounded-lg bg-[#090a0f] border border-[#1a1d27] text-[11px] leading-relaxed text-zinc-300 group-hover:border-[#262b3a] transition-colors">
                  <div className="flex items-start gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="line-clamp-2 text-zinc-300 font-normal">
                      {email.ai_summary}
                    </p>
                  </div>
                </div>

                {/* Bottom Row: Category Badge & Quick Actions */}
                <div className="mt-2 ml-6 flex items-center justify-between">
                  <span
                    className={`text-[9px] uppercase font-mono tracking-wider px-2 py-0.5 rounded border ${categoryStyle}`}
                  >
                    {email.category}
                  </span>

                  {/* Quick Action Icons on hover */}
                  <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => onToggleRead(email, e)}
                      title={email.is_read ? 'Mark Unread' : 'Mark as Read'}
                      className="p-1 rounded hover:bg-[#1a1d27] text-zinc-400 hover:text-zinc-200"
                    >
                      {email.is_read ? <Mail className="w-3.5 h-3.5" /> : <MailOpen className="w-3.5 h-3.5 text-amber-400" />}
                    </button>
                    <button
                      onClick={(e) => onDeleteEmail(email.id, e)}
                      title="Delete email"
                      className="p-1 rounded hover:bg-[#1a1d27] text-zinc-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
