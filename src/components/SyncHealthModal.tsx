import React, { useState } from 'react';
import { Activity, RefreshCw, Loader2, Trash2, KeyRound, CheckCircle2, XCircle, Plug } from 'lucide-react';
import type { StatusPayload, Account } from '../types.ts';
import { api, ApiError } from '../client/api.ts';
import { Modal, relativeTime, buttonGhost, iconButton } from './ui.tsx';
import { accountHealth } from './Sidebar.tsx';

function Cap({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#1a1d27] bg-[#0a0c11] px-4 py-3">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" /> : <XCircle className="w-4 h-4 text-zinc-600 mt-0.5" />}
      <div>
        <div className={`text-sm ${ok ? 'text-zinc-200' : 'text-zinc-400'}`}>{label}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{hint}</div>
      </div>
    </div>
  );
}

export function SyncHealthModal({
  isOpen,
  onClose,
  status,
  now,
  onChanged,
  onReconnect,
}: {
  isOpen: boolean;
  onClose: () => void;
  status: StatusPayload | null;
  now: number;
  onChanged: () => void;
  onReconnect: (email: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const caps = status?.capabilities;

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg(await fn());
      onChanged();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const syncAll = () =>
    run('all', async () => {
      const r = await api<{ imported: number; durationMs: number }>('/api/sync/all?force=1', { method: 'POST', timeoutMs: 90_000 });
      return `Checked every mailbox in ${(r.durationMs / 1000).toFixed(1)}s — ${r.imported} new message(s).`;
    });

  const resync = (a: Account) =>
    run(a.id, async () => {
      const r = await api<{ imported: number; status: string; error?: string }>(`/api/accounts/${a.id}/resync`, { method: 'POST', timeoutMs: 90_000 });
      return r.status === 'ok' ? `${a.email_address}: re-scanned, ${r.imported} message(s) recovered.` : `${a.email_address}: ${r.error ?? r.status}`;
    });

  const remove = (a: Account) => {
    if (!confirm(`Disconnect ${a.email_address}? Its messages are removed from AetherMail (they stay on the mail server).`)) return;
    void run(`del:${a.id}`, async () => {
      await api(`/api/accounts/${a.id}`, { method: 'DELETE' });
      return `${a.email_address} disconnected.`;
    });
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Sync health"
      subtitle={caps?.backgroundSync ? 'Server keeps IMAP IDLE connections open — new mail is pushed within seconds.' : 'Serverless mode — mail is pulled by the scheduler and whenever the console is open.'}
      icon={<Activity className="w-5 h-5" />}
      width="max-w-3xl"
      footer={
        <div className="flex items-center gap-3">
          <span className="flex-1 text-sm text-zinc-400">{msg}</span>
          <button className={buttonGhost} onClick={syncAll} disabled={busy !== null}>
            {busy === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Check all now
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="space-y-2">
          {(status?.accounts ?? []).map((a) => {
            const h = accountHealth(a, now);
            return (
              <div key={a.id} className="flex items-center gap-4 rounded-2xl border border-[#1a1d27] bg-[#0b0d12] px-4 py-3.5">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${h.tone}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-zinc-100 truncate">{a.email_address}</span>
                    <span className="text-[11px] font-mono text-zinc-500">{a.settings?.imap_host ?? a.provider}</span>
                  </div>
                  <div className={`text-xs mt-0.5 break-words ${a.last_sync_error ? 'text-rose-300' : 'text-zinc-500'}`}>
                    {a.last_sync_error || `${h.label} · ${a.total ?? 0} messages · newest ${relativeTime(a.latest ?? null, now)}`}
                  </div>
                </div>
                {a.last_sync_error && (
                  <button className={iconButton} title="Update password" onClick={() => onReconnect(a.email_address)}><KeyRound className="w-4 h-4" /></button>
                )}
                {a.provider !== 'resend' && (
                  <button className={iconButton} title="Re-scan recent mail" disabled={busy !== null} onClick={() => resync(a)}>
                    {busy === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </button>
                )}
                <button className={`${iconButton} hover:text-rose-300`} title="Disconnect" disabled={busy !== null} onClick={() => remove(a)}><Trash2 className="w-4 h-4" /></button>
              </div>
            );
          })}
          {status && status.accounts.length === 0 && (
            <button onClick={() => onReconnect('')} className="w-full rounded-2xl border border-dashed border-[#262b3a] px-4 py-6 text-sm text-zinc-400 hover:text-cyan-200 inline-flex items-center justify-center gap-2">
              <Plug className="w-4 h-4" /> Connect a mailbox
            </button>
          )}
        </div>

        {caps && (
          <div>
            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-zinc-500 mb-2">Server capabilities</div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Cap ok={caps.resend} label="Resend sending" hint={caps.resend ? 'Business mail goes out through Resend' : 'Set RESEND_API_KEY'} />
              <Cap ok={caps.credentialVault} label="Encrypted credential vault" hint={caps.credentialVault ? 'Mailbox passwords sealed with APP_SECRET' : 'Set APP_SECRET to store mailbox passwords'} />
              <Cap ok={caps.backgroundSync || caps.serverless} label={caps.backgroundSync ? 'IMAP IDLE push' : 'Scheduled sync'} hint={caps.backgroundSync ? 'Always-on server watches every inbox' : 'Cron + GitHub Actions every 5 minutes'} />
              <Cap ok={caps.resendInbound} label="Resend inbound webhook" hint={caps.resendInbound ? 'Receiving via Resend is enabled' : 'Optional — RESEND_WEBHOOK_SECRET'} />
              <Cap ok={caps.ai} label="AI triage" hint={caps.ai ? 'Gemini classifies and summarises new mail' : 'Optional — GEMINI_API_KEY'} />
              <Cap ok={caps.push} label="Phone push alerts" hint={caps.push ? 'ntfy topic configured' : 'Optional — NTFY_TOPIC'} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
