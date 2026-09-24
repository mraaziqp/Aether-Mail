import React, { useState, useEffect } from 'react';
import { 
  X, 
  Plus, 
  Mail, 
  Check, 
  Globe, 
  ShieldCheck, 
  Copy, 
  Key, 
  Sparkles, 
  AlertCircle, 
  RefreshCw,
  Server,
  ArrowRight,
  CheckCircle2
} from 'lucide-react';

interface NewAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountCreated: () => void;
}

interface DnsRecord {
  type: 'MX' | 'TXT';
  host: string;
  value: string;
  priority?: number;
  description: string;
}

interface RegisteredDomain {
  id: string;
  domain_name: string;
  is_verified: boolean;
  dns_records: DnsRecord[];
}

export const NewAccountModal: React.FC<NewAccountModalProps> = ({
  isOpen,
  onClose,
  onAccountCreated,
}) => {
  const [modalTab, setModalTab] = useState<'business' | 'external'>('business');

  // Business Domain & Mailbox State
  const [domainName, setDomainName] = useState('');
  const [registeringDomain, setRegisteringDomain] = useState(false);
  const [activeDomain, setActiveDomain] = useState<RegisteredDomain | null>(null);
  const [availableDomains, setAvailableDomains] = useState<RegisteredDomain[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState<string>('');
  
  // Mailbox Creation State
  const [mailboxPrefix, setMailboxPrefix] = useState('contact');
  const [mailboxPassword, setMailboxPassword] = useState('');
  const [creatingMailbox, setCreatingMailbox] = useState(false);
  const [copiedRecordIndex, setCopiedRecordIndex] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // External Account State
  const [externalEmail, setExternalEmail] = useState('');
  const [externalAppPassword, setExternalAppPassword] = useState('');
  const [externalProvider, setExternalProvider] = useState<'google' | 'outlook' | 'custom'>('google');
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch registered domains on modal open
  useEffect(() => {
    if (!isOpen) return;

    const fetchDomains = async () => {
      try {
        const res = await fetch('/api/v1/admin/domains');
        if (res.ok) {
          const data = await res.json();
          if (data.domains && Array.isArray(data.domains)) {
            setAvailableDomains(data.domains);
            if (data.domains.length > 0 && !selectedDomainId) {
              setSelectedDomainId(data.domains[0].id);
              setActiveDomain(data.domains[0]);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load domains:', err);
      }
    };

    fetchDomains();
    generateSecurePassword();
  }, [isOpen]);

  if (!isOpen) return null;

  const generateSecurePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
    let pwd = '';
    for (let i = 0; i < 16; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setMailboxPassword(pwd);
  };

  const handleRegisterDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainName.trim()) return;

    setRegisteringDomain(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/v1/admin/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_name: domainName.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to provision business domain');
      }

      setActiveDomain(data.domain);
      setSelectedDomainId(data.domain.id);
      setAvailableDomains((prev) => [data.domain, ...prev.filter((d) => d.id !== data.domain.id)]);
      setSuccessMessage(`Domain "${data.domain.domain_name}" registered! Configure DNS records below.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegisteringDomain(false);
    }
  };

  const handleCreateMailbox = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentDomain = activeDomain || availableDomains.find((d) => d.id === selectedDomainId);
    if (!currentDomain || !mailboxPrefix.trim()) return;

    setCreatingMailbox(true);
    setError(null);
    setSuccessMessage(null);

    const fullEmail = `${mailboxPrefix.trim().toLowerCase()}@${currentDomain.domain_name}`;

    try {
      const res = await fetch('/api/v1/admin/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain_id: currentDomain.id,
          email_address: fullEmail,
          password: mailboxPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create business mailbox');
      }

      setSuccessMessage(`Mailbox ${fullEmail} successfully created and activated!`);
      onAccountCreated();
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingMailbox(false);
    }
  };

  const handleConnectExternal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!externalEmail.trim()) return;

    setLoadingExternal(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (externalProvider === 'google' && externalAppPassword.trim()) {
        const syncRes = await fetch('/api/v1/sync/gmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email_address: externalEmail.trim(),
            app_password: externalAppPassword.trim(),
          }),
        });

        const syncData = await syncRes.json();
        if (!syncRes.ok || !syncData.success) {
          throw new Error(syncData.error || 'Failed to authenticate with Gmail IMAP. Check your App Password.');
        }

        setSuccessMessage(`Connected! Synchronized ${syncData.imported} emails from ${externalEmail.trim()}`);
      } else {
        const res = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `acc_${Date.now()}`,
            provider: externalProvider,
            email_address: externalEmail.trim(),
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to connect external account');
        }
        setSuccessMessage(`Account ${externalEmail.trim()} connected!`);
      }

      onAccountCreated();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingExternal(false);
    }
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedRecordIndex(index);
    setTimeout(() => setCopiedRecordIndex(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-[#0f1118] border border-[#232738] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-[#1f2333] flex items-center justify-between bg-[#131620]">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <span>Enterprise Mail & Domain Provisioning</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  STALWART RUST
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400">Deploy custom business domains and autonomous virtual mailboxes</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#1c202e] text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[#1f2333] bg-[#0c0e14] px-4 pt-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setModalTab('business');
              setError(null);
              setSuccessMessage(null);
            }}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-medium border-b-2 transition-colors ${
              modalTab === 'business'
                ? 'border-amber-400 text-amber-300 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-300'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Self-Hosted Business Domain & Email</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setModalTab('external');
              setError(null);
              setSuccessMessage(null);
            }}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-medium border-b-2 transition-colors ${
              modalTab === 'external'
                ? 'border-amber-400 text-amber-300 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-300'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Connect External Inbox (Google/Outlook)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-zinc-200 text-xs">
          {error && (
            <div className="flex items-start gap-2 bg-rose-950/40 p-3 rounded-xl border border-rose-900/60 text-rose-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-start gap-2 bg-emerald-950/40 p-3 rounded-xl border border-emerald-900/60 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {modalTab === 'business' ? (
            <div className="space-y-6">
              {/* Step 1: Register Domain */}
              <div className="bg-[#121520] border border-[#232738] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-mono text-[11px] font-bold">
                      1
                    </span>
                    <h4 className="font-semibold text-zinc-100 text-xs">Register Business Domain & Generate DKIM Keys</h4>
                  </div>
                  {availableDomains.length > 0 && (
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {availableDomains.length} registered domain(s)
                    </span>
                  )}
                </div>

                <form onSubmit={handleRegisterDomain} className="flex gap-2">
                  <div className="relative flex-1">
                    <Globe className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="e.g. acme-tech.com or mybusiness.co.za"
                      value={domainName}
                      onChange={(e) => setDomainName(e.target.value)}
                      className="w-full bg-[#0a0c12] border border-[#232738] rounded-lg pl-8 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={registeringDomain || !domainName.trim()}
                    className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {registeringDomain ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>{registeringDomain ? 'Generating...' : 'Provision Domain'}</span>
                  </button>
                </form>

                {/* DNS Records Output */}
                {activeDomain && activeDomain.dns_records && (
                  <div className="mt-4 pt-3 border-t border-[#1f2333] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-amber-400 flex items-center gap-1.5 font-mono">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>DNS Configuration for {activeDomain.domain_name}</span>
                      </span>
                      <span className="text-[10px] text-zinc-500">Copy to your Registrar (GoDaddy, Namecheap, Cloudflare)</span>
                    </div>

                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                      {activeDomain.dns_records.map((rec, idx) => (
                        <div key={idx} className="bg-[#090b10] border border-[#1b1f2e] p-2.5 rounded-lg flex items-center justify-between gap-3 text-[11px] font-mono">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="px-1.5 py-0.2 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-[9px] font-bold">
                                {rec.type}
                              </span>
                              <span className="text-zinc-400 truncate">Host: <span className="text-zinc-200">{rec.host}</span></span>
                              {rec.priority && <span className="text-zinc-500 text-[10px]">Priority: {rec.priority}</span>}
                            </div>
                            <p className="text-zinc-400 truncate text-[10px]" title={rec.value}>{rec.value}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy(rec.value, idx)}
                            className="p-1.5 rounded bg-[#151926] hover:bg-[#1e2335] text-zinc-400 hover:text-zinc-200 transition-colors flex-shrink-0"
                            title="Copy record value"
                          >
                            {copiedRecordIndex === idx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Create Business Mailboxes */}
              <div className="bg-[#121520] border border-[#232738] rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-mono text-[11px] font-bold">
                    2
                  </span>
                  <h4 className="font-semibold text-zinc-100 text-xs">Create Business Mailbox on Stalwart Mail Server</h4>
                </div>

                <form onSubmit={handleCreateMailbox} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                        Select Registered Domain
                      </label>
                      <select
                        value={selectedDomainId}
                        onChange={(e) => {
                          setSelectedDomainId(e.target.value);
                          const matched = availableDomains.find((d) => d.id === e.target.value);
                          if (matched) setActiveDomain(matched);
                        }}
                        className="w-full bg-[#0a0c12] border border-[#232738] rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/60 font-mono"
                      >
                        {availableDomains.length === 0 && <option value="">No domains registered yet (register above)</option>}
                        {availableDomains.map((d) => (
                          <option key={d.id} value={d.id}>
                            @{d.domain_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                        Mailbox Prefix
                      </label>
                      <div className="flex items-center">
                        <input
                          type="text"
                          required
                          placeholder="e.g. contact, info, admin"
                          value={mailboxPrefix}
                          onChange={(e) => setMailboxPrefix(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
                          className="w-full bg-[#0a0c12] border border-[#232738] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-medium text-zinc-400">
                        Mailbox Secure Password
                      </label>
                      <button
                        type="button"
                        onClick={generateSecurePassword}
                        className="text-[10px] text-amber-400 hover:text-amber-300 font-mono flex items-center gap-1"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        <span>Regenerate Random Password</span>
                      </button>
                    </div>
                    <div className="relative">
                      <Key className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
                      <input
                        type="text"
                        required
                        value={mailboxPassword}
                        onChange={(e) => setMailboxPassword(e.target.value)}
                        className="w-full bg-[#0a0c12] border border-[#232738] rounded-lg pl-8 pr-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-amber-500/60"
                      />
                    </div>
                  </div>

                  <div className="pt-1 flex items-center justify-between">
                    <p className="text-[10px] text-zinc-500 font-mono">
                      Target: <span className="text-amber-300">{mailboxPrefix || 'name'}@{activeDomain?.domain_name || availableDomains[0]?.domain_name || 'yourdomain.com'}</span>
                    </p>
                    <button
                      type="submit"
                      disabled={creatingMailbox || availableDomains.length === 0 || !mailboxPrefix.trim()}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {creatingMailbox ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      <span>{creatingMailbox ? 'Activating Mailbox...' : 'Activate Business Mailbox'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            /* External Sync Form */
            <form onSubmit={handleConnectExternal} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  External Provider
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['google', 'outlook', 'custom'] as const).map((prov) => (
                    <button
                      key={prov}
                      type="button"
                      onClick={() => setExternalProvider(prov)}
                      className={`py-2 text-xs capitalize rounded-lg font-medium border transition-colors ${
                        externalProvider === prov
                          ? 'bg-[#1e2335] border-amber-500/60 text-amber-300'
                          : 'bg-[#090b10] border-[#1b1f2e] text-zinc-400 hover:text-zinc-300'
                      }`}
                    >
                      {prov}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={externalEmail}
                  onChange={(e) => setExternalEmail(e.target.value)}
                  placeholder="e.g. personal@gmail.com"
                  className="w-full bg-[#090b10] border border-[#1b1f2e] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 font-mono"
                />
              </div>

              {externalProvider === 'google' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 flex items-center justify-between">
                    <span>Google App Password</span>
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-amber-400 hover:underline"
                    >
                      Generate password ↗
                    </a>
                  </label>
                  <input
                    type="password"
                    value={externalAppPassword}
                    onChange={(e) => setExternalAppPassword(e.target.value)}
                    placeholder="16-character code (e.g. efuw pgkc fwsj zlwu)"
                    className="w-full bg-[#090b10] border border-[#1b1f2e] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 font-mono tracking-wider"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">
                    Enables live 2-way IMAP inbox sync and autonomous AI threat classification.
                  </p>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-[#232738] hover:bg-[#151926] text-xs text-zinc-300 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingExternal || !externalEmail.trim()}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium text-xs transition-colors disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{loadingExternal ? 'Connecting...' : 'Connect Account'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
