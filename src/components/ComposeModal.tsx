import React, { useState } from 'react';
import { X, Send, Sparkles, RefreshCw, Paperclip, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Account } from '../types.ts';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onEmailSent?: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onEmailSent,
}) => {
  const [fromAccount, setFromAccount] = useState<string>(
    accounts.find((a) => a.email_address.includes('arpcloudsolutions.co.za'))?.email_address ||
      accounts[0]?.email_address ||
      'contact@arpcloudsolutions.co.za'
  );
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePolishWithAI = async () => {
    if (!body.trim()) return;
    setIsPolishing(true);
    setError(null);
    try {
      const res = await fetch('/api/smart-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tone: 'professional',
          instructions: `Polish and improve this email draft while preserving the original intent:\n${body}`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.draftReply) {
          setBody(data.draftReply);
        }
      }
    } catch {
      // Fallback
    } finally {
      setIsPolishing(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !subject.trim() || !body.trim()) {
      setError('Please fill in recipient, subject, and message content.');
      return;
    }

    setIsSending(true);
    setError(null);
    setSuccess(null);

    const matchingAcc = accounts.find((a) => a.email_address === fromAccount);
    const accountId = matchingAcc ? matchingAcc.id : fromAccount;

    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          to: to.trim(),
          subject: subject.trim(),
          htmlBody: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a;">${body.replace(/\n/g, '<br/>')}</div>`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch email');
      }

      setSuccess(`Email successfully delivered to ${to.trim()}!`);
      if (onEmailSent) onEmailSent();
      setTimeout(() => {
        setSuccess(null);
        setTo('');
        setSubject('');
        setBody('');
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error sending email');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-[#0f1118] border border-[#232738] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-[#1f2333] flex items-center justify-between bg-[#131620]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Compose Dispatch</h3>
              <p className="text-[11px] text-zinc-400">Send enterprise emails across business or personal profiles</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-[#1f2436] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSend} className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* From Profile Selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              From Identity
            </label>
            <select
              value={fromAccount}
              onChange={(e) => setFromAccount(e.target.value)}
              className="w-full bg-[#090b10] border border-[#1b1f2e] rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/60 font-mono"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.email_address}>
                  {acc.email_address.includes('arpcloudsolutions.co.za') ? '🏢 [BUSINESS] ' : '📬 [PERSONAL] '}
                  {acc.email_address}
                </option>
              ))}
            </select>
          </div>

          {/* To */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              To (Recipient)
            </label>
            <input
              type="email"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="e.g. client@company.com or mraaziqp@gmail.com"
              className="w-full bg-[#090b10] border border-[#1b1f2e] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 font-mono"
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Subject
            </label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. ARP Cloud Solutions Proposal"
              className="w-full bg-[#090b10] border border-[#1b1f2e] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60"
            />
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-400">Message Body</label>
              <button
                type="button"
                onClick={handlePolishWithAI}
                disabled={isPolishing || !body.trim()}
                className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors disabled:opacity-40"
              >
                <Sparkles className="w-3 h-3" />
                <span>{isPolishing ? 'Polishing...' : 'Polish with AI'}</span>
              </button>
            </div>
            <textarea
              required
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your message here..."
              className="w-full bg-[#090b10] border border-[#1b1f2e] rounded-lg p-3 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 resize-none font-sans leading-relaxed"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#1b1f2e]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[#232738] hover:bg-[#151926] text-xs text-zinc-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSending}
              className="flex items-center space-x-1.5 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs transition-colors disabled:opacity-50"
            >
              {isSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>{isSending ? 'Dispatching...' : 'Send Message'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
