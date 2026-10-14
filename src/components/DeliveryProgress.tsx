import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, Clock, XCircle, Send } from 'lucide-react';
import { api } from '../client/api.ts';
import type { DeliveryInfo, DeliveryStatus } from '../types.ts';

/**
 * Send → delivery progress.
 *
 * Accepted is not delivered: a provider takes any well-formed message and the
 * recipient's server may still refuse it minutes later. So after the send
 * request returns, the bar keeps going — polling the server, which asks
 * Resend — until the recipient's mail server has accepted it (delivered) or
 * refused it (bounced).
 */

export type SendPhase = 'idle' | 'checking' | 'sending' | 'error' | 'tracking';

const FINAL: DeliveryStatus[] = ['delivered', 'bounced', 'complained', 'failed'];
export const isFinalDelivery = (s?: string | null) => Boolean(s && FINAL.includes(s as DeliveryStatus));

/** Polls a sent message's delivery state until it is final: fast at first, then slower, then stops. */
export function useDeliveryTracking(emailId: string | null | undefined, initial?: Partial<DeliveryInfo> | null) {
  const [info, setInfo] = useState<Partial<DeliveryInfo> | null>(initial ?? null);
  const started = useRef(0);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    setInfo(initialRef.current ?? null);
    if (!emailId) return;
    started.current = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      let next: Partial<DeliveryInfo> | null = null;
      try {
        next = await api<DeliveryInfo>(`/api/emails/${encodeURIComponent(emailId)}/delivery`, { timeoutMs: 15_000 });
        if (!stopped) setInfo(next);
      } catch { /* transient; keep polling */ }
      if (stopped || isFinalDelivery(next?.status) || next?.trackable === false) return;
      const age = Date.now() - started.current;
      if (age > 15 * 60_000) return; // the Sent view and the sync keep following it
      timer = setTimeout(tick, age < 60_000 ? 2500 : 10_000);
    };
    if (!isFinalDelivery(initialRef.current?.status) && initialRef.current?.trackable !== false) {
      timer = setTimeout(tick, 1500);
    }
    return () => { stopped = true; clearTimeout(timer); };
  }, [emailId]);

  return info;
}

interface ProgressProps {
  phase: SendPhase;
  delivery?: Partial<DeliveryInfo> | null;
  /** Transport that accepted the message, from the send response. */
  provider?: string;
  error?: string | null;
  compact?: boolean;
}

type Tone = 'active' | 'ok' | 'warn' | 'bad' | 'neutral';

function describe({ phase, delivery, provider, error }: ProgressProps): { pct: number; tone: Tone; step: number; label: string; detail?: string } {
  const via = delivery?.transport || provider || 'the mail service';
  if (phase === 'checking') return { pct: 12, tone: 'active', step: 0, label: 'Checking recipient addresses…' };
  if (phase === 'sending') return { pct: 40, tone: 'active', step: 1, label: 'Sending…' };
  if (phase === 'error') return { pct: 100, tone: 'bad', step: 1, label: 'Not sent', detail: error ?? undefined };

  if (delivery?.trackable === false) {
    return { pct: 100, tone: 'neutral', step: 2, label: `Accepted by ${via}`, detail: 'This route does not report delivery, so receipt cannot be confirmed.' };
  }
  switch (delivery?.status) {
    case 'delivered':
      return { pct: 100, tone: 'ok', step: 3, label: "Delivered to the recipient's mail server" };
    case 'delivery_delayed':
      return { pct: 82, tone: 'warn', step: 3, label: "Delayed: the recipient's server is deferring it", detail: delivery.detail || `${via} keeps retrying automatically.` };
    case 'bounced':
      return { pct: 100, tone: 'bad', step: 3, label: 'Bounced: not delivered', detail: delivery.detail || 'The recipient server refused the message.' };
    case 'failed':
      return { pct: 100, tone: 'bad', step: 3, label: 'Failed: not delivered', detail: delivery.detail || undefined };
    case 'complained':
      return { pct: 100, tone: 'warn', step: 3, label: 'Delivered, but marked as spam by the recipient' };
    default:
      return { pct: 72, tone: 'active', step: 2, label: `Accepted by ${via}. Waiting for the recipient's server…` };
  }
}

const BAR: Record<Tone, string> = {
  active: 'bg-cyan-400',
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-rose-500',
  neutral: 'bg-zinc-400',
};
const TEXT: Record<Tone, string> = {
  active: 'text-cyan-200',
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
  neutral: 'text-zinc-300',
};

const STEPS = ['Check', 'Send', 'Accepted', 'Delivered'];

export function DeliveryProgress(p: ProgressProps) {
  const d = describe(p);
  const Icon = d.tone === 'ok' ? CheckCircle2 : d.tone === 'bad' ? XCircle : d.tone === 'warn' ? (p.delivery?.status === 'delivery_delayed' ? Clock : AlertTriangle) : d.tone === 'neutral' ? Send : Loader2;

  return (
    <div className="w-full" role="status" aria-live="polite">
      <div className={`flex items-start gap-2 text-sm ${TEXT[d.tone]}`}>
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${d.tone === 'active' ? 'animate-spin' : ''}`} />
        <div className="min-w-0">
          <div className="font-medium">{d.label}</div>
          {d.detail && <div className="text-xs opacity-80 break-words mt-0.5">{d.detail}</div>}
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-[#1a1d27] overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${BAR[d.tone]} ${d.tone === 'active' ? 'progress-live' : ''}`}
          style={{ width: `${d.pct}%` }}
        />
      </div>
      {!p.compact && (
        <div className="mt-1.5 grid grid-cols-4 text-[10px] font-mono uppercase tracking-wider">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`${i === 0 ? 'text-left' : i === 3 ? 'text-right' : 'text-center'} ${
                i < d.step || (i === d.step && d.tone !== 'active') ? (d.tone === 'bad' && i === d.step ? 'text-rose-400' : 'text-zinc-300') : i === d.step ? 'text-cyan-300' : 'text-zinc-600'
              }`}
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact status pill for sent messages in the list and header. */
export function DeliveryBadge({ status, transport }: { status?: string | null; transport?: string | null }) {
  if (!status) return null;
  const meta: Record<string, { label: string; cls: string }> = {
    sent: { label: transport === 'Resend' ? 'In transit' : 'Sent', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25' },
    delivery_delayed: { label: 'Delayed', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
    delivered: { label: 'Delivered', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' },
    bounced: { label: 'Bounced', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
    failed: { label: 'Failed', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
    complained: { label: 'Spam report', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  };
  const m = meta[status];
  if (!m) return null;
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${m.cls}`}>{m.label}</span>;
}
