import React, { useState } from 'react';
import { 
  X, 
  Send, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  Code, 
  FileText 
} from 'lucide-react';
import type { Account, GeminiExtractionResult } from '../types.ts';

interface WebhookModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onIngestSuccess: () => void;
}

const SAMPLE_PAYLOADS = [
  {
    label: 'Critical Security Warning (Urgent Alert)',
    data: {
      account_id: '',
      subject: '[SECURITY] Unauthorized SSH Root Login Attempt Detected from IP 194.26.29.112',
      sender: 'Cloud Security Center <security-alerts@cloudinfra.org>',
      body_snippet: 'Multiple failed root authentications on bastion-cluster-04.',
      full_body: `SECURITY INCIDENT ALERT: HIGH SEVERITY
Time: September 16, 2026, 02:45 UTC
Target Host: bastion-cluster-04.internal (europe-west2)

Description:
Our intrusion detection system recorded 12 failed authentication attempts for user 'root' within 60 seconds from an untrusted ASN (194.26.29.112). 

Mandatory Next Steps:
1. Immediately verify whether any engineer is authorized to connect from this subnet.
2. Rotate bastion SSH keys if compromised.
3. Review audit logs in Cloud Console.

Failure to acknowledge within 30 minutes will escalate to on-call SecOps lead.`,
    },
  },
  {
    label: 'Founder Investment Inquiry (Financial / High Value)',
    data: {
      account_id: '',
      subject: 'Follow-up: $3.5M Lead Investment Opportunity in Aether Labs',
      sender: 'David Sacks <dsacks@craftventures.internal>',
      body_snippet: 'We loved your demo yesterday. Prepared to issue term sheet tomorrow morning.',
      full_body: `Hi Alex,

The partnership was deeply impressed by your presentation yesterday on the unified AI intelligence layer. 

We are discussing leading your current seed extension with $3.5M on the agreed terms. Before we finalize the term sheet for our Monday partner meeting, can you confirm:
1. Your target burn rate for Q4 2026.
2. Current contract commitments for the enterprise tier.

Looking forward to hearing from you today so our counsel can begin drafting.

Best,
David Sacks`,
    },
  },
  {
    label: 'Vendor Cloud Invoice (Financial / Automated)',
    data: {
      account_id: '',
      subject: 'Invoice #INV-2026-9938 Due on October 1st: Snowflake Data Cloud',
      sender: 'Snowflake Billing <ar@snowflake.com>',
      body_snippet: 'Your statement for August usage is ready for review.',
      full_body: `Dear Valued Customer,

Your Snowflake invoice #INV-2026-9938 for the period ending August 31, 2026 is now available.

Amount Due: $2,840.15 USD
Due Date: October 1, 2026
Payment Terms: Net 30

To view your invoice details, breakdown of warehouse compute credits, or to initiate payment via wire or ACH, please visit your account billing portal.

Thank you for choosing Snowflake.`,
    },
  },
  {
    label: 'Family Dinner (Personal)',
    data: {
      account_id: '',
      subject: 'Sunday family dinner at Mom & Dad’s house at 5:30 PM',
      sender: 'Claire Morgan <claire.morgan@family.org>',
      body_snippet: 'Making homemade lasagna and garlic bread this Sunday!',
      full_body: `Hey Alex!

Mom wanted me to check if you are free this Sunday around 5:30 PM for dinner. She is making her famous four-cheese lasagna and Dad bought apple pie from the local bakery.

Let us know if you can make it and if you want us to save you any leftovers if you are running late from work!

Love,
Claire`,
    },
  },
];

export const WebhookModal: React.FC<WebhookModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onIngestSuccess,
}) => {
  const defaultAccountId = accounts[0]?.id || 'acc_primary_work';
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [subject, setSubject] = useState(SAMPLE_PAYLOADS[0].data.subject);
  const [sender, setSender] = useState(SAMPLE_PAYLOADS[0].data.sender);
  const [fullBody, setFullBody] = useState(SAMPLE_PAYLOADS[0].data.full_body);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    data?: any;
    error?: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleSelectSample = (sample: typeof SAMPLE_PAYLOADS[0]) => {
    setSubject(sample.data.subject);
    setSender(sample.data.sender);
    setFullBody(sample.data.full_body);
    setResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    const payload = {
      account_id: accountId || defaultAccountId,
      subject,
      sender,
      full_body: fullBody,
      received_at: new Date().toISOString(),
    };

    try {
      const res = await fetch('/api/webhooks/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to ingest webhook');
      }

      setResult({ success: true, data: data.data });
      onIngestSuccess();
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Email Webhook Ingestion Engine
              </h3>
              <p className="text-[11px] text-zinc-500">
                Target: <code className="text-zinc-400 font-mono">POST /api/webhooks/email</code>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Presets */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              Load Realistic Test Scenarios
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {SAMPLE_PAYLOADS.map((sample, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectSample(sample)}
                  className="text-left p-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-zinc-100 transition-colors"
                >
                  <span className="font-medium">{sample.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Destination Account
                </label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.email_address} ({acc.provider})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Sender (From)
                </label>
                <input
                  type="text"
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  required
                  placeholder="Security Lead <security@example.com>"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                Raw Email Body
              </label>
              <textarea
                rows={5}
                value={fullBody}
                onChange={(e) => setFullBody(e.target.value)}
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-200 font-mono leading-relaxed focus:outline-none focus:border-zinc-700"
              />
            </div>

            {/* Results / Live Output */}
            {result && (
              <div
                className={`p-3.5 rounded-xl border ${
                  result.success
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-800/80 text-rose-200'
                }`}
              >
                {result.success ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 font-medium text-xs text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Ingested & Processed via Gemini 2.5 Flash</span>
                    </div>

                    <div className="bg-zinc-950/80 p-3 rounded-lg border border-emerald-900/60 font-mono text-[11px] space-y-1 text-zinc-300">
                      <div>
                        <span className="text-zinc-500">Category:</span>{' '}
                        <span className="text-amber-300 font-bold uppercase">{result.data?.category}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500">Requires Alert:</span>{' '}
                        <span className={result.data?.requires_alert ? 'text-rose-400 font-bold' : 'text-zinc-400'}>
                          {String(result.data?.requires_alert)}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500">AI TL;DR:</span>{' '}
                        <span className="text-zinc-200">{result.data?.ai_summary}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500">PostgreSQL ID:</span>{' '}
                        <span className="text-zinc-400">{result.data?.id}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-rose-300">
                    <AlertCircle className="w-4 h-4" />
                    <span>{result.error}</span>
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-xs text-zinc-300 font-medium transition-colors"
              >
                Close
              </button>

              <button
                type="submit"
                disabled={loading}
                className="flex items-center space-x-2 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium text-xs shadow transition-all disabled:opacity-50"
              >
                <Sparkles className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>{loading ? 'Analyzing with Gemini...' : 'Send Webhook'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
