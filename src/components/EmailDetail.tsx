import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Reply, ReplyAll, Forward, Trash2, Mail, MailOpen, Sparkles, Send, Loader2, AlertTriangle,
  Paperclip, ChevronDown, Tag, Check, Inbox, ShieldAlert,
} from 'lucide-react';
import type { EmailItem, EmailCategory } from '../types.ts';
import { api, ApiError } from '../client/api.ts';
import { Avatar, CategoryBadge, CATEGORY_META, parseSender, relativeTime, iconButton, buttonPrimary, buttonGhost } from './ui.tsx';

export interface ComposePrefill {
  accountId?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  inReplyToId?: string;
}

interface EmailDetailProps {
  email: EmailItem | null;
  detail: EmailItem | null;
  thread: EmailItem[];
  loadingDetail: boolean;
  aiAvailable: boolean;
  now: number;
  onBack: () => void;
  onToggleRead: (email: EmailItem) => void;
  onDelete: (email: EmailItem) => void;
  onSetCategory: (email: EmailItem, category: EmailCategory) => void;
  onOpenCompose: (prefill: ComposePrefill) => void;
  onSent: () => void;
  replyFocusSignal: number;
}

const quote = (e: EmailItem) => {
  const when = new Date(e.received_at).toLocaleString();
  const text = (e.full_body || e.body_snippet).replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/\s+/g, ' ').trim();
  return `<br/><br/><div style="border-left:2px solid #ccc;padding-left:12px;color:#555">On ${when}, ${e.sender} wrote:<br/>${text.slice(0, 4000)}</div>`;
};

const plainToHtml = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n/g, '<br/>')}</p>`)
    .join('');

function MessageBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const isHtml = /<[a-z][\s\S]*>/i.test(html);
  const doc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#1f2937;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}
  body{padding:28px 32px}
  img{max-width:100%;height:auto}
  table{max-width:100%}
  a{color:#0369a1}
  pre{white-space:pre-wrap}
  blockquote{margin:0 0 0 8px;padding-left:12px;border-left:2px solid #d1d5db;color:#4b5563}
</style></head><body>${isHtml ? html : `<pre style="font-family:inherit">${html.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</pre>`}</body></html>`,
    [html, isHtml]
  );

  const measure = () => {
    const d = ref.current?.contentDocument;
    if (d?.documentElement) setHeight(Math.max(120, Math.min(d.documentElement.scrollHeight + 4, 20000)));
  };

  return (
    <iframe
      ref={ref}
      title="Message body"
      srcDoc={doc}
      onLoad={() => {
        measure();
        // Late-loading images change the height.
        const d = ref.current?.contentDocument;
        d?.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure));
      }}
      // Same-origin lets the parent measure height; scripts stay disabled, so
      // nothing in the email can run.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="w-full block rounded-2xl bg-white border border-[#1f2331]"
      style={{ height }}
    />
  );
}

export function EmailDetail(p: EmailDetailProps) {
  const e = p.detail ?? p.email;
  const [reply, setReply] = useState('');
  const [tone, setTone] = useState<'professional' | 'concise' | 'friendly' | 'firm'>('professional');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setReply('');
    setResult(null);
    setShowEarlier(false);
    setCatOpen(false);
  }, [p.email?.id]);

  useEffect(() => {
    if (p.replyFocusSignal) replyRef.current?.focus();
  }, [p.replyFocusSignal]);

  if (!e) {
    return (
      <div className="flex-1 hidden md:flex flex-col items-center justify-center text-center p-10">
        <div className="relative mb-6">
          <div className="absolute inset-0 blur-3xl bg-cyan-500/10 rounded-full" />
          <div className="relative w-20 h-20 rounded-3xl bg-[#0f1117] border border-[#1f2331] flex items-center justify-center">
            <Inbox className="w-9 h-9 text-zinc-600" />
          </div>
        </div>
        <p className="text-base font-medium text-zinc-300">Select a message</p>
        <p className="text-sm text-zinc-500 mt-1.5">
          <span className="font-mono text-zinc-400">j</span>/<span className="font-mono text-zinc-400">k</span> to move ·{' '}
          <span className="font-mono text-zinc-400">r</span> reply · <span className="font-mono text-zinc-400">c</span> compose
        </p>
      </div>
    );
  }

  const sender = parseSender(e.sender);
  const outbound = e.direction === 'outbound';
  const earlier = p.thread.filter((t) => t.id !== e.id && new Date(t.received_at) <= new Date(e.received_at));
  const replyTarget = outbound ? (e.recipients || '').split(',')[0]?.trim() : sender.address;
  const reSubject = /^re:/i.test(e.subject) ? e.subject : `Re: ${e.subject}`;

  const draftWithAi = async () => {
    setDrafting(true);
    setResult(null);
    try {
      const r = await api<{ draftReply: string }>('/api/smart-reply', { method: 'POST', json: { emailId: e.id, tone } });
      setReply(r.draftReply);
      replyRef.current?.focus();
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiError ? err.message : 'Could not draft a reply' });
    } finally {
      setDrafting(false);
    }
  };

  const sendReply = async () => {
    if (!reply.trim() || !replyTarget) return;
    setSending(true);
    setResult(null);
    try {
      const r = await api<{ provider: string; attempts?: Array<{ provider: string; error: string }> }>('/api/send-email', {
        method: 'POST',
        json: {
          accountId: e.account_id,
          to: replyTarget,
          subject: reSubject,
          htmlBody: plainToHtml(reply) + quote(e),
          inReplyToId: e.id,
        },
      });
      setReply('');
      setResult({ ok: true, text: `Sent via ${r.provider}${r.attempts?.length ? ` (after ${r.attempts.map((a) => a.provider).join(', ')} failed)` : ''}` });
      p.onSent();
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiError ? err.message : 'Send failed' });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex-1 min-w-0 h-full flex flex-col bg-[#0a0b10]/30">
      {/* Toolbar */}
      <div className="h-[60px] flex-shrink-0 flex items-center gap-1 px-4 md:px-6 border-b border-[#14171f]">
        <button className={`${iconButton} md:hidden`} onClick={p.onBack} aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
        <button className={iconButton} title="Reply (r)" onClick={() => replyRef.current?.focus()}><Reply className="w-[18px] h-[18px]" /></button>
        <button
          className={iconButton}
          title="Reply all"
          onClick={() =>
            p.onOpenCompose({
              accountId: e.account_id,
              to: replyTarget,
              cc: (e.recipients || '').split(',').map((s) => s.trim()).filter((s) => s && s !== e.account_email && s !== replyTarget).join(', '),
              subject: reSubject,
              body: quote(e),
              inReplyToId: e.id,
            })
          }
        >
          <ReplyAll className="w-[18px] h-[18px]" />
        </button>
        <button
          className={iconButton}
          title="Forward"
          onClick={() =>
            p.onOpenCompose({
              accountId: e.account_id,
              subject: /^fwd?:/i.test(e.subject) ? e.subject : `Fwd: ${e.subject}`,
              body: `<br/><br/>---------- Forwarded message ----------<br/>From: ${e.sender}<br/>Date: ${new Date(e.received_at).toLocaleString()}<br/>Subject: ${e.subject}<br/><br/>${e.full_body ?? e.body_snippet}`,
            })
          }
        >
          <Forward className="w-[18px] h-[18px]" />
        </button>
        <div className="w-px h-5 bg-[#1f2331] mx-1.5" />
        <button className={iconButton} title={e.is_read ? 'Mark unread (u)' : 'Mark read (u)'} onClick={() => p.onToggleRead(e)}>
          {e.is_read ? <Mail className="w-[18px] h-[18px]" /> : <MailOpen className="w-[18px] h-[18px]" />}
        </button>
        <div className="relative">
          <button className={iconButton} title="Label" onClick={() => setCatOpen((v) => !v)}><Tag className="w-[18px] h-[18px]" /></button>
          {catOpen && (
            <div className="absolute left-0 top-11 z-30 w-48 rounded-xl border border-[#1f2331] bg-[#0f1117] p-1.5 shadow-2xl animate-slide-down">
              {(Object.keys(CATEGORY_META) as EmailCategory[]).map((k) => (
                <button
                  key={k}
                  onClick={() => { p.onSetCategory(e, k); setCatOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-zinc-300 hover:bg-[#161a24]"
                >
                  <span className={`w-2 h-2 rounded-full ${CATEGORY_META[k].dot}`} />
                  <span className="flex-1 text-left">{CATEGORY_META[k].label}</span>
                  {e.category === k && <Check className="w-3.5 h-3.5 text-cyan-300" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className={`${iconButton} hover:text-orange-300`} title="Mark as spam" onClick={() => p.onSetCategory(e, 'spam')}><ShieldAlert className="w-[18px] h-[18px]" /></button>
        <button className={`${iconButton} hover:text-rose-300`} title="Delete from AetherMail (#)" onClick={() => p.onDelete(e)}><Trash2 className="w-[18px] h-[18px]" /></button>
        <span className="ml-auto text-xs font-mono text-zinc-500 truncate hidden sm:block">{e.account_email}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[920px] mx-auto px-5 md:px-10 py-8 space-y-6">
          {/* Heading */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <CategoryBadge category={e.category} />
              {e.requires_alert && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono uppercase tracking-wider text-amber-300">
                  <AlertTriangle className="w-3 h-3" /> Needs action
                </span>
              )}
              {e.folder && e.folder !== 'INBOX' && <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{e.folder}</span>}
            </div>
            <h1 className="text-2xl md:text-[28px] leading-tight font-semibold tracking-tight text-zinc-50">{e.subject}</h1>
            <div className="flex items-center gap-4">
              <Avatar label={outbound ? (e.recipients || '?') : sender.name} size={46} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[15px] font-semibold text-zinc-100">{outbound ? 'You' : sender.name}</span>
                  <span className="text-sm text-zinc-500 truncate">&lt;{outbound ? e.account_email : sender.address}&gt;</span>
                </div>
                <div className="text-[13px] text-zinc-500 truncate">
                  to {e.recipients || e.account_email}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm text-zinc-300">{new Date(e.received_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
                <div className="text-xs text-zinc-500 font-mono">{relativeTime(e.received_at, p.now)}</div>
              </div>
            </div>
          </div>

          {/* AI summary */}
          {e.ai_summary && !outbound && e.ai_summary !== e.body_snippet.slice(0, 160) && (
            <div className="flex gap-3 rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-500/[0.08] to-cyan-500/[0.04] px-5 py-4">
              <Sparkles className="w-5 h-5 text-violet-300 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-violet-300/80 mb-1">Summary</div>
                <p className="text-[15px] text-zinc-200 leading-relaxed">{e.ai_summary}</p>
              </div>
            </div>
          )}

          {/* Earlier messages in the thread */}
          {earlier.length > 0 && (
            <div className="rounded-2xl border border-[#1a1d27] bg-[#0d0f15]">
              <button onClick={() => setShowEarlier((v) => !v)} className="w-full flex items-center gap-2 px-5 py-3 text-sm text-zinc-400 hover:text-zinc-200">
                <ChevronDown className={`w-4 h-4 transition ${showEarlier ? 'rotate-180' : ''}`} />
                {earlier.length} earlier message{earlier.length > 1 ? 's' : ''} in this conversation
              </button>
              {showEarlier && (
                <div className="border-t border-[#1a1d27] divide-y divide-[#1a1d27]">
                  {earlier.map((t) => (
                    <div key={t.id} className="px-5 py-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-200 font-medium">{t.direction === 'outbound' ? 'You' : parseSender(t.sender).name}</span>
                        <span className="text-xs text-zinc-500 font-mono">{new Date(t.received_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-zinc-400 mt-1.5 line-clamp-3">{t.body_snippet}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Body */}
          {p.loadingDetail && !p.detail?.full_body ? (
            <div className="rounded-2xl border border-[#1a1d27] p-8 space-y-3">
              <div className="h-3 w-2/3 rounded skeleton" />
              <div className="h-3 w-5/6 rounded skeleton" />
              <div className="h-3 w-1/2 rounded skeleton" />
            </div>
          ) : (
            <MessageBody html={p.detail?.full_body ?? e.body_snippet} />
          )}
          {e.has_attachments && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Paperclip className="w-4 h-4" /> This message has attachments — open it in your mail provider to download them.
            </div>
          )}

          {/* Reply */}
          <div className="rounded-2xl border border-[#1f2331] bg-[#0d0f15] overflow-hidden focus-within:border-cyan-500/40 transition">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#1a1d27] text-sm">
              <Reply className="w-4 h-4 text-zinc-500" />
              <span className="text-zinc-400 truncate">Reply to <span className="text-zinc-200">{replyTarget || '—'}</span></span>
              <span className="ml-auto text-xs text-zinc-500 hidden sm:block">from {e.account_email}</span>
            </div>
            <textarea
              ref={replyRef}
              value={reply}
              onChange={(ev) => setReply(ev.target.value)}
              onKeyDown={(ev) => {
                if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') void sendReply();
              }}
              rows={reply ? Math.min(16, reply.split('\n').length + 3) : 4}
              placeholder="Write a reply…  (Ctrl/⌘ + Enter to send)"
              className="w-full bg-transparent px-4 py-3.5 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 outline-none resize-none"
            />
            <div className="flex items-center gap-2 px-4 py-3 border-t border-[#1a1d27] flex-wrap">
              {p.aiAvailable && (
                <>
                  <select
                    value={tone}
                    onChange={(ev) => setTone(ev.target.value as typeof tone)}
                    className="bg-[#11131a] border border-[#1f2331] rounded-lg text-xs text-zinc-300 px-2 py-1.5 outline-none"
                  >
                    <option value="professional">Professional</option>
                    <option value="concise">Concise</option>
                    <option value="friendly">Friendly</option>
                    <option value="firm">Firm</option>
                  </select>
                  <button onClick={draftWithAi} disabled={drafting} className={`${buttonGhost} text-violet-200 border-violet-500/30`}>
                    {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Draft with AI
                  </button>
                </>
              )}
              <div className="flex-1" />
              {result && <span className={`text-xs ${result.ok ? 'text-emerald-300' : 'text-rose-300'} max-w-md`}>{result.text}</span>}
              <button onClick={sendReply} disabled={sending || !reply.trim() || !replyTarget} className={buttonPrimary}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
