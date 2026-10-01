import React, { useState, useEffect } from 'react';
import {
  X,
  Bot,
  Key,
  Shield,
  Mail,
  Check,
  Copy,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Send,
  Eye,
  EyeOff,
  Server,
  Layers,
  Terminal,
  ExternalLink,
} from 'lucide-react';
import type { SessionUser } from '../types.ts';
import { api } from '../client/api.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: SessionUser | null;
  onMailboxesChanged?: () => void;
}

interface JarvisStatus {
  configured: boolean;
  agent?: {
    id: string;
    bot_name: string;
    scopes: string[];
    prefix: string;
    created_at: string | null;
    last_active: string | null;
  };
}

interface JarvisTestResult {
  success: boolean;
  message: string;
  stats?: {
    unreadEmails: number;
    totalEmails: number;
    activeMailboxes: number;
    botName?: string;
    scopes?: string[];
  };
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  user,
}) => {
  const [activeTab, setActiveTab] = useState<'jarvis' | 'mail' | 'security'>('jarvis');
  const [jarvisStatus, setJarvisStatus] = useState<JarvisStatus | null>(null);
  const [loadingJarvis, setLoadingJarvis] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [showInputKey, setShowInputKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newlyProvisionedKey, setNewlyProvisionedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [testResult, setTestResult] = useState<JarvisTestResult | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sampleTab, setSampleTab] = useState<'curl' | 'python' | 'env'>('curl');

  const fetchJarvisStatus = async () => {
    setLoadingJarvis(true);
    setErrorMsg(null);
    try {
      const res = await api<JarvisStatus>('/api/v1/agent/jarvis');
      setJarvisStatus(res);
    } catch (err) {
      console.error('Failed to fetch Jarvis status:', err);
    } finally {
      setLoadingJarvis(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchJarvisStatus();
      setErrorMsg(null);
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveCustomKey = async () => {
    if (!inputKey.trim()) return;
    setSavingKey(true);
    setErrorMsg(null);
    try {
      const res = await api<{
        success: boolean;
        message: string;
        rawKey?: string;
        agent: any;
      }>('/api/v1/agent/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: inputKey.trim() }),
      });

      setNewlyProvisionedKey(inputKey.trim());
      setInputKey('');
      await fetchJarvisStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save Jarvis API key');
    } finally {
      setSavingKey(false);
    }
  };

  const handleGenerateKey = async () => {
    setGeneratingKey(true);
    setErrorMsg(null);
    try {
      const res = await api<{
        success: boolean;
        message: string;
        rawKey?: string;
        agent: any;
      }>('/api/v1/agent/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generate: true }),
      });

      if (res.rawKey) {
        setNewlyProvisionedKey(res.rawKey);
      }
      await fetchJarvisStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate Jarvis key');
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    setErrorMsg(null);
    try {
      const res = await api<JarvisTestResult>('/api/v1/agent/jarvis/test', {
        method: 'POST',
      });
      setTestResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTestingConnection(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 3000);
  };

  const activeKeyForSamples = newlyProvisionedKey || (jarvisStatus?.configured ? 'jrv_root_YOUR_SAVED_KEY' : 'jrv_root_YOUR_KEY');
  const baseUrl = window.location.origin;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-[#0c0e15] border border-[#1f2433] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1b202e] bg-[#0f121b]/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-300">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                Settings & Autonomous Integrations
              </h2>
              <p className="text-xs text-zinc-400">
                Configure Jarvis autonomous agents, business email routing, and operator security.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-[#1a1f2c] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-[#1b202e] bg-[#0c0e15]">
          <button
            onClick={() => setActiveTab('jarvis')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-t-xl transition border-b-2 ${
              activeTab === 'jarvis'
                ? 'border-cyan-400 text-cyan-300 bg-[#141824]'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#11141e]'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            Jarvis AI Agent
            {jarvisStatus?.configured && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('mail')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-t-xl transition border-b-2 ${
              activeTab === 'mail'
                ? 'border-cyan-400 text-cyan-300 bg-[#141824]'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#11141e]'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            Business Mail Routing
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-t-xl transition border-b-2 ${
              activeTab === 'security'
                ? 'border-cyan-400 text-cyan-300 bg-[#141824]'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#11141e]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Operator Security
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-zinc-200">
          {activeTab === 'jarvis' && (
            <div className="space-y-6">
              {/* Status Header Banner */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-[#212738] bg-[#111520]">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      jarvisStatus?.configured
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-medium text-zinc-100 flex items-center gap-2">
                      Jarvis Autonomous Protocol
                      {jarvisStatus?.configured ? (
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                          ACTIVE & AUTHORIZED
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          KEY REQUIRED
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      {jarvisStatus?.configured
                        ? `Bot: ${jarvisStatus.agent?.bot_name} • Scopes: ${jarvisStatus.agent?.scopes.join(', ')} • Key: ${jarvisStatus.agent?.prefix}`
                        : 'Add or generate an API key below to grant Jarvis full autonomous triage & dispatch permissions.'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestConnection}
                    disabled={!jarvisStatus?.configured || testingConnection}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2c344a] bg-[#161c2b] text-xs font-medium text-cyan-300 hover:bg-[#1c2438] hover:border-cyan-500/40 transition disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingConnection ? 'animate-spin' : ''}`} />
                    Test Connection
                  </button>
                </div>
              </div>

              {/* Newly Generated Key Alert */}
              {newlyProvisionedKey && (
                <div className="p-4 rounded-xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950/40 to-slate-900 border-l-4 border-l-cyan-400 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                      Active Jarvis API Key
                    </span>
                    <span className="text-[11px] text-zinc-400">Save this key now</span>
                  </div>
                  <div className="flex items-center gap-2 bg-[#090b10] border border-cyan-500/30 rounded-lg p-2.5">
                    <code className="flex-1 font-mono text-xs text-cyan-200 select-all break-all">
                      {newlyProvisionedKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(newlyProvisionedKey)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-cyan-500 text-zinc-950 font-medium text-xs hover:bg-cyan-400 transition"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedKey ? 'Copied!' : 'Copy Key'}
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Provide this key in Jarvis's configuration (`x-agent-key` or `Authorization: Bearer`). It grants full root access to pull unread mail and dispatch outbound messages.
                  </p>
                </div>
              )}

              {/* Test Result Display */}
              {testResult && (
                <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    {testResult.message}
                  </div>
                  {testResult.stats && (
                    <div className="grid grid-cols-3 gap-3 pt-2 text-zinc-300">
                      <div className="p-2 rounded-lg bg-[#0c1018] border border-white/5">
                        <div className="text-zinc-500 text-[10px] uppercase font-mono">Unread Triage</div>
                        <div className="text-base font-bold text-cyan-300">{testResult.stats.unreadEmails}</div>
                      </div>
                      <div className="p-2 rounded-lg bg-[#0c1018] border border-white/5">
                        <div className="text-zinc-500 text-[10px] uppercase font-mono">Total Indexed</div>
                        <div className="text-base font-bold text-zinc-200">{testResult.stats.totalEmails}</div>
                      </div>
                      <div className="p-2 rounded-lg bg-[#0c1018] border border-white/5">
                        <div className="text-zinc-500 text-[10px] uppercase font-mono">Active Mailboxes</div>
                        <div className="text-base font-bold text-emerald-300">{testResult.stats.activeMailboxes}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {errorMsg && (
                <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-950/30 text-xs text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Add / Update API Key Form */}
              <div className="p-5 rounded-xl border border-[#1f2433] bg-[#0e111a] space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <Key className="w-4 h-4 text-cyan-400" />
                    Set Jarvis API Key
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Enter your custom secret key for Jarvis or generate a cryptographically strong root token.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type={showInputKey ? 'text' : 'password'}
                      value={inputKey}
                      onChange={(e) => setInputKey(e.target.value)}
                      placeholder="Paste your custom Jarvis API Key (e.g. jrv_root_... or custom secret)"
                      className="w-full rounded-xl border border-[#272e42] bg-[#080a0f] px-4 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/50 outline-none pr-10 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowInputKey(!showInputKey)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300"
                    >
                      {showInputKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      onClick={handleSaveCustomKey}
                      disabled={!inputKey.trim() || savingKey}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-zinc-950 font-semibold text-xs hover:from-cyan-400 hover:to-sky-400 transition disabled:opacity-40"
                    >
                      {savingKey && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      Save Jarvis Key
                    </button>

                    <button
                      onClick={handleGenerateKey}
                      disabled={generatingKey}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#2e374d] bg-[#141824] text-xs font-semibold text-zinc-200 hover:bg-[#1a2030] hover:border-cyan-500/40 transition disabled:opacity-40"
                    >
                      {generatingKey ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-cyan-400" />}
                      Generate New Master Key
                    </button>
                  </div>
                </div>
              </div>

              {/* Scopes & Permissions Card */}
              <div className="p-5 rounded-xl border border-[#1f2433] bg-[#0e111a] space-y-3">
                <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  Autonomous Scopes Granted to Jarvis
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-[#090b10] border border-white/5 space-y-1">
                    <div className="font-mono text-cyan-300 font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      read_all
                    </div>
                    <div className="text-zinc-400 text-[11px] leading-relaxed">
                      Pull unread triage telemetry, full bodies, threads, and attachments across all business mailboxes.
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#090b10] border border-white/5 space-y-1">
                    <div className="font-mono text-emerald-300 font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      send_as_any
                    </div>
                    <div className="text-zinc-400 text-[11px] leading-relaxed">
                      Autonomous outbound dispatch as contact@arpcloudsolutions.co.za or any configured mailbox.
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#090b10] border border-white/5 space-y-1">
                    <div className="font-mono text-purple-300 font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                      super_admin
                    </div>
                    <div className="text-zinc-400 text-[11px] leading-relaxed">
                      Root access to query emails, view operations metrics, and update classification labels.
                    </div>
                  </div>
                </div>
              </div>

              {/* Integration Snippets for Jarvis */}
              <div className="p-5 rounded-xl border border-[#1f2433] bg-[#0e111a] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-sky-400" />
                      Jarvis Integration Samples
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      How Jarvis queries and commands your AetherMail instance.
                    </p>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg bg-[#080a0f] p-1 border border-white/5">
                    {(['curl', 'python', 'env'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setSampleTab(tab)}
                        className={`px-2.5 py-1 text-[11px] font-mono rounded-md transition ${
                          sampleTab === tab ? 'bg-cyan-500/20 text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {tab.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="relative rounded-xl bg-[#07090e] border border-[#1f2433] p-3 text-xs font-mono text-zinc-300 overflow-x-auto">
                  {sampleTab === 'curl' && (
                    <pre className="text-[11px] leading-relaxed">
{`# 1. Jarvis Triage (Pull Unread Mail across all mailboxes)
curl -H "Authorization: Bearer ${activeKeyForSamples}" \\
  "${baseUrl}/api/v1/agent/triage?unread_only=true"

# 2. Jarvis Outbound Dispatch (Send email autonomously)
curl -X POST "${baseUrl}/api/v1/agent/dispatch" \\
  -H "Authorization: Bearer ${activeKeyForSamples}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "client@example.com",
    "subject": "Regarding your cloud migration inquiry",
    "htmlBody": "<p>Hello, this is an automated dispatch from Jarvis.</p>"
  }'`}
                    </pre>
                  )}

                  {sampleTab === 'python' && (
                    <pre className="text-[11px] leading-relaxed">
{`import requests

JARVIS_KEY = "${activeKeyForSamples}"
BASE_URL = "${baseUrl}"

headers = {
    "Authorization": f"Bearer {JARVIS_KEY}",
    "Content-Type": "application/json"
}

# Pull unread emails for autonomous processing
response = requests.get(f"{BASE_URL}/api/v1/agent/triage", headers=headers)
inbox_data = response.json()
print("Total messages to triage:", inbox_data.get("total", 0))`}
                    </pre>
                  )}

                  {sampleTab === 'env' && (
                    <pre className="text-[11px] leading-relaxed">
{`# Jarvis Environment Configuration
AETHERMAIL_URL=${baseUrl}
JARVIS_API_KEY=${activeKeyForSamples}
AETHERMAIL_SENDER=contact@arpcloudsolutions.co.za`}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'mail' && (
            <div className="space-y-6">
              <div className="p-5 rounded-xl border border-[#1f2433] bg-[#0e111a] space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-cyan-400" />
                    Business Mail Configuration
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Autonomous mail routing managed via Resend and AWS Route 53.
                  </p>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="text-zinc-400">Domain</span>
                    <span className="font-mono text-zinc-100 font-medium">arpcloudsolutions.co.za</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="text-zinc-400">Primary Outbound Sender</span>
                    <span className="font-mono text-cyan-300 font-medium">contact@arpcloudsolutions.co.za</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="text-zinc-400">Automated Mailboxes</span>
                    <span className="font-mono text-zinc-300">contact, info, sales, billing</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="text-zinc-400">Receiving Transport</span>
                    <span className="font-mono text-emerald-300">Resend Inbound (inbound-smtp.eu-west-1.amazonaws.com)</span>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-xl border border-[#1f2433] bg-[#0e111a] space-y-3">
                <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <Server className="w-4 h-4 text-emerald-400" />
                  DNS Verification Status
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="font-mono text-zinc-300">SPF Record (Apex)</span>
                    <span className="text-emerald-400 font-medium">v=spf1 include:amazonses.com ~all (PASS)</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="font-mono text-zinc-300">DKIM Record</span>
                    <span className="text-emerald-400 font-medium">resend._domainkey (PASS)</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="font-mono text-zinc-300">DMARC Record</span>
                    <span className="text-emerald-400 font-medium">v=DMARC1; p=quarantine (PASS)</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="font-mono text-zinc-300">MX Inbound Host</span>
                    <span className="text-emerald-400 font-medium">10 inbound-smtp.eu-west-1.amazonaws.com (ACTIVE)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="p-5 rounded-xl border border-[#1f2433] bg-[#0e111a] space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-cyan-400" />
                    Operator Credentials
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Configured operator identity for this AetherMail command center deployment.
                  </p>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="text-zinc-400">Operator Username</span>
                    <span className="font-mono text-cyan-300 font-bold">{user?.username || 'mraaziqp'}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="text-zinc-400">Assigned Role</span>
                    <span className="font-mono text-zinc-100">Administrator (Root)</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="text-zinc-400">Password Status</span>
                    <span className="text-emerald-400 font-medium">Configured (114477)</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#090b10] border border-white/5">
                    <span className="text-zinc-400">Session Security</span>
                    <span className="text-zinc-300 font-mono">HMAC-SHA256 signed HttpOnly cookie (30-day lease)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 border-t border-[#1b202e] bg-[#0c0e15]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[#272e42] bg-[#141824] text-xs font-semibold text-zinc-200 hover:bg-[#1a2030] transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
