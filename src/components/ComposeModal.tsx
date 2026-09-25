import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Send,
  Sparkles,
  RefreshCw,
  Paperclip,
  AlertCircle,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Eye,
  Edit3,
  Bold,
  Italic,
  List,
  ListOrdered,
  Link2,
  ShieldCheck,
  FileText,
  Trash2,
  Plus,
  Tag,
  ChevronDown,
} from 'lucide-react';
import type { Account } from '../types.ts';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onEmailSent?: () => void;
  selectedAccountId?: string;
  initialTo?: string;
  initialSubject?: string;
}

interface AttachedFile {
  name: string;
  size: string;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onEmailSent,
  selectedAccountId,
  initialTo = '',
  initialSubject = '',
}) => {
  // Resolve default sender: prefer mraaziqp@gmail.com (verified SMTP) or currently selected account
  const getDefaultAccount = () => {
    if (selectedAccountId && selectedAccountId !== 'all') {
      const match = accounts.find((a) => a.id === selectedAccountId || a.email_address === selectedAccountId);
      if (match) return match.email_address;
    }
    const mraaziq = accounts.find((a) => a.email_address === 'mraaziqp@gmail.com');
    if (mraaziq) return mraaziq.email_address;
    const business = accounts.find((a) => a.email_address.includes('arpcloudsolutions.co.za'));
    if (business) return business.email_address;
    return accounts[0]?.email_address || 'mraaziqp@gmail.com';
  };

  const [fromAccount, setFromAccount] = useState<string>(getDefaultAccount());

  // Recipient lists (Chips)
  const [toChips, setToChips] = useState<string[]>(() =>
    initialTo ? initialTo.split(/[,;\s]+/).filter((e) => e.includes('@')) : []
  );
  const [toInput, setToInput] = useState<string>('');

  const [showCc, setShowCc] = useState<boolean>(false);
  const [ccChips, setCcChips] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState<string>('');

  const [showBcc, setShowBcc] = useState<boolean>(false);
  const [bccChips, setBccChips] = useState<string[]>([]);
  const [bccInput, setBccInput] = useState<string>('');

  // Subject and Content
  const [subject, setSubject] = useState<string>(initialSubject);
  const [body, setBody] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // AI & Templates state
  const [isPolishing, setIsPolishing] = useState<boolean>(false);
  const [aiCustomPrompt, setAiCustomPrompt] = useState<string>('');
  const [showAiMenu, setShowAiMenu] = useState<boolean>(false);
  const [showTemplatesMenu, setShowTemplatesMenu] = useState<boolean>(false);

  // Status & Attachments
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendingStep, setSendingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dispatchedMeta, setDispatchedMeta] = useState<{
    messageId?: string;
    provider?: string;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset or initialize state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFromAccount(getDefaultAccount());
      if (initialTo && toChips.length === 0) {
        setToChips(initialTo.split(/[,;\s]+/).filter((e) => e.includes('@')));
      }
      if (initialSubject && !subject) {
        setSubject(initialSubject);
      }
      setError(null);
      setSuccess(null);
      setDispatchedMeta(null);
    }
  }, [isOpen, selectedAccountId, initialTo, initialSubject]);

  if (!isOpen) return null;

  // Add recipient chip helper
  const addChipsFromText = (
    text: string,
    existing: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    setInput: React.Dispatch<React.SetStateAction<string>>
  ) => {
    if (!text.trim()) return;
    const parts = text
      .split(/[,;\s]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const newEmails: string[] = [];
    parts.forEach((p) => {
      if (p.includes('@') && !existing.includes(p)) {
        newEmails.push(p);
      }
    });

    if (newEmails.length > 0) {
      setList([...existing, ...newEmails]);
      setInput('');
    }
  };

  const handleKeyDownRecipient = (
    e: React.KeyboardEvent<HTMLInputElement>,
    currentInput: string,
    chips: string[],
    setChips: React.Dispatch<React.SetStateAction<string[]>>,
    setInput: React.Dispatch<React.SetStateAction<string>>
  ) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
      e.preventDefault();
      if (currentInput.trim()) {
        addChipsFromText(currentInput, chips, setChips, setInput);
      }
    } else if (e.key === 'Backspace' && !currentInput && chips.length > 0) {
      setChips(chips.slice(0, -1));
    }
  };

  const removeChip = (
    index: number,
    chips: string[],
    setChips: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setChips(chips.filter((_, i) => i !== index));
  };

  // Text formatting insertion
  const insertFormatting = (prefix: string, suffix: string = '') => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = body.substring(start, end);
    const replacement = `${prefix}${selected || 'text'}${suffix}`;
    const nextBody = body.substring(0, start) + replacement + body.substring(end);
    setBody(nextBody);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + (selected.length || 4));
    }, 0);
  };

  // Subject quick tag insertion
  const applySubjectTag = (tag: string) => {
    const cleanTag = `[${tag}]`;
    if (!subject.includes(cleanTag)) {
      setSubject((prev) => (prev ? `${cleanTag} ${prev}` : `${cleanTag} `));
    }
  };

  // AI Polish & Generation
  const handleAIAssist = async (instructionType: string, customText?: string) => {
    setIsPolishing(true);
    setError(null);
    setShowAiMenu(false);

    let instruction = '';
    switch (instructionType) {
      case 'professional':
        instruction = 'Rewrite this draft into an executive, highly polished, crisp professional business email. Preserve all key details and facts.';
        break;
      case 'pitch':
        instruction = 'Transform this draft into a compelling executive business pitch representing ARP Cloud Solutions with clear value propositions and strong call to action.';
        break;
      case 'friendly':
        instruction = 'Make this email warm, appreciative, conversational, and polite while maintaining complete professionalism.';
        break;
      case 'concise':
        instruction = 'Condense this email into a punchy, 3-sentence executive summary with clear bullet points.';
        break;
      case 'payfast':
        instruction = 'Draft an official merchant inquiry / compliance verification email for PayFast payment gateway integration representing ARP Cloud Solutions.';
        break;
      case 'custom':
        instruction = customText || 'Improve this email draft.';
        break;
      default:
        instruction = 'Polish and elevate this email draft.';
    }

    try {
      const res = await fetch('/api/smart-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tone: instructionType === 'friendly' ? 'friendly' : 'professional',
          instructions: `${instruction}\n\nCurrent Draft Subject: ${subject}\nCurrent Draft Body:\n${body || '(empty draft)'}`,
        }),
      });

      if (!res.ok) {
        throw new Error('AI assistant response error');
      }

      const data = await res.json();
      if (data.draftReply) {
        setBody(data.draftReply);
      }
    } catch (err) {
      console.warn('AI assistance fallback:', err);
      setError('AI assistant is temporarily unavailable. You can continue writing manually.');
    } finally {
      setIsPolishing(false);
      setAiCustomPrompt('');
    }
  };

  // Pre-configured Enterprise Templates
  const loadTemplate = (type: 'proposal' | 'payfast' | 'invoice' | 'followup') => {
    setShowTemplatesMenu(false);
    if (type === 'payfast') {
      setSubject('[PAYFAST] Merchant Account Gateway Verification & Integration');
      setBody(
        `Dear PayFast Merchant Support Team,\n\nI am writing on behalf of ARP Cloud Solutions regarding the verification and deployment of our merchant payment gateway account.\n\nWe have submitted our enterprise details and are prepared to provide any required compliance documentation, proof of business registration, and banking verification details to ensure swift processing.\n\nPlease confirm if any additional compliance items or FICA documentation are outstanding so we can activate payment processing immediately.\n\nKind regards,\nARP Cloud Solutions Enterprise Team\nhttps://mail.arpcloudsolutions.co.za`
      );
    } else if (type === 'proposal') {
      setSubject('[PROPOSAL] Enterprise Cloud Infrastructure & SLA Engagement');
      setBody(
        `Dear Client,\n\nThank you for taking the time to discuss your operational objectives. Following our preliminary technical assessment, ARP Cloud Solutions is pleased to outline our proposal for your enterprise environment.\n\nKey Solution Pillars:\n1. Resilient Cloud & High-Availability Architecture\n2. Real-Time Security Monitoring & Automated Incident Telemetry\n3. Dedicated 24/7 SLA Engineering Support\n\nPlease find the attached service breakdown. We welcome the opportunity to schedule a brief implementation call this week.\n\nWarm regards,\nMohammed Raaziq Patel\nFounder & Solutions Architect\nARP Cloud Solutions`
      );
    } else if (type === 'invoice') {
      setSubject('[INVOICE] Service Delivery Confirmation & Billing Notice');
      setBody(
        `Dear Accounts Payable,\n\nPlease find attached the official tax invoice for services rendered during the current billing cycle by ARP Cloud Solutions.\n\nInvoice Summary:\n- Status: Ready for Settlement\n- Settlement Gateway: PayFast / Direct Bank Transfer\n- Payment Terms: 7 Days from Receipt\n\nKindly send remittance advice to billing@arpcloudsolutions.co.za upon dispatch.\n\nThank you for your valued partnership,\nARP Cloud Solutions Finance Team`
      );
    } else if (type === 'followup') {
      setSubject('[FOLLOW-UP] Checking in on Project Next Steps');
      setBody(
        `Hi Team,\n\nI hope your week is progressing well.\n\nI am following up on our recent correspondence to see if you had any questions regarding our deployment plan or if there are any specific milestones you would like us to prioritize.\n\nLooking forward to hearing from you.\n\nBest regards,\nMohammed Raaziq Patel\nARP Cloud Solutions`
      );
    }
  };

  // Add dummy file attachment
  const handleAddAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files: AttachedFile[] = Array.from(e.target.files).map((f: File) => ({
        name: f.name,
        size: `${(f.size / 1024).toFixed(1)} KB`,
      }));
      setAttachments([...attachments, ...files]);
    }
  };

  // Dispatch Email Handler
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Check To recipients
    let finalTo = [...toChips];
    if (toInput.trim() && toInput.includes('@')) {
      finalTo.push(toInput.trim());
    }

    if (finalTo.length === 0) {
      setError('Please add at least one recipient email in the "To" field.');
      return;
    }

    if (!subject.trim()) {
      setError('Please enter an email subject.');
      return;
    }

    if (!body.trim()) {
      setError('Please enter your message body.');
      return;
    }

    let finalCc = [...ccChips];
    if (ccInput.trim() && ccInput.includes('@')) {
      finalCc.push(ccInput.trim());
    }

    let finalBcc = [...bccChips];
    if (bccInput.trim() && bccInput.includes('@')) {
      finalBcc.push(bccInput.trim());
    }

    setIsSending(true);
    setSendingStep('Resolving authenticated SMTP transport...');
    setError(null);
    setSuccess(null);
    setDispatchedMeta(null);

    const matchingAcc = accounts.find((a) => a.email_address === fromAccount);
    const accountId = matchingAcc ? matchingAcc.id : fromAccount;

    try {
      setSendingStep(`Connecting to SMTP relay (${fromAccount})...`);

      const formattedHtml = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a;">
        ${body.replace(/\n/g, '<br/>')}
        ${
          attachments.length > 0
            ? `<div style="margin-top: 24px; padding-top: 12px; border-top: 1px dashed #ccc; font-size: 12px; color: #666;">
                <strong>Attached Files (${attachments.length}):</strong><br/>
                ${attachments.map((a) => `• ${a.name} (${a.size})`).join('<br/>')}
              </div>`
            : ''
        }
      </div>`;

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          to: finalTo,
          cc: finalCc.length > 0 ? finalCc : undefined,
          bcc: finalBcc.length > 0 ? finalBcc : undefined,
          subject: subject.trim(),
          htmlBody: formattedHtml,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch email over SMTP relay');
      }

      setDispatchedMeta({
        messageId: data.messageId,
        provider: data.provider,
      });

      setSuccess(
        `Dispatched successfully to ${finalTo.length} recipient${finalTo.length > 1 ? 's' : ''}${
          finalCc.length > 0 ? ` (+${finalCc.length} CC)` : ''
        } via ${data.provider || 'Secure SMTP'}!`
      );

      if (onEmailSent) onEmailSent();

      // Clear draft after short delay
      setTimeout(() => {
        setToChips([]);
        setToInput('');
        setCcChips([]);
        setCcInput('');
        setBccChips([]);
        setBccInput('');
        setSubject('');
        setBody('');
        setAttachments([]);
        setSuccess(null);
        onClose();
      }, 2000);
    } catch (err) {
      console.error('[ComposeModal] Send error:', err);
      setError(err instanceof Error ? err.message : 'Error sending email');
    } finally {
      setIsSending(false);
      setSendingStep('');
    }
  };

  // Keyboard shortcut Ctrl+Enter to send
  const handleKeyDownGlobal = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  // Current sender transport info badge
  const isGoogleSender = fromAccount.includes('@gmail.com');
  const isBusinessSender = fromAccount.includes('arpcloudsolutions.co.za');

  return (
    <div
      onKeyDown={handleKeyDownGlobal}
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md transition-all duration-300"
    >
      <div
        className={`bg-[#0a0c13] border border-[#232738] rounded-2xl w-full shadow-2xl flex flex-col transition-all duration-200 overflow-hidden ${
          isFullscreen
            ? 'fixed inset-0 rounded-none max-w-full h-full'
            : 'max-w-4xl xl:max-w-5xl h-[88vh] max-h-[860px]'
        }`}
      >
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b border-[#1b1f2e] flex items-center justify-between bg-[#10131d] select-none">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 shadow-inner">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
                  AetherMail Dispatch Console
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  SMTP RELAY ACTIVE
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Multi-recipient dispatch with verified transport routing and Gemini AI drafting
              </p>
            </div>
          </div>

          {/* Window Controls */}
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Restore Window' : 'Maximize Window'}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1e2d] transition-colors"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Alerts */}
        {error && (
          <div className="px-5 py-2.5 bg-rose-500/10 border-b border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-xs text-rose-400 hover:text-rose-200 underline ml-3"
            >
              Dismiss
            </button>
          </div>
        )}

        {success && (
          <div className="px-5 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
              <span>{success}</span>
            </div>
            {dispatchedMeta?.messageId && (
              <span className="font-mono text-[10px] text-emerald-400/80">
                ID: {dispatchedMeta.messageId}
              </span>
            )}
          </div>
        )}

        {/* Main Compose Layout */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Identity & Headers Section */}
          <div className="p-5 border-b border-[#181c2b] bg-[#0c0f18]/60 space-y-3.5">
            {/* From Identity Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-xs font-medium text-zinc-400 w-16 flex-shrink-0">From:</span>
              <div className="flex-1 flex items-center gap-3">
                <select
                  value={fromAccount}
                  onChange={(e) => setFromAccount(e.target.value)}
                  className="flex-1 bg-[#10131d] border border-[#232738] rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/60 font-mono shadow-sm"
                >
                  {accounts.map((acc) => {
                    const isG = acc.email_address.includes('@gmail.com');
                    const isBiz = acc.email_address.includes('arpcloudsolutions.co.za');
                    return (
                      <option key={acc.id} value={acc.email_address}>
                        {isG
                          ? `⚡ [GMAIL SMTP] ${acc.email_address}`
                          : isBiz
                          ? `🏢 [BUSINESS RELAY] ${acc.email_address}`
                          : `📬 [INTERNAL] ${acc.email_address}`}
                      </option>
                    );
                  })}
                </select>

                {/* Sender Security Badge */}
                <div className="hidden md:flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-md bg-[#141824] border border-[#232738] text-zinc-400 flex-shrink-0">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    {isGoogleSender
                      ? 'Port 465 SSL Authenticated'
                      : isBusinessSender
                      ? 'Verified Google Enterprise Relay'
                      : 'TLS Encrypted'}
                  </span>
                </div>
              </div>
            </div>

            {/* To Recipients Row with Chips & CC/BCC toggles */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-2">
              <span className="text-xs font-medium text-zinc-400 w-16 pt-1.5 flex-shrink-0">To:</span>
              <div className="flex-1 bg-[#10131d] border border-[#232738] rounded-lg p-1.5 flex flex-wrap items-center gap-1.5 min-h-[38px] focus-within:border-amber-500/60 transition-colors">
                {toChips.map((chip, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-mono"
                  >
                    <span>{chip}</span>
                    <button
                      type="button"
                      onClick={() => removeChip(idx, toChips, setToChips)}
                      className="hover:text-rose-400 text-amber-400/80 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="email"
                  value={toInput}
                  onChange={(e) => setToInput(e.target.value)}
                  onKeyDown={(e) =>
                    handleKeyDownRecipient(e, toInput, toChips, setToChips, setToInput)
                  }
                  onBlur={() => {
                    if (toInput.trim()) {
                      addChipsFromText(toInput, toChips, setToChips, setToInput);
                    }
                  }}
                  placeholder={
                    toChips.length === 0
                      ? 'Enter recipient email(s) and press Enter or comma...'
                      : 'Add another recipient...'
                  }
                  className="flex-1 min-w-[200px] bg-transparent border-none text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none font-mono py-1 px-1.5"
                />
              </div>

              {/* CC / BCC Toggle Buttons */}
              <div className="flex items-center gap-1 pt-1 sm:pt-0">
                {!showCc && (
                  <button
                    type="button"
                    onClick={() => setShowCc(true)}
                    className="px-2.5 py-1 rounded text-xs text-zinc-400 hover:text-amber-400 hover:bg-[#181d2c] border border-transparent hover:border-[#2a3045] transition-all"
                  >
                    + Cc
                  </button>
                )}
                {!showBcc && (
                  <button
                    type="button"
                    onClick={() => setShowBcc(true)}
                    className="px-2.5 py-1 rounded text-xs text-zinc-400 hover:text-amber-400 hover:bg-[#181d2c] border border-transparent hover:border-[#2a3045] transition-all"
                  >
                    + Bcc
                  </button>
                )}
              </div>
            </div>

            {/* CC Row */}
            {showCc && (
              <div className="flex flex-col sm:flex-row sm:items-start gap-2 animate-fadeIn">
                <div className="w-16 pt-1.5 flex items-center justify-between flex-shrink-0">
                  <span className="text-xs font-medium text-zinc-400">Cc:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCc(false);
                      setCcChips([]);
                      setCcInput('');
                    }}
                    title="Remove CC field"
                    className="text-zinc-500 hover:text-rose-400 mr-2"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex-1 bg-[#10131d] border border-[#232738] rounded-lg p-1.5 flex flex-wrap items-center gap-1.5 min-h-[36px] focus-within:border-cyan-500/60 transition-colors">
                  {ccChips.map((chip, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-xs font-mono"
                    >
                      <span>{chip}</span>
                      <button
                        type="button"
                        onClick={() => removeChip(idx, ccChips, setCcChips)}
                        className="hover:text-rose-400 text-cyan-400/80 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="email"
                    value={ccInput}
                    onChange={(e) => setCcInput(e.target.value)}
                    onKeyDown={(e) =>
                      handleKeyDownRecipient(e, ccInput, ccChips, setCcChips, setCcInput)
                    }
                    onBlur={() => {
                      if (ccInput.trim()) {
                        addChipsFromText(ccInput, ccChips, setCcChips, setCcInput);
                      }
                    }}
                    placeholder="Enter CC recipients..."
                    className="flex-1 min-w-[180px] bg-transparent border-none text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none font-mono py-1 px-1.5"
                  />
                </div>
              </div>
            )}

            {/* BCC Row */}
            {showBcc && (
              <div className="flex flex-col sm:flex-row sm:items-start gap-2 animate-fadeIn">
                <div className="w-16 pt-1.5 flex items-center justify-between flex-shrink-0">
                  <span className="text-xs font-medium text-zinc-400">Bcc:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBcc(false);
                      setBccChips([]);
                      setBccInput('');
                    }}
                    title="Remove BCC field"
                    className="text-zinc-500 hover:text-rose-400 mr-2"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex-1 bg-[#10131d] border border-[#232738] rounded-lg p-1.5 flex flex-wrap items-center gap-1.5 min-h-[36px] focus-within:border-purple-500/60 transition-colors">
                  {bccChips.map((chip, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/25 text-purple-300 text-xs font-mono"
                    >
                      <span>{chip}</span>
                      <button
                        type="button"
                        onClick={() => removeChip(idx, bccChips, setBccChips)}
                        className="hover:text-rose-400 text-purple-400/80 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="email"
                    value={bccInput}
                    onChange={(e) => setBccInput(e.target.value)}
                    onKeyDown={(e) =>
                      handleKeyDownRecipient(e, bccInput, bccChips, setBccChips, setBccInput)
                    }
                    onBlur={() => {
                      if (bccInput.trim()) {
                        addChipsFromText(bccInput, bccChips, setBccChips, setBccInput);
                      }
                    }}
                    placeholder="Enter BCC recipients (hidden)..."
                    className="flex-1 min-w-[180px] bg-transparent border-none text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none font-mono py-1 px-1.5"
                  />
                </div>
              </div>
            )}

            {/* Subject Row with Quick Tags */}
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-xs font-medium text-zinc-400 w-16 flex-shrink-0">Subject:</span>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Enterprise Gateway Integration Proposal"
                  className="flex-1 bg-[#10131d] border border-[#232738] rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500/60 font-medium tracking-wide shadow-sm"
                />
              </div>

              {/* Quick Subject Tags */}
              <div className="flex items-center gap-1.5 pl-0 sm:pl-18 flex-wrap">
                <span className="text-[10px] text-zinc-500 flex items-center gap-1 mr-1">
                  <Tag className="w-3 h-3" /> Quick Prefix:
                </span>
                {['URGENT', 'PAYFAST', 'INVOICE', 'PROPOSAL', 'IMPORTANT', 'FOLLOW UP'].map(
                  (tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => applySubjectTag(tag)}
                      className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#141824] hover:bg-amber-500/15 text-zinc-400 hover:text-amber-300 border border-[#222739] hover:border-amber-500/30 transition-all"
                    >
                      +{tag}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Editor & Formatting Toolbar */}
          <div className="px-5 py-2.5 border-b border-[#1b1f2e] bg-[#0e111a] flex flex-wrap items-center justify-between gap-3">
            {/* Left: View Tabs & Rich Text Helpers */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center bg-[#07090f] p-0.5 rounded-lg border border-[#1f2436]">
                <button
                  type="button"
                  onClick={() => setActiveTab('edit')}
                  className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'edit'
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Editor</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'preview'
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Live Preview</span>
                </button>
              </div>

              {/* Formatting buttons */}
              {activeTab === 'edit' && (
                <div className="hidden sm:flex items-center space-x-1 border-l border-[#1f2436] pl-2">
                  <button
                    type="button"
                    onClick={() => insertFormatting('**', '**')}
                    title="Bold"
                    className="p-1.5 rounded hover:bg-[#191d2c] text-zinc-400 hover:text-zinc-200"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('*', '*')}
                    title="Italic"
                    className="p-1.5 rounded hover:bg-[#191d2c] text-zinc-400 hover:text-zinc-200"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('\n- ')}
                    title="Bullet List"
                    className="p-1.5 rounded hover:bg-[#191d2c] text-zinc-400 hover:text-zinc-200"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('\n1. ')}
                    title="Numbered List"
                    className="p-1.5 rounded hover:bg-[#191d2c] text-zinc-400 hover:text-zinc-200"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormatting('[', '](https://)')}
                    title="Insert Link"
                    className="p-1.5 rounded hover:bg-[#191d2c] text-zinc-400 hover:text-zinc-200"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Right: AI Tools & Enterprise Templates */}
            <div className="flex items-center space-x-2">
              {/* Enterprise Templates Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowTemplatesMenu(!showTemplatesMenu);
                    setShowAiMenu(false);
                  }}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-[#141824] hover:bg-[#1b2030] border border-[#232738] text-xs text-zinc-300 font-medium transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Templates</span>
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                </button>

                {showTemplatesMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-[#111420] border border-[#232738] rounded-xl shadow-2xl py-1.5 z-20">
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-[#1b1f2e]">
                      Enterprise Templates
                    </div>
                    <button
                      type="button"
                      onClick={() => loadTemplate('payfast')}
                      className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-amber-500/15 hover:text-amber-300 transition-colors flex flex-col"
                    >
                      <span className="font-semibold text-amber-400">💳 PayFast Verification</span>
                      <span className="text-[10px] text-zinc-400">Merchant registration & compliance inquiry</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => loadTemplate('proposal')}
                      className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-[#1b2030] transition-colors flex flex-col"
                    >
                      <span className="font-semibold text-zinc-100">📄 Business Proposal</span>
                      <span className="text-[10px] text-zinc-400">Cloud infrastructure proposal & SLA</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => loadTemplate('invoice')}
                      className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-[#1b2030] transition-colors flex flex-col"
                    >
                      <span className="font-semibold text-zinc-100">💰 Invoice Notice</span>
                      <span className="text-[10px] text-zinc-400">Payment settlement instructions</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => loadTemplate('followup')}
                      className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-[#1b2030] transition-colors flex flex-col"
                    >
                      <span className="font-semibold text-zinc-100">🤝 Executive Follow-up</span>
                      <span className="text-[10px] text-zinc-400">Polite client progress check-in</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Gemini AI Superpowers */}
              <div className="relative">
                <button
                  type="button"
                  disabled={isPolishing}
                  onClick={() => {
                    setShowAiMenu(!showAiMenu);
                    setShowTemplatesMenu(false);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/30 text-xs text-amber-300 font-medium transition-all shadow-sm disabled:opacity-50"
                >
                  {isPolishing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  <span>{isPolishing ? 'Refining with AI...' : 'Gemini AI Assistant'}</span>
                  <ChevronDown className="w-3 h-3 text-amber-400/80" />
                </button>

                {showAiMenu && (
                  <div className="absolute right-0 mt-2 w-72 bg-[#111420] border border-[#232738] rounded-xl shadow-2xl p-2 z-20">
                    <div className="px-2 py-1 text-[10px] font-semibold text-amber-400 uppercase tracking-wider border-b border-[#1b1f2e] mb-1.5 flex items-center justify-between">
                      <span>✨ Polish & Tone Options</span>
                      <span className="text-[9px] text-zinc-500 font-mono">Gemini 2.5 Flash</span>
                    </div>

                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => handleAIAssist('professional')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-amber-500/15 hover:text-amber-300 transition-colors flex items-center justify-between"
                      >
                        <span>👔 Executive & Professional</span>
                        <span className="text-[10px] text-zinc-500">Corporate</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAIAssist('pitch')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-amber-500/15 hover:text-amber-300 transition-colors flex items-center justify-between"
                      >
                        <span>💼 High-Impact Pitch</span>
                        <span className="text-[10px] text-zinc-500">Persuasive</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAIAssist('friendly')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-amber-500/15 hover:text-amber-300 transition-colors flex items-center justify-between"
                      >
                        <span>🤝 Friendly & Warm</span>
                        <span className="text-[10px] text-zinc-500">Approachable</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAIAssist('concise')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-amber-500/15 hover:text-amber-300 transition-colors flex items-center justify-between"
                      >
                        <span>⚡ Short & Concise</span>
                        <span className="text-[10px] text-zinc-500">Executive</span>
                      </button>
                    </div>

                    <div className="mt-2 pt-2 border-t border-[#1b1f2e]">
                      <div className="text-[10px] text-zinc-400 mb-1 px-1">Custom Instruction:</div>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={aiCustomPrompt}
                          onChange={(e) => setAiCustomPrompt(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && aiCustomPrompt.trim()) {
                              e.preventDefault();
                              handleAIAssist('custom', aiCustomPrompt);
                            }
                          }}
                          placeholder="e.g. Add urgency, fix grammar..."
                          className="flex-1 bg-[#090b10] border border-[#1f2436] rounded-md px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60"
                        />
                        <button
                          type="button"
                          onClick={() => handleAIAssist('custom', aiCustomPrompt)}
                          disabled={!aiCustomPrompt.trim()}
                          className="px-2 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-md text-xs font-bold disabled:opacity-40"
                        >
                          Go
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Editor Body or Preview Area */}
          <div className="flex-1 p-5 overflow-y-auto flex flex-col min-h-[300px]">
            {activeTab === 'edit' ? (
              <textarea
                ref={textareaRef}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type your message here, or use Gemini AI / Templates above to generate an executive draft..."
                className="w-full flex-1 bg-transparent border-none text-zinc-100 placeholder-zinc-600 focus:outline-none resize-none font-sans text-sm leading-relaxed p-0 selection:bg-amber-500/30"
              />
            ) : (
              /* Live HTML Preview Tab */
              <div className="flex-1 rounded-xl bg-[#090b12] border border-[#1b1f2e] p-6 text-zinc-200 overflow-y-auto shadow-inner">
                <div className="border-b border-[#1b1f2e] pb-4 mb-4">
                  <div className="text-xs text-zinc-400 mb-1">
                    <strong className="text-zinc-300">From:</strong> {fromAccount}
                  </div>
                  <div className="text-xs text-zinc-400 mb-1">
                    <strong className="text-zinc-300">To:</strong> {toChips.join(', ') || toInput || '(none)'}
                  </div>
                  {ccChips.length > 0 && (
                    <div className="text-xs text-zinc-400 mb-1">
                      <strong className="text-zinc-300">Cc:</strong> {ccChips.join(', ')}
                    </div>
                  )}
                  {bccChips.length > 0 && (
                    <div className="text-xs text-zinc-400 mb-1">
                      <strong className="text-zinc-300">Bcc:</strong> {bccChips.join(', ')}
                    </div>
                  )}
                  <div className="text-xs text-zinc-400">
                    <strong className="text-zinc-300">Subject:</strong> {subject || '(no subject)'}
                  </div>
                </div>

                <div className="text-sm leading-relaxed text-zinc-100 whitespace-pre-wrap">
                  {body || (
                    <span className="text-zinc-600 italic">Message body is currently empty.</span>
                  )}
                </div>

                {attachments.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-[#1b1f2e]">
                    <div className="text-xs font-semibold text-zinc-400 mb-2">
                      Attachments ({attachments.length}):
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((file, i) => (
                        <div
                          key={i}
                          className="px-2.5 py-1 rounded bg-[#141824] border border-[#232738] text-xs text-zinc-300 flex items-center gap-1.5"
                        >
                          <Paperclip className="w-3 h-3 text-amber-400" />
                          <span>{file.name}</span>
                          <span className="text-[10px] text-zinc-500 font-mono">({file.size})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Attachments Drawer */}
          {attachments.length > 0 && (
            <div className="px-5 py-2.5 border-t border-[#181c2b] bg-[#0c0e17] flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-zinc-400 flex items-center gap-1 mr-1">
                <Paperclip className="w-3 h-3 text-amber-400" />
                Files ({attachments.length}):
              </span>
              {attachments.map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#131722] border border-[#232738] text-xs text-zinc-300"
                >
                  <span className="truncate max-w-[150px]">{f.name}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">({f.size})</span>
                  <button
                    type="button"
                    onClick={() => setAttachments(attachments.filter((_, idx) => idx !== i))}
                    className="hover:text-rose-400 text-zinc-500 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Action Footer */}
        <div className="px-5 py-3.5 border-t border-[#1b1f2e] bg-[#0c0f18] flex items-center justify-between gap-3">
          {/* Left tools: Attachment picker & Keyboard hints */}
          <div className="flex items-center space-x-3">
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={handleAddAttachment}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-[#232738] hover:bg-[#151926] text-xs text-zinc-300 transition-colors"
            >
              <Paperclip className="w-3.5 h-3.5 text-zinc-400" />
              <span>Attach Files</span>
            </button>

            <span className="hidden md:inline text-[11px] text-zinc-500 font-mono">
              Press <kbd className="px-1.5 py-0.5 rounded bg-[#181c2b] text-zinc-300">Ctrl</kbd> +{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-[#181c2b] text-zinc-300">Enter</kbd> to send
            </span>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="px-4 py-2 rounded-lg border border-[#232738] hover:bg-[#151926] text-xs text-zinc-300 font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => handleSend()}
              disabled={isSending}
              className="flex items-center space-x-2 px-6 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-zinc-950 font-bold text-xs tracking-wide transition-all shadow-lg shadow-amber-500/10 disabled:opacity-50"
            >
              {isSending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{sendingStep || 'Dispatching...'}</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Message</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
