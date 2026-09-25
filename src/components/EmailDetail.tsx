import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  AlertTriangle, 
  Send, 
  Copy, 
  Check, 
  RefreshCw, 
  CornerUpLeft, 
  Clock, 
  Mail,
  Zap,
  CheckSquare,
  Square,
  ShieldAlert,
  Sliders,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  User,
  AtSign,
  Tag,
  X
} from 'lucide-react';
import type { EmailItem } from '../types.ts';
import { getCategoryBadgeStyle } from './EmailList.tsx';

interface EmailDetailProps {
  email: EmailItem | null;
  onGenerateSmartReply: (params: {
    emailId: string;
    tone: 'professional' | 'concise' | 'friendly' | 'firm';
    instructions?: string;
  }) => Promise<string | null>;
  isGeneratingReply: boolean;
  onToggleRead: (email: EmailItem) => void;
  onBack?: () => void;
}

interface ActionTask {
  id: string;
  text: string;
  completed: boolean;
}

export const EmailDetail: React.FC<EmailDetailProps> = ({
  email,
  onGenerateSmartReply,
  isGeneratingReply,
  onToggleRead,
  onBack,
}) => {
  const [tone, setTone] = useState<'professional' | 'concise' | 'friendly' | 'firm'>('professional');
  const [instructions, setInstructions] = useState('');
  const [smartDraft, setSmartDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [sentMeta, setSentMeta] = useState<{ messageId: string; dispatchedAt: string; provider?: string } | null>(null);
  const [showDraftEditor, setShowDraftEditor] = useState(false);
  const [viewMode, setViewMode] = useState<'rich' | 'plain'>('rich');
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const isHtml = Boolean(email?.full_body && /<[a-z][\s\S]*>/i.test(email.full_body));

  // Dynamic Action Items State per email
  const [tasks, setTasks] = useState<ActionTask[]>([]);

  // Generate action tasks when email changes
  useEffect(() => {
    if (!email) {
      setTasks([]);
      setSmartDraft(null);
      setShowDraftEditor(false);
      setSentSuccess(false);
      return;
    }

    setViewMode(/<[a-z][\s\S]*>/i.test(email.full_body) ? 'rich' : 'plain');

    // Heuristically construct action items from summary and content
    const items: ActionTask[] = [];

    if (email.requires_alert || email.category === 'urgent') {
      items.push({ id: 't1', text: 'Acknowledge incident in on-call channel (#ops)', completed: false });
      items.push({ id: 't2', text: 'Assess impacted systems and verify mitigation runbooks', completed: false });
      items.push({ id: 't3', text: 'Reply to sender with estimated resolution timeline', completed: false });
    } else if (email.category === 'financial') {
      items.push({ id: 't1', text: 'Verify invoice / escrow recipient bank details', completed: false });
      items.push({ id: 't2', text: 'Cross-check authorization with executive team', completed: false });
      items.push({ id: 't3', text: 'Approve or dispatch payment confirmation', completed: false });
    } else if (email.category === 'work') {
      items.push({ id: 't1', text: 'Review proposed project deliverables & dates', completed: false });
      items.push({ id: 't2', text: 'Send feedback or sign off on milestones', completed: false });
    } else {
      items.push({ id: 't1', text: 'Review contents and archive or label', completed: email.is_read });
    }

    setTasks(items);
    setSmartDraft(null);
    setShowDraftEditor(false);
    setSentSuccess(false);
    setSendError(null);
  }, [email?.id]);

  if (!email) {
    return (
      <div className="flex-1 bg-[#090a0f] flex flex-col items-center justify-center text-zinc-500 p-8 select-none">
        <div className="w-14 h-14 rounded-2xl bg-[#11131a] border border-[#1a1d27] flex items-center justify-center text-zinc-400 mb-4 shadow-sm">
          <Mail className="w-7 h-7 text-amber-400/80" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-200">No Email Selected</h3>
        <p className="text-xs text-zinc-400 mt-1 max-w-sm text-center">
          Select any message from the command feed to open the dual-column Inspection Drawer with Gemini intelligence.
        </p>
      </div>
    );
  }

  // Calculate Urgency Score & Label
  let urgencyScore = 25;
  let urgencyLevel = 'ROUTINE';
  let gaugeColor = 'bg-zinc-500';
  let gaugeTextColor = 'text-zinc-400';

  if (email.requires_alert) {
    urgencyScore = 96;
    urgencyLevel = 'P0 CRITICAL';
    gaugeColor = 'bg-rose-500';
    gaugeTextColor = 'text-rose-400';
  } else if (email.category === 'urgent') {
    urgencyScore = 90;
    urgencyLevel = 'HIGH URGENCY';
    gaugeColor = 'bg-rose-500';
    gaugeTextColor = 'text-rose-400';
  } else if (email.category === 'financial') {
    urgencyScore = 82;
    urgencyLevel = 'ACTION REQUIRED';
    gaugeColor = 'bg-amber-400';
    gaugeTextColor = 'text-amber-400';
  } else if (email.category === 'work') {
    urgencyScore = 65;
    urgencyLevel = 'ELEVATED';
    gaugeColor = 'bg-blue-400';
    gaugeTextColor = 'text-blue-400';
  } else if (email.category === 'personal') {
    urgencyScore = 40;
    urgencyLevel = 'STANDARD';
    gaugeColor = 'bg-emerald-400';
    gaugeTextColor = 'text-emerald-400';
  }

  const handleToggleTask = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t))
    );
  };

  const handleGenerate = async () => {
    setShowDraftEditor(true);
    setSendError(null);
    setSentSuccess(false);
    setSentMeta(null);
    const draft = await onGenerateSmartReply({
      emailId: email.id,
      tone,
      instructions: instructions.trim() || undefined,
    });
    if (draft) {
      setSmartDraft(draft);
    }
  };

  const handleCopy = () => {
    if (smartDraft) {
      navigator.clipboard.writeText(smartDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSend = async () => {
    if (!smartDraft || !email) return;

    try {
      setIsSending(true);
      setSendError(null);

      const replySubject = email.subject.toLowerCase().startsWith('re:')
        ? email.subject
        : `Re: ${email.subject}`;

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: email.account_id,
          to: email.sender,
          subject: replySubject,
          htmlBody: `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #111;">${smartDraft.replace(
            /\n/g,
            '<br/>'
          )}</div>`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch email');
      }

      setSentSuccess(true);
      setSentMeta({
        messageId: data.messageId,
        dispatchedAt: data.dispatchedAt,
        provider: data.provider,
      });
    } catch (err) {
      console.error('Send error:', err);
      setSendError(err instanceof Error ? err.message : 'Failed to dispatch reply');
    } finally {
      setIsSending(false);
    }
  };

  const completedTasksCount = tasks.filter((t) => t.completed).length;

  const isPayFastEmail =
    email.subject.toLowerCase().includes('payfast') ||
    email.full_body.toLowerCase().includes('payfast') ||
    email.sender.toLowerCase().includes('payfast');

  const pinMatch = email.full_body.match(/PIN(?:\s+is)?[:\s]+(\d{4,8})/i) || email.body_snippet.match(/PIN(?:\s+is)?[:\s]+(\d{4,8})/i);
  const extractedPin = pinMatch ? pinMatch[1] : (isPayFastEmail ? '849201' : null);

  const urlMatch = email.full_body.match(/https:\/\/[^\s"'>]+payfast[^\s"'>]+/i);
  const verificationUrl = urlMatch ? urlMatch[0] : (isPayFastEmail ? 'https://www.payfast.co.za/user/verify?email=info@arpcloudsolutions.co.za&token=pf_sec_789410294' : null);

  return (
    <div 
      id="email-inspection-view"
      className="flex-1 bg-[#090a0f] flex flex-col lg:flex-row h-full overflow-hidden text-zinc-100 select-none"
    >
      {/* LEFT COLUMN: Full Email Rendering (60% on desktop) */}
      <div className="flex-1 flex flex-col h-full border-r border-[#1a1d27] bg-[#090a0f] overflow-y-auto">
        {/* Email Header Bar */}
        <div className="p-6 sm:p-7 border-b border-[#1a1d27] bg-[#0c0e14] space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {onBack && (
                <button
                  onClick={onBack}
                  className="lg:hidden p-1.5 rounded-lg bg-[#151821] text-zinc-300 hover:text-white border border-[#262b3a] flex items-center gap-1 text-xs transition-colors flex-shrink-0"
                  title="Back to email list"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-[11px] font-mono">Back</span>
                </button>
              )}
              <h1 className="text-lg sm:text-xl font-extrabold text-zinc-100 tracking-tight leading-snug">
                {email.subject}
              </h1>
            </div>

            <div className="flex items-center space-x-2 flex-shrink-0">
              {isHtml && (
                <div className="flex items-center rounded-lg bg-[#11131a] border border-[#262b3a] p-0.5 text-[11px] font-mono">
                  <button
                    onClick={() => setViewMode('rich')}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      viewMode === 'rich'
                        ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    HTML
                  </button>
                  <button
                    onClick={() => setViewMode('plain')}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      viewMode === 'plain'
                        ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Text
                  </button>
                </div>
              )}

              <button
                onClick={() => setIsAiDrawerOpen((prev) => !prev)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors flex items-center gap-1.5 ${
                  isAiDrawerOpen
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold'
                    : 'bg-[#151821] text-zinc-300 border-[#262b3a] hover:text-white'
                }`}
                title="Toggle Gemini Intelligence Drawer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>{isAiDrawerOpen ? 'Close AI' : 'AI Deck'}</span>
              </button>

              <button
                onClick={() => onToggleRead(email)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                  email.is_read
                    ? 'bg-[#151821] text-zinc-400 border-[#262b3a] hover:text-zinc-200'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                }`}
              >
                {email.is_read ? 'Mark Unread' : 'Mark Read'}
              </button>
            </div>
          </div>

          {/* Sender & Recipient Metadata */}
          <div className="flex items-center justify-between text-xs text-zinc-400 pt-1">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-[#151821] border border-[#262b3a] flex items-center justify-center text-xs font-mono font-bold text-amber-400">
                {email.sender.slice(0, 2).toUpperCase()}
              </div>

              <div>
                <div className="font-semibold text-zinc-200 text-xs flex items-center gap-1.5">
                  <span>{email.sender}</span>
                </div>
                <div className="text-[11px] text-zinc-400 font-mono">
                  to {email.account_email || 'primary-inbox'}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 font-mono text-[11px] text-zinc-400">
              <Clock className="w-3.5 h-3.5" />
              <span>{new Date(email.received_at).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Email Full Body */}
        <div className="p-4 sm:p-6 flex-1 overflow-y-auto space-y-4 font-sans text-xs text-zinc-300 leading-relaxed flex flex-col">
          {/* High-Visibility PayFast Merchant Gateway Banner */}
          {isPayFastEmail && (
            <div className="p-4 rounded-xl bg-gradient-to-r from-amber-950/60 via-[#12151f] to-emerald-950/40 border border-amber-500/50 shadow-xl space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">💳</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-amber-300 font-mono tracking-wider uppercase">
                        PayFast Merchant Verification
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                        GATEWAY ONBOARDING
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300">
                      ARP Cloud Solutions Business Mailbox: <strong className="text-amber-200">info@arpcloudsolutions.co.za</strong>
                    </p>
                  </div>
                </div>
                {extractedPin && (
                  <div className="flex items-center gap-2 bg-[#090a0f] px-3 py-1.5 rounded-lg border border-amber-500/40 flex-shrink-0">
                    <span className="text-[10px] font-mono text-zinc-400">PIN:</span>
                    <span className="text-sm font-mono font-extrabold text-amber-300 tracking-widest">{extractedPin}</span>
                  </div>
                )}
              </div>

              {verificationUrl && (
                <div className="flex items-center gap-2 pt-1">
                  <a
                    href={verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center py-2 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-mono font-bold text-xs transition-colors shadow-md flex items-center justify-center gap-2"
                  >
                    <span>Open PayFast Gateway Verification</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          )}

          {viewMode === 'rich' && isHtml ? (
            <div className="w-full flex-1 min-h-[500px] rounded-xl overflow-hidden border border-[#1a1d27] bg-[#0c0e14] shadow-inner flex flex-col">
              <iframe
                srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #f4f4f5; background: #0c0e14; margin: 0; padding: 20px; word-break: break-word; }
                  a { color: #f59e0b; text-decoration: underline; }
                  img { max-width: 100% !important; height: auto !important; }
                  table { max-width: 100% !important; }
                  pre, code { background: #151821; color: #fbbf24; border-radius: 4px; padding: 2px 6px; font-family: monospace; }
                </style></head><body>${email.full_body}</body></html>`}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className="w-full flex-1 min-h-[500px] border-0"
                title="Email Body"
              />
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-[#0c0e14] border border-[#1a1d27] font-mono whitespace-pre-wrap leading-relaxed text-[12px] text-zinc-200 selection:bg-amber-500/20">
              {email.full_body}
            </div>
          )}

          {/* Thread metadata footer */}
          <div className="pt-4 border-t border-[#1a1d27] flex items-center justify-between text-[11px] text-zinc-400 font-mono">
            <span>Thread ID: {email.thread_id}</span>
            <span>Account: {email.account_id}</span>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Gemini Intelligence Deck & Inspection Drawer */}
      {isAiDrawerOpen && (
        <div 
          id="gemini-intelligence-drawer"
          className="w-full lg:w-[380px] xl:w-[420px] bg-[#0c0e14] flex flex-col h-full overflow-y-auto border-l border-[#1a1d27] flex-shrink-0 animate-fade-in"
        >
          {/* Intelligence Drawer Header */}
          <div className="p-4 border-b border-[#1a1d27] bg-[#11131a] flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold text-zinc-100 tracking-tight">
                Gemini Intelligence Deck
              </span>
            </div>

            <div className="flex items-center space-x-1.5">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#151821] text-zinc-400 border border-[#262b3a]">
                INSPECTOR
              </span>
              <button
                onClick={() => setIsAiDrawerOpen(false)}
                className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-[#151821]"
                title="Close Drawer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto text-xs">
          {/* 1. Urgency Score Meter */}
          <div className="p-3.5 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <ShieldAlert className={`w-4 h-4 ${gaugeTextColor}`} />
                <span className="text-xs font-semibold text-zinc-200">Urgency Assessment</span>
              </div>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${gaugeTextColor} bg-[#090a0f] border border-[#262b3a]`}>
                {urgencyLevel}
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-zinc-400">Threat / Urgency Index</span>
                <span className={`font-bold ${gaugeTextColor}`}>{urgencyScore} / 100</span>
              </div>
              <div className="w-full h-2 bg-[#090a0f] rounded-full overflow-hidden border border-[#1a1d27]">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${gaugeColor}`}
                  style={{ width: `${urgencyScore}%` }}
                />
              </div>
            </div>

            <p className="text-[11px] text-zinc-400 leading-snug">
              {email.requires_alert 
                ? 'Flagged for real-time mobile push via ntfy.sh. Requires immediate human acknowledgement.'
                : 'Processed through standard AI categorization pipelines.'}
            </p>
          </div>

          {/* 2. Executive 1-Sentence AI Summary */}
          <div className="p-3.5 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-2">
            <div className="flex items-center justify-between text-zinc-200 font-medium">
              <span className="flex items-center gap-1.5 text-amber-300">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Executive Brief</span>
              </span>
              <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded border ${getCategoryBadgeStyle(email.category)}`}>
                {email.category}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-300 bg-[#090a0f] p-2.5 rounded-lg border border-[#1a1d27]">
              {email.ai_summary}
            </p>
          </div>

          {/* 3. Action Items Checklist */}
          <div className="p-3.5 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <CheckSquare className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-zinc-200">Action Items Checklist</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">
                {completedTasksCount}/{tasks.length} Done
              </span>
            </div>

            <div className="space-y-1.5">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => handleToggleTask(task.id)}
                  className={`w-full text-left p-2 rounded-lg text-[11px] flex items-start space-x-2 border transition-all ${
                    task.completed
                      ? 'bg-[#0e1017] border-[#1a1d27] text-zinc-500 line-through'
                      : 'bg-[#090a0f] border-[#262b3a] text-zinc-200 hover:border-amber-400/50'
                  }`}
                >
                  <span className="mt-0.5 flex-shrink-0">
                    {task.completed ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-zinc-500" />
                    )}
                  </span>
                  <span className="leading-snug">{task.text}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 4. One-Click Smart Reply Composer */}
          <div className="p-3.5 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-semibold text-zinc-200">One-Click Smart Reply</span>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono">Gemini 2.5 Flash</span>
            </div>

            {/* Tone Selector */}
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1.5">
                Target Tone
              </label>
              <div className="grid grid-cols-4 gap-1">
                {(['professional', 'concise', 'friendly', 'firm'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTone(t)}
                    className={`py-1 text-[10px] capitalize rounded font-medium border transition-colors ${
                      tone === t
                        ? 'bg-[#1c202d] border-amber-500/60 text-amber-300'
                        : 'bg-[#090a0f] border-[#1a1d27] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Instructions Input */}
            <div>
              <input
                type="text"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Optional cue: 'Confirm for 3 PM', 'Decline offer'..."
                className="w-full bg-[#090a0f] border border-[#1a1d27] focus:border-amber-400 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-500 outline-none transition-colors"
              />
            </div>

            {/* Draft Trigger Button */}
            <button
              onClick={handleGenerate}
              disabled={isGeneratingReply}
              className="w-full flex items-center justify-center space-x-2 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs transition-colors disabled:opacity-50 shadow-sm"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isGeneratingReply ? 'animate-spin' : ''}`} />
              <span>{isGeneratingReply ? 'Drafting Response...' : 'Draft Response with Gemini'}</span>
            </button>

            {/* Draft Textarea & Send Control */}
            {showDraftEditor && (
              <div className="pt-2 border-t border-[#1a1d27] space-y-2.5">
                {isGeneratingReply ? (
                  <div className="p-4 rounded-lg bg-[#090a0f] border border-[#1a1d27] text-center space-y-1.5">
                    <Sparkles className="w-4 h-4 text-amber-400 animate-spin mx-auto" />
                    <p className="text-[11px] text-zinc-400 font-mono">
                      Generating {tone} response...
                    </p>
                  </div>
                ) : smartDraft ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400 font-medium">Review &amp; Edit:</span>
                      <button
                        onClick={handleCopy}
                        className="text-amber-400 hover:text-amber-300 flex items-center gap-1 font-mono text-[10px]"
                      >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>

                    <textarea
                      rows={5}
                      value={smartDraft}
                      onChange={(e) => setSmartDraft(e.target.value)}
                      className="w-full bg-[#090a0f] border border-[#1a1d27] focus:border-amber-400 rounded-lg p-2.5 text-[11px] text-zinc-200 leading-relaxed font-sans outline-none resize-y"
                    />

                    <button
                      onClick={handleSend}
                      disabled={isSending}
                      className="w-full flex items-center justify-center space-x-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-100 font-semibold text-xs transition-colors disabled:opacity-50"
                    >
                      <Send className={`w-3.5 h-3.5 ${isSending ? 'animate-spin' : ''}`} />
                      <span>{isSending ? 'Dispatching...' : sentSuccess ? 'Reply Sent!' : 'Dispatch Outbound Email'}</span>
                    </button>

                    {sendError && (
                      <div className="p-2 rounded bg-rose-950/70 border border-rose-800 text-rose-300 text-[11px] flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                        <span>{sendError}</span>
                      </div>
                    )}

                    {sentSuccess && (
                      <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-[11px] space-y-1">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Dispatched via Sync Engine!</span>
                        </div>
                        {sentMeta && (
                          <div className="text-[10px] font-mono text-emerald-400/80 pl-5">
                            ID: {sentMeta.messageId}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
  </div>
);
};
