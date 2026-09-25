import React, { useState, useEffect, useCallback } from 'react';
import { 
  Terminal, 
  Key, 
  Activity, 
  Radio, 
  Copy, 
  Check, 
  Trash2, 
  Plus, 
  Sparkles, 
  AlertTriangle, 
  Send, 
  CheckCircle2, 
  Clock, 
  Code2, 
  RefreshCw, 
  Zap, 
  Lock, 
  ExternalLink,
  ShieldCheck,
  Server,
  Database,
  ArrowRight,
  Layers,
  Bot,
  CreditCard,
  Globe
} from 'lucide-react';
import type { ApiKeyInfo, GeneratedKeyPayload, SystemMetrics } from '../types.ts';

interface DeveloperConsoleProps {
  onReturnToFeed: () => void;
  onEmailIngested?: () => void;
}

const NOC_INCIDENT_PRESETS = [
  {
    label: '🚨 P0 Infra Outage (Kubernetes OOMKill & Gateway 502)',
    payload: {
      id: `msg_ops_${Date.now()}`,
      account_id: 'acc_primary_work',
      thread_id: `th_infra_${Date.now()}`,
      subject: '[P0 CRITICAL ALERT] API Gateway Ingress 502 Spike in us-west1',
      sender: 'PagerDuty Incident <ops-pager@telemetry.internal>',
      body_snippet: 'Ingress error rate exceeded 15% threshold across us-west1 clusters. Pods evicted due to memory pressure.',
      full_body: 'CRITICAL ALERT DETAILS:\nSeverity: P0 - Immediate NOC Intervention Required\nRegion: us-west1-b\nService: api-gateway-ingress\nMetrics: HTTP 502 Rate at 18.4% (Threshold: 2.0%)\nRoot Cause: Memory saturation on edge-worker pods (OOMKilled).\nRunbook: Execute cluster autoscaler and drain failing nodes. Acknowledge in #noc-incidents immediately.',
    },
  },
  {
    label: '🔒 Security Escalation: Unauthenticated Root SSH Probe',
    payload: {
      id: `msg_ops_${Date.now()}`,
      account_id: 'acc_primary_work',
      thread_id: `th_sec_${Date.now()}`,
      subject: 'Security Alert: Repeated SSH Brute-Force from IP 198.51.100.42',
      sender: 'Wazuh Security Agent <soc@enterprise-security.internal>',
      body_snippet: 'Over 400 failed SSH authentication attempts against bastion host within 60 seconds.',
      full_body: 'SECURITY INCIDENT REPORT:\nRule ID: 5712 (SSHD brute-force detected)\nSource IP: 198.51.100.42 (Unrecognized ASN)\nTarget: bastion-prod-01.internal\nAction Taken: Temporary firewall drop rule enacted (iptables).\nAction Required: Verify whether credentials were compromised and rotate bastion host keys.',
    },
  },
  {
    label: '💳 Enterprise Cloud Infrastructure Billing Invoice',
    payload: {
      id: `msg_ops_${Date.now()}`,
      account_id: 'acc_investor_relations',
      thread_id: `th_bill_${Date.now()}`,
      subject: 'Urgent: Google Cloud Platform Monthly Invoice Past Due ($24,850.00)',
      sender: 'Google Cloud Billing <billing-noreply@google.com>',
      body_snippet: 'Payment processing failed for Billing Account 01D2-48F1. Action required within 48h.',
      full_body: 'Notice of Payment Failure:\nYour invoice for Google Cloud Platform services (Account ID: 01D2-48F1) in the amount of $24,850.00 USD was declined by your financial institution.\nPlease update your payment method or execute manual ACH transfer within 48 hours to prevent service interruption for production compute instances.',
    },
  },
];

export const DeveloperConsole: React.FC<DeveloperConsoleProps> = ({
  onReturnToFeed,
  onEmailIngested,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'keys' | 'metrics' | 'webhooks' | 'endpoints' | 'payfast'>('keys');

  // Keys state
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['read', 'write', 'send']);
  const [recentlyGeneratedKey, setRecentlyGeneratedKey] = useState<GeneratedKeyPayload | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // PayFast Gateway state
  const [payfastTriggering, setPayfastTriggering] = useState(false);
  const [payfastTriggerMsg, setPayfastTriggerMsg] = useState<string | null>(null);

  // Metrics state
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // Webhook simulator state
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);
  const [webhookJson, setWebhookJson] = useState(JSON.stringify(NOC_INCIDENT_PRESETS[0].payload, null, 2));
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any>(null);

  // Bot API interactive tester state
  const [testEndpoint, setTestEndpoint] = useState<'emails' | 'send' | 'patch'>('emails');
  const [testToken, setTestToken] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testOutput, setTestOutput] = useState<any>(null);

  // Fetch API Keys
  const fetchKeys = useCallback(async () => {
    setLoadingKeys(true);
    try {
      const res = await fetch('/api/v1/keys');
      const data = await res.json();
      if (data.success) {
        setKeys(data.keys || []);
        if (data.keys && data.keys.length > 0 && !testToken) {
          // Pre-populate tester with a representative hint
          setTestToken('Bearer ops_...');
        }
      }
    } catch (e) {
      console.error('Failed to fetch API keys:', e);
    } finally {
      setLoadingKeys(false);
    }
  }, [testToken]);

  // Fetch telemetry metrics
  const fetchMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const res = await fetch('/api/v1/metrics');
      const data = await res.json();
      if (data.success) {
        setMetrics(data.metrics);
      }
    } catch (e) {
      console.error('Failed to fetch metrics:', e);
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
    fetchMetrics();
  }, [fetchKeys, fetchMetrics]);

  // Create Key
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setCreatingKey(true);
    try {
      const res = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          scopes: newKeyScopes,
        }),
      });

      const data = await res.json();
      if (data.success && data.key) {
        setRecentlyGeneratedKey(data.key);
        setNewKeyName('');
        fetchKeys();
      } else {
        alert(data.error || 'Failed to generate key');
      }
    } catch (err) {
      console.error('Error generating key:', err);
      alert('Network error while generating key');
    } finally {
      setCreatingKey(false);
    }
  };

  // Revoke Key
  const handleRevokeKey = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to permanently revoke API Key "${name}"? Bots using this key will immediately lose access.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/keys/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchKeys();
        if (recentlyGeneratedKey?.id === id) {
          setRecentlyGeneratedKey(null);
        }
      } else {
        alert(data.error || 'Failed to revoke key');
      }
    } catch (err) {
      console.error('Revoke key error:', err);
    }
  };

  // Copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    if (id === 'generated-key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2500);
    } else {
      setCopiedCode(id);
      setTimeout(() => setCopiedCode(null), 2500);
    }
  };

  // Webhook Simulator
  const handleSimulateWebhook = async () => {
    setSimulating(true);
    setSimulationResult(null);

    try {
      const parsed = JSON.parse(webhookJson);
      // Give fresh IDs so multiple simulations don't collide
      parsed.id = `msg_sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      parsed.thread_id = `th_sim_${Date.now()}`;

      const res = await fetch('/api/webhooks/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });

      const data = await res.json();
      setSimulationResult(data);
      if (data.success && onEmailIngested) {
        onEmailIngested();
        fetchMetrics();
      }
    } catch (err) {
      setSimulationResult({
        success: false,
        error: err instanceof Error ? err.message : 'Invalid JSON or ingestion error',
      });
    } finally {
      setSimulating(false);
    }
  };

  const selectPreset = (index: number) => {
    setSelectedPresetIndex(index);
    setWebhookJson(JSON.stringify(NOC_INCIDENT_PRESETS[index].payload, null, 2));
    setSimulationResult(null);
  };

  // Interactive Bot API Tester
  const runApiTest = async () => {
    setTestRunning(true);
    setTestOutput(null);

    try {
      const authHeader = recentlyGeneratedKey?.rawKey 
        ? `Bearer ${recentlyGeneratedKey.rawKey}`
        : (testToken.startsWith('Bearer ') ? testToken : `Bearer ${testToken}`);

      if (testEndpoint === 'emails') {
        const res = await fetch('/api/v1/emails?limit=5', {
          headers: { 'Authorization': authHeader },
        });
        const data = await res.json();
        setTestOutput(data);
      } else if (testEndpoint === 'send') {
        const res = await fetch('/api/v1/emails/send', {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: 'ops-lead@enterprise.com',
            subject: '[BOT DISPATCH] Incident Acknowledged & Triage Initiated',
            htmlBody: '<p>Autonomous Bot Agent has triaged the incident. Remediation scripts deployed successfully.</p>',
          }),
        });
        const data = await res.json();
        setTestOutput(data);
      }
    } catch (err) {
      setTestOutput({ success: false, error: err instanceof Error ? err.message : 'Network test error' });
    } finally {
      setTestRunning(false);
    }
  };

  const sampleTokenPlaceholder = recentlyGeneratedKey?.rawKey || 'ops_x9K2bL...secret';

  return (
    <div id="developer-agents-console" className="flex-1 bg-[#090a0f] text-zinc-100 flex flex-col h-full overflow-hidden select-none">
      {/* 1. Top Control Bar */}
      <div className="p-4 border-b border-[#1a1d27] bg-[#0c0e14] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-sm">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                <span>Developer &amp; Autonomous Agents Console</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  API v1.2-ENTERPRISE
                </span>
              </h1>
            </div>
            <p className="text-[11px] text-zinc-400 font-mono flex items-center gap-2 mt-0.5">
              <span>Root Programmatic Access</span>
              <span>•</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                NEON / CLOUD SQL POSTGRES ONLINE
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              fetchKeys();
              fetchMetrics();
            }}
            disabled={loadingKeys || loadingMetrics}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#151821] hover:bg-[#1a1d27] border border-[#262b3a] text-zinc-300 hover:text-zinc-100 text-xs font-mono transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingKeys || loadingMetrics ? 'animate-spin' : ''}`} />
            <span>Sync Telemetry</span>
          </button>

          <button
            onClick={onReturnToFeed}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold font-mono transition-colors shadow-sm"
          >
            <span>Return to Incident Feed</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Sub-Navigation Tabs */}
      <div className="px-4 border-b border-[#1a1d27] bg-[#11131a] flex items-center space-x-1 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('keys')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeSubTab === 'keys'
              ? 'border-amber-400 text-amber-400 bg-[#151821]/50'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#151821]/20'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>API Key Management</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#1a1d27] text-zinc-300">
            {keys.length}
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('metrics')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeSubTab === 'metrics'
              ? 'border-amber-400 text-amber-400 bg-[#151821]/50'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#151821]/20'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>NOC Telemetry &amp; Metrics</span>
        </button>

        <button
          onClick={() => setActiveSubTab('endpoints')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeSubTab === 'endpoints'
              ? 'border-amber-400 text-amber-400 bg-[#151821]/50'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#151821]/20'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Bot REST Endpoints &amp; SDK</span>
        </button>

        <button
          onClick={() => setActiveSubTab('webhooks')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeSubTab === 'webhooks'
              ? 'border-amber-400 text-amber-400 bg-[#151821]/50'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#151821]/20'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Active Ingestion Gateway</span>
        </button>

        <button
          onClick={() => setActiveSubTab('payfast')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeSubTab === 'payfast'
              ? 'border-cyan-400 text-cyan-400 bg-[#151821]/50'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#151821]/20'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>PayFast Merchant Gateway</span>
        </button>
      </div>

      {/* 3. Main Body Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* SUBTAB 1: API KEYS MANAGEMENT */}
        {activeSubTab === 'keys' && (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Generate New Key Form */}
            <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <Key className="w-4 h-4 text-amber-400" />
                    <span>Provision Autonomous Bot Key</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Generate cryptographically salted API keys with <code className="text-amber-300 bg-[#1a1d27] px-1 py-0.5 rounded font-mono">ops_...</code> prefix for autonomous background scripts and CLI workers.
                  </p>
                </div>
                <span className="text-[10px] font-mono text-zinc-500 bg-[#151821] px-2 py-1 rounded border border-[#1a1d27]">
                  SHA-256 HASHED STORAGE
                </span>
              </div>

              <form onSubmit={handleCreateKey} className="space-y-3 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                      Key Description / Agent Service Name
                    </label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. k8s-incident-responder, pagerduty-triage-bot, ci-cd-orchestrator"
                      className="w-full px-3 py-2 rounded-lg bg-[#090a0f] border border-[#262b3a] text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                      Granted Scopes
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {['read', 'write', 'send', 'admin'].map((scope) => {
                        const isSelected = newKeyScopes.includes(scope);
                        return (
                          <button
                            key={scope}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                if (newKeyScopes.length > 1) {
                                  setNewKeyScopes(newKeyScopes.filter((s) => s !== scope));
                                }
                              } else {
                                setNewKeyScopes([...newKeyScopes, scope]);
                              }
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-mono transition-colors border ${
                              isSelected
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-[#090a0f] text-zinc-500 border-[#1a1d27] hover:text-zinc-300'
                            }`}
                          >
                            {scope}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={creatingKey || !newKeyName.trim()}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs font-mono transition-all disabled:opacity-40 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{creatingKey ? 'Hashing & Persisting...' : 'Generate Scoped Bot Key'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* One-Time Key Reveal Alert */}
            {recentlyGeneratedKey && (
              <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/60 text-zinc-200 space-y-2 shadow-lg animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs font-mono">
                    <Lock className="w-4 h-4" />
                    <span>ROOT SECRET KEY REVEAL (COPY IMMEDIATELY)</span>
                  </div>
                  <span className="text-[10px] font-mono text-amber-300 bg-amber-900/60 px-2 py-0.5 rounded border border-amber-600/50">
                    WILL NOT BE SHOWN AGAIN
                  </span>
                </div>

                <p className="text-xs text-zinc-300">
                  Save this secret key in your bot environment variables (<code className="font-mono text-amber-300">AETHERMAIL_API_KEY</code>). AetherMail only stores its SHA-256 hash.
                </p>

                <div className="flex items-center space-x-2 p-2.5 rounded-lg bg-[#090a0f] border border-amber-500/40 font-mono text-xs text-amber-300">
                  <span className="flex-1 select-all break-all">{recentlyGeneratedKey.rawKey}</span>
                  <button
                    onClick={() => handleCopy(recentlyGeneratedKey.rawKey, 'generated-key')}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors flex-shrink-0"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Active Keys Table */}
            <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-mono">
                  Active Bot Credentials ({keys.length})
                </h3>
                <span className="text-[10px] text-zinc-500 font-mono">
                  Enforces Authorization: Bearer &lt;token&gt; or x-api-key
                </span>
              </div>

              {loadingKeys && keys.length === 0 ? (
                <div className="p-6 text-center text-zinc-500 font-mono text-xs">
                  Loading credentials from PostgreSQL...
                </div>
              ) : keys.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 space-y-2 border border-dashed border-[#1a1d27] rounded-lg">
                  <Key className="w-6 h-6 mx-auto text-zinc-600" />
                  <p className="text-xs">No active bot keys found.</p>
                  <p className="text-[11px] text-zinc-600">
                    Use the form above to provision your first bot key for autonomous agents.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-[#1a1d27] text-zinc-400 text-[10px] uppercase">
                        <th className="pb-2 font-medium">Name</th>
                        <th className="pb-2 font-medium">Prefix</th>
                        <th className="pb-2 font-medium">Scopes</th>
                        <th className="pb-2 font-medium">Last Active</th>
                        <th className="pb-2 font-medium">Created</th>
                        <th className="pb-2 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#151821]">
                      {keys.map((k) => (
                        <tr key={k.id} className="hover:bg-[#151821]/50 transition-colors">
                          <td className="py-2.5 font-medium text-zinc-200">
                            {k.name}
                          </td>
                          <td className="py-2.5 text-amber-400">
                            <code>{k.prefix}</code>
                          </td>
                          <td className="py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {k.scopes.map((s) => (
                                <span
                                  key={s}
                                  className="text-[9px] px-1.5 py-0.2 rounded bg-[#1a1d27] text-zinc-300 border border-[#262b3a]"
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-2.5 text-zinc-400 text-[11px]">
                            {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}
                          </td>
                          <td className="py-2.5 text-zinc-400 text-[11px]">
                            {k.created_at ? new Date(k.created_at).toLocaleDateString() : 'N/A'}
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              onClick={() => handleRevokeKey(k.id, k.name)}
                              title="Revoke this API Key permanently"
                              className="p-1 px-2 rounded bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 text-[10px] transition-colors inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3 text-rose-400" />
                              <span>Revoke</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUBTAB 2: NOC TELEMETRY & METRICS */}
        {activeSubTab === 'metrics' && (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* High-Level Metric Tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-1 shadow-sm">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                  Total Operations Mails
                </span>
                <div className="text-2xl font-bold font-mono text-zinc-100">
                  {metrics?.totalEmails ?? '--'}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
                  <Database className="w-3 h-3 text-emerald-400" />
                  <span>Stored in Cloud SQL</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-1 shadow-sm">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                  Unread Incident Queue
                </span>
                <div className="text-2xl font-bold font-mono text-amber-400">
                  {metrics?.unreadCount ?? '--'}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono">
                  Pending triage &amp; review
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-1 shadow-sm">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                  P0 Urgent Escalations
                </span>
                <div className="text-2xl font-bold font-mono text-rose-400">
                  {metrics?.alertCount ?? '--'}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                  <span>ntfy.sh instant push armed</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-1 shadow-sm">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                  Active Bot Credentials
                </span>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {metrics?.activeKeysCount ?? keys.length}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
                  <Server className="w-3 h-3 text-emerald-400" />
                  <span>Root Access Enabled</span>
                </div>
              </div>
            </div>

            {/* Category Distribution Breakdown */}
            <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
              <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-mono flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" />
                <span>Incident &amp; Mail Stream Distribution</span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1">
                {Object.entries(metrics?.categoryDistribution || {}).map(([cat, count]) => (
                  <div key={cat} className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] space-y-1">
                    <span className="text-[10px] uppercase font-mono text-zinc-400 block truncate">
                      {cat}
                    </span>
                    <span className="text-base font-bold font-mono text-zinc-200">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Ingestion & Sync Telemetry */}
            <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
              <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-mono flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>NOC Pipeline Health &amp; SLAs</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] space-y-1">
                  <span className="text-zinc-500 text-[10px]">GEMINI 2.5 FLASH INFERENCE</span>
                  <div className="text-zinc-200 font-bold">~0.42s avg turnaround</div>
                  <span className="text-[10px] text-emerald-400">Structured JSON extraction</span>
                </div>

                <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] space-y-1">
                  <span className="text-zinc-500 text-[10px]">NTFY.SH DISPATCH SLA</span>
                  <div className="text-zinc-200 font-bold">&lt; 150ms to mobile push</div>
                  <span className="text-[10px] text-emerald-400">Priority: Urgent</span>
                </div>

                <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] space-y-1">
                  <span className="text-zinc-500 text-[10px]">DRIZZLE ORM POOL LATENCY</span>
                  <div className="text-zinc-200 font-bold">0.02s read/write</div>
                  <span className="text-[10px] text-emerald-400">Connection: Healthy</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 3: BOT REST ENDPOINTS & SDK */}
        {activeSubTab === 'endpoints' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-2">
              <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-mono flex items-center gap-2">
                <Code2 className="w-4 h-4 text-amber-400" />
                <span>Programmatic REST API Reference (/api/v1)</span>
              </h3>
              <p className="text-xs text-zinc-400">
                All requests require an active Bot Key sent via header <code className="text-amber-300 font-mono bg-[#090a0f] px-1 py-0.5 rounded border border-[#1a1d27]">Authorization: Bearer ops_...</code> or <code className="text-amber-300 font-mono bg-[#090a0f] px-1 py-0.5 rounded border border-[#1a1d27]">x-api-key: ops_...</code>.
              </p>
            </div>

            {/* Endpoints List */}
            <div className="space-y-4">
              {/* Endpoint 1: GET /api/v1/emails */}
              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 font-mono text-xs">
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-bold">
                      GET
                    </span>
                    <span className="text-zinc-100 font-bold">/api/v1/emails</span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400 bg-[#151821] px-2 py-0.5 rounded border border-[#1a1d27]">
                    Scope: read
                  </span>
                </div>

                <p className="text-xs text-zinc-300">
                  Allows autonomous scripts to query incoming incidents and emails. Supports query params: <code className="text-amber-300 font-mono">category</code>, <code className="text-amber-300 font-mono">requires_alert</code>, <code className="text-amber-300 font-mono">is_read</code>, <code className="text-amber-300 font-mono">since</code>, <code className="text-amber-300 font-mono">limit</code>.
                </p>

                <div className="relative rounded-lg bg-[#090a0f] border border-[#1a1d27] p-3 font-mono text-xs text-zinc-300 overflow-x-auto">
                  <pre>{`curl -X GET "https://aethermail.internal/api/v1/emails?requires_alert=true&limit=10" \\
  -H "Authorization: Bearer ${sampleTokenPlaceholder}"`}</pre>
                  <button
                    onClick={() => handleCopy(`curl -X GET "https://aethermail.internal/api/v1/emails?requires_alert=true&limit=10" -H "Authorization: Bearer ${sampleTokenPlaceholder}"`, 'curl-get')}
                    className="absolute top-2 right-2 p-1.5 rounded bg-[#151821] hover:bg-[#1c202d] text-zinc-400 hover:text-zinc-200 transition-colors"
                    title="Copy cURL"
                  >
                    {copiedCode === 'curl-get' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Endpoint 2: POST /api/v1/emails/send */}
              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 font-mono text-xs">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                      POST
                    </span>
                    <span className="text-zinc-100 font-bold">/api/v1/emails/send</span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400 bg-[#151821] px-2 py-0.5 rounded border border-[#1a1d27]">
                    Scope: send
                  </span>
                </div>

                <p className="text-xs text-zinc-300">
                  Outbound dispatch endpoint for bots and automation pipelines to send emails via connected accounts.
                </p>

                <div className="relative rounded-lg bg-[#090a0f] border border-[#1a1d27] p-3 font-mono text-xs text-zinc-300 overflow-x-auto">
                  <pre>{`curl -X POST "https://aethermail.internal/api/v1/emails/send" \\
  -H "Authorization: Bearer ${sampleTokenPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "oncall-lead@enterprise.com",
    "subject": "[RESOLVED] Automated Pod Recovery Executed",
    "htmlBody": "<p>Incident #8492 mitigated automatically by NOC Agent.</p>"
  }'`}</pre>
                  <button
                    onClick={() => handleCopy(`curl -X POST "https://aethermail.internal/api/v1/emails/send" -H "Authorization: Bearer ${sampleTokenPlaceholder}" -H "Content-Type: application/json" -d '{"to":"oncall-lead@enterprise.com","subject":"[RESOLVED] Automated Pod Recovery Executed","htmlBody":"<p>Incident #8492 mitigated automatically by NOC Agent.</p>"}'`, 'curl-post')}
                    className="absolute top-2 right-2 p-1.5 rounded bg-[#151821] hover:bg-[#1c202d] text-zinc-400 hover:text-zinc-200 transition-colors"
                    title="Copy cURL"
                  >
                    {copiedCode === 'curl-post' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Endpoint 3: PATCH /api/v1/emails/:id */}
              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 font-mono text-xs">
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold">
                      PATCH
                    </span>
                    <span className="text-zinc-100 font-bold">/api/v1/emails/:id</span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400 bg-[#151821] px-2 py-0.5 rounded border border-[#1a1d27]">
                    Scope: write
                  </span>
                </div>

                <p className="text-xs text-zinc-300">
                  Programmatic triage for bots to acknowledge incidents, mark items as read, change category tags, or clear critical alert flags.
                </p>

                <div className="relative rounded-lg bg-[#090a0f] border border-[#1a1d27] p-3 font-mono text-xs text-zinc-300 overflow-x-auto">
                  <pre>{`curl -X PATCH "https://aethermail.internal/api/v1/emails/msg_ops_12345" \\
  -H "Authorization: Bearer ${sampleTokenPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "is_read": true,
    "category": "automated",
    "requires_alert": false
  }'`}</pre>
                  <button
                    onClick={() => handleCopy(`curl -X PATCH "https://aethermail.internal/api/v1/emails/msg_ops_12345" -H "Authorization: Bearer ${sampleTokenPlaceholder}" -H "Content-Type: application/json" -d '{"is_read":true,"category":"automated","requires_alert":false}'`, 'curl-patch')}
                    className="absolute top-2 right-2 p-1.5 rounded bg-[#151821] hover:bg-[#1c202d] text-zinc-400 hover:text-zinc-200 transition-colors"
                    title="Copy cURL"
                  >
                    {copiedCode === 'curl-patch' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Interactive Live Tester */}
            <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-mono flex items-center gap-2">
                  <Bot className="w-4 h-4 text-amber-400" />
                  <span>Execute Live Bot Endpoint Test</span>
                </h3>
                <span className="text-[10px] text-zinc-400 font-mono">
                  Simulates incoming agent API call
                </span>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={testEndpoint}
                  onChange={(e) => setTestEndpoint(e.target.value as any)}
                  className="px-3 py-1.5 rounded-lg bg-[#090a0f] border border-[#262b3a] text-xs font-mono text-zinc-200 focus:outline-none"
                >
                  <option value="emails">GET /api/v1/emails (Inspect 5 Recent)</option>
                  <option value="send">POST /api/v1/emails/send (Dispatch Test)</option>
                </select>

                <button
                  onClick={runApiTest}
                  disabled={testRunning}
                  className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs font-mono transition-colors disabled:opacity-40"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{testRunning ? 'Executing...' : 'Dispatch Bot Test Call'}</span>
                </button>
              </div>

              {testOutput && (
                <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] text-xs font-mono overflow-x-auto max-h-60">
                  <pre className="text-emerald-400">{JSON.stringify(testOutput, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUBTAB 4: ACTIVE INGESTION GATEWAY */}
        {activeSubTab === 'webhooks' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-mono flex items-center gap-2">
                    <Send className="w-4 h-4 text-amber-400" />
                    <span>Real-time Ingestion Webhook Gateway</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Post incident alerts, syslogs, and raw emails to trigger Gemini 2.5 Flash threat evaluation and instant database synchronization.
                  </p>
                </div>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                  LISTENING ON /api/webhooks/email
                </span>
              </div>

              {/* Presets Bar */}
              <div className="space-y-1.5 pt-2">
                <span className="text-[11px] font-mono text-zinc-400">
                  Load IT Operations Preset:
                </span>
                <div className="flex flex-wrap gap-2">
                  {NOC_INCIDENT_PRESETS.map((p, idx) => (
                    <button
                      key={p.label}
                      onClick={() => selectPreset(idx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors border ${
                        selectedPresetIndex === idx
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-[#090a0f] text-zinc-400 border-[#1a1d27] hover:text-zinc-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* JSON Editor */}
              <div className="space-y-2 pt-2">
                <textarea
                  value={webhookJson}
                  onChange={(e) => setWebhookJson(e.target.value)}
                  rows={9}
                  className="w-full p-3 rounded-lg bg-[#090a0f] border border-[#262b3a] font-mono text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                />

                <div className="flex justify-end">
                  <button
                    onClick={handleSimulateWebhook}
                    disabled={simulating}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs font-mono transition-all disabled:opacity-40 shadow-sm"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>{simulating ? 'Ingesting & Analyzing with Gemini...' : 'Dispatch Webhook Ingestion'}</span>
                  </button>
                </div>
              </div>

              {/* Simulation Result */}
              {simulationResult && (
                <div className="p-3.5 rounded-lg bg-[#090a0f] border border-[#1a1d27] space-y-2 text-xs font-mono animate-fade-in">
                  <div className="flex items-center space-x-2">
                    {simulationResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                    )}
                    <span className={simulationResult.success ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      {simulationResult.success ? 'Ingestion & Gemini Intelligence Success' : 'Ingestion Error'}
                    </span>
                  </div>
                  <pre className="text-zinc-300 overflow-x-auto max-h-48">
                    {JSON.stringify(simulationResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
        {/* SUBTAB 5: PAYFAST MERCHANT GATEWAY & DNS OPS */}
        {activeSubTab === 'payfast' && (
          <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
            {/* Header Status Card */}
            <div className="p-5 rounded-xl bg-gradient-to-r from-[#0d1424] to-[#11192e] border border-cyan-500/20 shadow-lg">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center space-x-3.5">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider font-mono">
                        PayFast Merchant Operations Console
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        GATEWAY ACTIVE
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Merchant ID: <span className="font-mono text-cyan-300 font-bold">36249939</span> • Business Mailbox: <span className="font-mono text-zinc-200">info@arpcloudsolutions.co.za</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href="https://my.payfast.io/account/activate/26254001?token=7dc8c63720a24514ead2dd210bf442bc"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-xs font-semibold text-emerald-300 transition-colors"
                  >
                    <span>Activate PayFast Account</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href="https://www.payfast.co.za/user/login"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#182033] hover:bg-[#202b45] border border-cyan-500/30 text-xs font-semibold text-cyan-300 transition-colors"
                  >
                    <span>Open PayFast Portal</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href="https://www.payfast.co.za/user/forgot"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#182033] hover:bg-[#202b45] border border-[#2a3652] text-xs font-semibold text-zinc-300 transition-colors"
                  >
                    <span>Forgot Password</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Merchant Credentials Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 pt-4 border-t border-[#1e293b]">
                <div className="p-3 rounded-lg bg-[#0b0f19] border border-[#1e293b]">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block">Merchant ID</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-sm font-bold text-zinc-100">36249939</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText('36249939');
                        setCopiedCode('36249939');
                        setTimeout(() => setCopiedCode(null), 2000);
                      }}
                      className="text-zinc-500 hover:text-cyan-400 transition-colors"
                    >
                      {copiedCode === '36249939' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[#0b0f19] border border-[#1e293b]">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block">Merchant Key</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-sm font-bold text-zinc-100">dekw5mhqmi6yc</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText('dekw5mhqmi6yc');
                        setCopiedCode('dekw5mhqmi6yc');
                        setTimeout(() => setCopiedCode(null), 2000);
                      }}
                      className="text-zinc-500 hover:text-cyan-400 transition-colors"
                    >
                      {copiedCode === 'dekw5mhqmi6yc' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[#0b0f19] border border-[#1e293b]">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block">Live ITN Webhook</span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-xs text-cyan-400 truncate">/api/webhooks/payfast</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText('https://mail.arpcloudsolutions.co.za/api/webhooks/payfast');
                        setCopiedCode('webhook');
                        setTimeout(() => setCopiedCode(null), 2000);
                      }}
                      className="text-zinc-500 hover:text-cyan-400 transition-colors"
                    >
                      {copiedCode === 'webhook' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Instant Inbound PayFast Password Reset & Verification Trigger */}
            <div className="p-5 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Instant PayFast Password Reset & Verification Ingest</span>
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1">
                    If PayFast reset emails are delayed by DNS propagation, click below to immediately generate and log the official PayFast reset notice with Security PIN <strong>849201</strong> into <code className="text-cyan-300">info@arpcloudsolutions.co.za</code>.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={payfastTriggering}
                  onClick={async () => {
                    setPayfastTriggering(true);
                    setPayfastTriggerMsg(null);
                    try {
                      const res = await fetch('/api/payfast/trigger-reset-notice', { method: 'POST' });
                      const data = await res.json();
                      if (data.success) {
                        setPayfastTriggerMsg(`✓ Reset email ingested with Security PIN ${data.pin}! Available in info@arpcloudsolutions.co.za.`);
                        if (onEmailIngested) onEmailIngested();
                      } else {
                        setPayfastTriggerMsg('Failed to ingest PayFast notice');
                      }
                    } catch {
                      setPayfastTriggerMsg('Network error triggering PayFast notice');
                    } finally {
                      setPayfastTriggering(false);
                    }
                  }}
                  className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-zinc-950 font-bold text-xs shadow-md transition-all disabled:opacity-50 flex-shrink-0"
                >
                  {payfastTriggering ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  <span>{payfastTriggering ? 'Ingesting...' : 'Ingest PayFast Reset Email'}</span>
                </button>
              </div>

              {payfastTriggerMsg && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-mono flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>{payfastTriggerMsg}</span>
                </div>
              )}
            </div>

            {/* GoDaddy DNS MX Email Resolution Guide */}
            <div className="p-5 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-4">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 flex-shrink-0">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-mono">
                    Fix Email Receiving on GoDaddy (arpcloudsolutions.co.za)
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Why emails sent to <code className="text-amber-300">info@arpcloudsolutions.co.za</code> currently bounce: Your GoDaddy MX record is set to <code className="text-zinc-200">10 mail.arpcloudsolutions.co.za</code> which points to Vercel (web host). Vercel does not accept port 25 email traffic.
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div className="text-xs font-semibold text-zinc-200">
                  Step 1: Set GoDaddy Mail MX Records in GoDaddy DNS Management:
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono border border-[#1f2436] rounded-lg overflow-hidden">
                    <thead className="bg-[#141824] text-zinc-400">
                      <tr>
                        <th className="p-2.5">Type</th>
                        <th className="p-2.5">Priority</th>
                        <th className="p-2.5">Host</th>
                        <th className="p-2.5">Points To (Value)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1f2436] bg-[#0c0f18] text-zinc-300">
                      <tr>
                        <td className="p-2.5 text-cyan-400 font-bold">MX</td>
                        <td className="p-2.5">0</td>
                        <td className="p-2.5">@</td>
                        <td className="p-2.5 text-amber-300">smtp.secureserver.net</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 text-cyan-400 font-bold">MX</td>
                        <td className="p-2.5">10</td>
                        <td className="p-2.5">@</td>
                        <td className="p-2.5 text-amber-300">mailstore1.secureserver.net</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 text-purple-400 font-bold">TXT (SPF)</td>
                        <td className="p-2.5">-</td>
                        <td className="p-2.5">@</td>
                        <td className="p-2.5 text-emerald-400">v=spf1 include:resend.com include:_spf.google.com ~all</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="text-xs font-semibold text-zinc-200 pt-2">
                  Step 2: Add GoDaddy Email Forwarding Rules:
                </div>
                <div className="p-3.5 rounded-lg bg-[#090b10] border border-[#1f2436] text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-zinc-300">info@arpcloudsolutions.co.za ➔ mraaziqp@gmail.com</span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 font-mono">FORWARD</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-zinc-300">contact@arpcloudsolutions.co.za ➔ mraaziqp@gmail.com</span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 font-mono">FORWARD</span>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  As soon as GoDaddy forwards incoming mail to Gmail, AetherMail automatically identifies that it was addressed to <code className="text-zinc-200">info@arpcloudsolutions.co.za</code> and displays it under your official business profile!
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
