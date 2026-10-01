import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Send, Loader2, Paperclip, X, PenSquare, CheckCircle2, AlertTriangle, ChevronDown, Users, User, Check } from 'lucide-react';
import type { Account, ContactItem } from '../types.ts';
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

  // Contacts autocomplete state
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [isToFocused, setIsToFocused] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  const fileRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevOpenRef = useRef(false);
  const prevPrefillRef = useRef<ComposePrefill | null>(null);

  // Load contacts list whenever modal opens
  useEffect(() => {
    if (!p.isOpen) return;
    api<ContactItem[]>('/api/contacts')
      .then((data) => setContacts(data))
      .catch(() => {});
  }, [p.isOpen]);

  // Handle outside clicks to close contacts dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        toInputRef.current &&
        !toInputRef.current.contains(e.target as Node)
      ) {
        setShowContactPicker(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Form initialization: only reset fields when modal opens or prefill changes!
  // This prevents the background 10s status polling from wiping the recipient or message while typing.
  useEffect(() => {
    if (!p.isOpen) {
      prevOpenRef.current = false;
      return;
    }

    const isNewlyOpened = !prevOpenRef.current;
    const isNewPrefill = p.prefill !== prevPrefillRef.current;
    prevOpenRef.current = true;
    prevPrefillRef.current = p.prefill;

    if (isNewlyOpened || isNewPrefill) {
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
      setShowContactPicker(false);
    } else if (!from && p.accounts.length > 0) {
      // If accounts loaded asynchronously after open, pick sender without touching user's typed recipient
      const preferred =
        (p.defaultAccountId !== 'all' ? p.defaultAccountId : '') ||
        p.accounts.find((a) => !/@(gmail|googlemail)\.com$/.test(a.email_address))?.id ||
        p.accounts[0]?.id ||
        '';
      setFrom(preferred);
    }
  }, [p.isOpen, p.prefill, p.accounts, p.defaultAccountId, from]);

  // Compute active recipient query and filtered contact suggestions
  const currentRecipientToken = useMemo(() => {
    const parts = to.split(/[,;\n]+/);
    return (parts[parts.length - 1] ?? '').trim().toLowerCase();
  }, [to]);

  const suggestions = useMemo(() => {
    if (showContactPicker && !currentRecipientToken) {
      return contacts.slice(0, 8);
    }
    if (!currentRecipientToken) return [];
    return contacts
      .filter((c) => {
        const emailMatch = c.email.toLowerCase().includes(currentRecipientToken);
        const nameMatch = c.name?.toLowerCase().includes(currentRecipientToken);
        return emailMatch || nameMatch;
      })
      .slice(0, 8);
  }, [contacts, currentRecipientToken, showContactPicker]);

  const isDropdownOpen = (isToFocused && suggestions.length > 0) || (showContactPicker && suggestions.length > 0);

  const selectContact = (c: ContactItem) => {
    const formatted = c.name ? `${c.name} <${c.email}>` : c.email;
    const parts = to.split(',');
    if (parts.length <= 1) {
      setTo(formatted);
    } else {
      parts[parts.length - 1] = ' ' + formatted;
      setTo(parts.join(','));
    }
    setShowContactPicker(false);
    setActiveSuggestionIndex(0);
    toInputRef.current?.focus();
  };

  const handleToKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions[activeSuggestionIndex]) {
        e.preventDefault();
        selectContact(suggestions[activeSuggestionIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowContactPicker(false);
    }
  };

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
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={toInputRef}
                className={inputClass}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setActiveSuggestionIndex(0);
                }}
                onFocus={() => setIsToFocused(true)}
                onBlur={() => {
                  // Short timeout to allow click on dropdown items
                  setTimeout(() => setIsToFocused(false), 200);
                }}
                onKeyDown={handleToKeyDown}
                placeholder="name@company.com, another@…"
                autoFocus={!p.prefill?.to}
              />

              {/* Autocomplete suggestions dropdown */}
              {isDropdownOpen && (
                <div
                  ref={dropdownRef}
                  className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-[#232838] bg-[#0d1017] shadow-[0_12px_36px_rgba(0,0,0,0.6)] backdrop-blur overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1b1f2b] bg-[#121620] text-[11px] font-mono text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <Users className="w-3 h-3 text-cyan-400" /> Contacts Directory
                    </span>
                    <span className="text-zinc-500">↑↓ navigate · Enter to select</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-[#151923]">
                    {suggestions.map((c, idx) => {
                      const isActive = idx === activeSuggestionIndex;
                      return (
                        <button
                          key={c.email}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectContact(c);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${
                            isActive ? 'bg-cyan-500/15 text-cyan-200' : 'hover:bg-[#161a24] text-zinc-300'
                          }`}
                        >
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-semibold flex-shrink-0 border ${
                            isActive ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300' : 'bg-[#181c26] border-white/5 text-zinc-400'
                          }`}>
                            {c.name ? c.name[0]?.toUpperCase() : c.email[0]?.toUpperCase()}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-zinc-100 truncate">{c.name || c.email}</span>
                              {c.isAccount && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/60">
                                  Mailbox
                                </span>
                              )}
                            </div>
                            {c.name && <div className="text-[11px] text-zinc-500 truncate">{c.email}</div>}
                          </div>
                          {isActive && <Check className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowContactPicker((prev) => !prev)}
              className={`p-2 rounded-xl border transition ${
                showContactPicker
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                  : 'border-[#1b1f2b] bg-[#10131a] text-zinc-400 hover:text-zinc-200 hover:bg-[#161a24]'
              }`}
              title="Browse Contacts Directory"
            >
              <Users className="w-4 h-4" />
            </button>

            {!showCc && (
              <button
                type="button"
                className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 whitespace-nowrap"
                onClick={() => setShowCc(true)}
              >
                Cc/Bcc
              </button>
            )}
          </div>

          {showCc && (
            <>
              <span className="text-sm text-zinc-500">Cc</span>
              <input className={inputClass} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@company.com" />
              <span className="text-sm text-zinc-500">Bcc</span>
              <input className={inputClass} value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="bcc@company.com" />
            </>
          )}

          <span className="text-sm text-zinc-500">Subject</span>
          <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" />
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
