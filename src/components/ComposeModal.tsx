import React, { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Paperclip, X, PenSquare, CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-react';
import type { Account } from '../types.ts';
import { api, ApiError } from '../client/api.ts';
import { Modal, inputClass, buttonPrimary, buttonGhost } from './ui.tsx';
import type { ComposePrefill } from './EmailDetail.tsx';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  defaultAccountId: string;
  prefill: ComposePrefill | null;
  onEmailSent: () => void;
}

interface Attachment { filename: string; content: string; contentType: string; size: number }

const toHtml = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n/g, '<br/>')}</p>`)
    .join('');

export function ComposeModal(p: ComposeModalProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [quoted, setQuoted] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!p.isOpen) return;
    const pf = p.prefill ?? {};
    const preferred =
      pf.accountId ||
      (p.defaultAccountId !== 'all' ? p.defaultAccountId : '') ||
      p.accounts.find((a) => !/@(gmail|googlemail)\.com$/.test(a.email_address))?.id ||
      p.accounts[0]?.id ||
      '';
    setFrom(preferred);
    setTo(pf.to ?? '');
    setCc(pf.cc ?? '');
    setShowCc(Boolean(pf.cc));
    setBcc('');
    setSubject(pf.subject ?? '');
    setBody('');
    setQuoted(pf.body ?? '');
    setFiles([]);
    setResult(null);
  }, [p.isOpen, p.prefill, p.accounts, p.defaultAccountId]);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next: Attachment[] = [];
    for (const f of Array.from(list)) {
      if (f.size > 10 * 1024 * 1024) {
        setResult({ ok: false, text: `${f.name} is over 10 MB` });
        continue;
      }
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      next.push({ filename: f.name, content: btoa(bin), contentType: f.type || 'application/octet-stream', size: f.size });
    }
    setFiles((prev) => [...prev, ...next]);
  };

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ provider: string; attempts?: Array<{ provider: string; error: string }> }>('/api/send-email', {
        method: 'POST',
        json: {
          accountId: from,
          to,
          cc: cc || undefined,
          bcc: bcc || undefined,
          subject,
          htmlBody: toHtml(body) + quoted,
          inReplyToId: p.prefill?.inReplyToId,
          attachments: files.map(({ filename, content, contentType }) => ({ filename, content, contentType })),
        },
      });
      setResult({ ok: true, text: `Sent via ${r.provider}` });
      p.onEmailSent();
      setTimeout(p.onClose, 900);
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiError ? err.message : 'Send failed' });
    } finally {
      setBusy(false);
    }
  };

  const fromAccount = p.accounts.find((a) => a.id === from);

  return (
    <Modal
      open={p.isOpen}
      onClose={p.onClose}
      title={p.prefill?.inReplyToId ? 'Reply' : 'New message'}
      subtitle={fromAccount ? `Sending as ${fromAccount.email_address}` : 'Choose a mailbox to send from'}
      icon={<PenSquare className="w-5 h-5" />}
      width="max-w-3xl"
      footer={
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <button className={buttonGhost} onClick={() => fileRef.current?.click()}><Paperclip className="w-4 h-4" /> Attach</button>
          <div className="flex-1 min-w-0">
            {result && (
              <div className={`flex items-start gap-2 text-sm ${result.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                <span className="break-words">{result.text}</span>
              </div>
            )}
          </div>
          <button className={buttonPrimary} disabled={busy || !from || !to.trim() || !subject.trim() || !(body.trim() || quoted)} onClick={send}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[64px_1fr] items-center gap-x-3 gap-y-3">
          <span className="text-sm text-zinc-500">From</span>
          <div className="relative">
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} appearance-none pr-10`}>
              {p.accounts.length === 0 && <option value="">Connect a mailbox first</option>}
              {p.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.display_name ? `${a.display_name} <${a.email_address}>` : a.email_address}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          </div>

          <span className="text-sm text-zinc-500">To</span>
          <div className="flex items-center gap-2">
            <input className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com, another@…" autoFocus={!p.prefill?.to} />
            {!showCc && <button className="text-xs text-zinc-400 hover:text-zinc-100 px-2" onClick={() => setShowCc(true)}>Cc/Bcc</button>}
          </div>

          {showCc && (
            <>
              <span className="text-sm text-zinc-500">Cc</span>
              <input className={inputClass} value={cc} onChange={(e) => setCc(e.target.value)} />
              <span className="text-sm text-zinc-500">Bcc</span>
              <input className={inputClass} value={bcc} onChange={(e) => setBcc(e.target.value)} />
            </>
          )}

          <span className="text-sm text-zinc-500">Subject</span>
          <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send(); }}
          rows={12}
          autoFocus={Boolean(p.prefill?.to)}
          placeholder="Write your message…"
          className={`${inputClass} text-[15px] leading-relaxed resize-y min-h-[220px]`}
        />

        {quoted && (
          <details className="rounded-xl border border-[#1a1d27] bg-[#0a0c11] px-4 py-3 text-sm text-zinc-400">
            <summary className="cursor-pointer select-none">Quoted message included</summary>
            <div className="mt-3 max-h-48 overflow-y-auto text-xs text-zinc-500 whitespace-pre-wrap">
              {quoted.replace(/<br\s*\/?>/gi, '\n').replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/[ \t]+/g, ' ').trim()}
            </div>
          </details>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-2 rounded-lg border border-[#1f2331] bg-[#11131a] px-2.5 py-1.5 text-xs text-zinc-300">
                <Paperclip className="w-3.5 h-3.5 text-zinc-500" /> {f.filename}
                <span className="text-zinc-500">{Math.ceil(f.size / 1024)} KB</span>
                <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-rose-300"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
