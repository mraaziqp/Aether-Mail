import React, { useEffect, useState } from 'react';
import { Plug, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { api, ApiError } from '../client/api.ts';
import { Modal, inputClass, buttonPrimary } from './ui.tsx';

interface Preset {
  id: string;
  label: string;
  imap: string;
  smtp: string;
  smtpPort: number;
  hint: React.ReactNode;
}

// Zoho serves custom-domain (organisation) mailboxes from the *pro* hosts;
// imap.zoho.com is only for personal @zoho.com addresses.
const PRESETS: Preset[] = [
  {
    id: 'resend',
    label: 'Business address (Resend)',
    imap: '',
    smtp: '',
    smtpPort: 0,
    hint: (
      <>
        For any address on your own domain. Resend delivers incoming mail to AetherMail by webhook and sends replies —
        no password needed. Mail to addresses you have not added is still captured; they appear automatically.
      </>
    ),
  },
  {
    id: 'zoho',
    label: 'Zoho (business domain)',
    imap: 'imappro.zoho.com',
    smtp: 'smtppro.zoho.com',
    smtpPort: 465,
    hint: (
      <>
        Enable IMAP in Zoho Mail → Settings → Mail Accounts → IMAP, then create an app password at{' '}
        <a className="text-cyan-300 hover:underline" href="https://accounts.zoho.com/home#security/app_password" target="_blank" rel="noreferrer">
          accounts.zoho.com → Security → App passwords <ExternalLink className="inline w-3 h-3" />
        </a>
        . EU data centre? Use <code className="font-mono">imappro.zoho.eu</code>.
      </>
    ),
  },
  {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    imap: 'imap.gmail.com',
    smtp: 'smtp.gmail.com',
    smtpPort: 465,
    hint: (
      <>
        Use a 16-character app password from{' '}
        <a className="text-cyan-300 hover:underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
          myaccount.google.com/apppasswords <ExternalLink className="inline w-3 h-3" />
        </a>{' '}
        (2-Step Verification must be on).
      </>
    ),
  },
  { id: 'outlook', label: 'Outlook / Microsoft 365', imap: 'outlook.office365.com', smtp: 'smtp.office365.com', smtpPort: 587, hint: 'Use an app password if your account has MFA.' },
  { id: 'custom', label: 'Other IMAP server', imap: '', smtp: '', smtpPort: 465, hint: 'Any IMAP server over TLS (port 993).' },
];

export function ConnectMailboxModal({
  isOpen,
  onClose,
  onConnected,
  defaultEmail,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConnected: () => void;
  defaultEmail?: string;
}) {
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [imap, setImap] = useState(PRESETS[0].imap);
  const [smtp, setSmtp] = useState(PRESETS[0].smtp);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEmail(defaultEmail ?? '');
    setPassword('');
    setResult(null);
  }, [isOpen, defaultEmail]);

  const choose = (pr: Preset) => {
    setPreset(pr);
    setImap(pr.imap);
    setSmtp(pr.smtp);
  };

  const isResend = preset.id === 'resend';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      if (isResend) {
        await api('/api/accounts/address', { method: 'POST', json: { email_address: email, display_name: name } });
        setResult({ ok: true, text: `${email} added. It receives through Resend and can send straight away.` });
        onConnected();
        return;
      }
      const r = await api<{ report?: { imported: number; status: string; error?: string }; folders: string[] }>('/api/accounts/connect', {
        method: 'POST',
        timeoutMs: 90_000,
        json: {
          email_address: email,
          password,
          display_name: name,
          imap_host: imap,
          imap_port: 993,
          smtp_host: smtp || undefined,
          smtp_port: preset.smtpPort,
        },
      });
      setResult({
        ok: true,
        text: `Connected. Imported ${r.report?.imported ?? 0} recent message(s) from ${r.folders.length} folder(s). New mail will keep arriving automatically.`,
      });
      onConnected();
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiError ? err.message : 'Could not connect' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="Connect a mailbox" subtitle="Business addresses run on Resend. Other mailboxes connect over IMAP; logins are verified and stored encrypted." icon={<Plug className="w-5 h-5" />}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((pr) => (
            <button
              type="button"
              key={pr.id}
              onClick={() => choose(pr)}
              className={`rounded-xl border px-3.5 py-3 text-left text-sm transition ${
                preset.id === pr.id ? 'border-cyan-500/50 bg-cyan-500/[0.08] text-zinc-50' : 'border-[#1f2331] text-zinc-400 hover:text-zinc-200 hover:border-[#2a3042]'
              }`}
            >
              {pr.label}
            </button>
          ))}
        </div>

        <p className="text-sm text-zinc-400 leading-relaxed rounded-xl bg-[#0a0c11] border border-[#1a1d27] px-4 py-3">{preset.hint}</p>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-zinc-400">Email address</span>
            <input className={`${inputClass} mt-1.5`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@arpcloudsolutions.co.za" required />
          </label>
          {!isResend && <label className="block">
            <span className="text-xs font-medium text-zinc-400">App password</span>
            <input className={`${inputClass} mt-1.5`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </label>}
          <label className="block">
            <span className="text-xs font-medium text-zinc-400">Display name (for sending)</span>
            <input className={`${inputClass} mt-1.5`} value={name} onChange={(e) => setName(e.target.value)} placeholder="ARP Cloud Solutions" />
          </label>
          {!isResend && <>
          <label className="block">
            <span className="text-xs font-medium text-zinc-400">IMAP server</span>
            <input className={`${inputClass} mt-1.5 font-mono text-[13px]`} value={imap} onChange={(e) => setImap(e.target.value)} placeholder="imap.example.com" required />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-400">SMTP server (optional)</span>
            <input className={`${inputClass} mt-1.5 font-mono text-[13px]`} value={smtp} onChange={(e) => setSmtp(e.target.value)} placeholder="smtp.example.com" />
          </label>
          </>}
        </div>

        {result && (
          <div className={`flex gap-2.5 rounded-xl border px-4 py-3 text-sm ${result.ok ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/25 bg-rose-500/10 text-rose-200'}`}>
            {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
            <span className="break-words">{result.text}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={buttonPrimary}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
            {busy ? (isResend ? 'Adding…' : 'Verifying login & importing…') : isResend ? 'Add address' : 'Connect mailbox'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
