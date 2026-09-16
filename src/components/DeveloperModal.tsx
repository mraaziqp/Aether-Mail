import React, { useState, useEffect } from 'react';
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
  X,
  Code2,
  RefreshCw,
  Zap,
  Lock,
  ExternalLink
} from 'lucide-react';
import type { ApiKeyInfo, GeneratedKeyPayload, SystemMetrics } from '../types.ts';

interface DeveloperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEmailIngested?: () => void;
}

const PRESET_WEBHOOKS = [
  {
    label: '🚨 P0 Infrastructure Outage (PagerDuty)',
    payload: {
      id: `msg_dev_${Date.now()}`,
      account_id: 'acc_primary_work',
      thread_id: `th_infra_${Date.now()}`,
      subject: '[P0 CRITICAL ALERT] API Gateway 502 Rate Spike in us-west1',
      sender: 'PagerDuty Alert <noc-alerts@pagerduty.internal>',
      body_snippet: 'Ingress error rate exceeded 15% threshold over 3 minutes. Automated mitigation activated.',
      full_body: 'CRITICAL ALERT DETAILS:\nSeverity: P0 - Immediate Developer Action Required\nRegion: us-west1\nError Type: HTTP 502 Bad Gateway spike across ingress-edge-03\nMitigation: Traffic rerouted to secondary cluster. On-call engineer please acknowledge in Slack #infra-ops.',
    },
  },
  {
    label: '💰 Wire Transfer Authorization (Financial)',
    payload: {
      id: `msg_dev_${Date.now()}`,
      account_id: 'acc_investor_relations',
      thread_id: `th_wire_${Date.now()}`,
      subject: 'URGENT: Escrow Wire Transfer Authorization Request for Acquisition',
      sender: 'SVB Escrow Agent <wire-ops@svb-bank.internal>',
      body_snippet: 'Please authorize the pending wire transfer of $1,450,000 for project Apollo closing.',
      full_body: 'Dear Finance Team,\n\nPlease review and execute the wire transfer of $1,450,000 to the designated escrow account before 4:00 PM EST today. Failure to wire will incur closing extension fees.',
    },
  },
  {
    label: '🤝 Customer Enterprise Escalation',
    payload: {
      id: `msg_dev_${Date.now()}`,
      account_id: 'acc_primary_work',
      thread_id: `th_customer_${Date.now()}`,
      subject: 'Customer Escalation: Enterprise SSO Integration Blocked',
      sender: 'Sarah Jenkins <sjenkins@acme-corp.com>',
      body_snippet: 'Our deployment is stalled because SAML 2.0 cert mismatch error is occurring.',
      full_body: 'Hi AetherMail Team,\n\nOur IT team is unable to complete Okta SSO setup for 2,000 seats. We are getting certificate validation errors. Can someone jump on a bridge call immediately?',
    },
  },
];

export const DeveloperModal: React.FC<DeveloperModalProps> = ({
  isOpen,
  onClose,
  onEmailIngested,
}) => {
  const [activeTab, setActiveTab] = useState<'keys' | 'metrics' | 'webhooks'>('keys');

  // Keys state
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['read', 'write', 'send']);
  const [recentlyGeneratedKey, setRecentlyGeneratedKey] = useState<GeneratedKeyPayload | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState<string | null>(null);

  // Metrics state
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // Webhook simulator state
  const [webhookJson, setWebhookJson] = useState(JSON.stringify(PRESET_WEBHOOKS[0].payload, null, 2));
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any>(null);

  // Fetch keys
  const fetchKeys = async () => {
    setLoadingKeys(true);
    try {
      const res = await fetch('/api/v1/keys');
      const data = await res.json();
      if (data.success) {
        setKeys(data.keys || []);
      }
    } catch (e) {
      console.error('Failed to fetch API keys:', e);
    } finally {
      setLoadingKeys(false);
    }
  };

  // Fetch metrics
  const fetchMetrics = async () => {
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
  };

  useEffect(() => {
    if (isOpen) {
      fetchKeys();
      fetchMetrics();
    }
  }, [isOpen]);

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
      }
    } catch (err) {
      console.error('Failed to create key:', err);
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke API key "${name}"? External bots using this key will immediately lose access.`)) {
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
      }
    } catch (err) {
      console.error('Failed to revoke key:', err);
    }
  };

  const handleSimulateWebhook = async () => {
    setSimulating(true);
    setSimulationResult(null);
    try {
      const payload = JSON.parse(webhookJson);
      const res = await fetch('/api/webhooks/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setSimulationResult(data);
      if (onEmailIngested) {
        onEmailIngested();
      }
    } catch (err) {
      setSimulationResult({
        error: err instanceof Error ? err.message : 'Invalid JSON format or network error',
      });
    } finally {
      setSimulating(false);
    }
  };

  const copyToClipboard = (text: string, type: 'key' | 'curl', curlId?: string) => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedCurl(curlId || null);
      setTimeout(() => setCopiedCurl(null), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div 
        id="developer-integrations-modal"
        className="w-full max-w-4xl bg-[#0e1017] border border-[#1a1d27] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#1a1d27] bg-[#11131a] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-[#1a1d27] border border-[#262b3a] flex items-center justify-center text-amber-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-zinc-100 tracking-tight">Developer & Bot Engine</h2>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  v1 REST API
                </span>
              </div>
              <p className="text-xs text-zinc-400">Programmatic root access, API keys, and real-time telemetry</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>POSTGRES LIVE</span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1d27] rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-[#1a1d27] bg-[#0c0e14] flex space-x-1">
          <button
            onClick={() => setActiveTab('keys')}
            className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'keys'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>Bot API Keys ({keys.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('metrics');
              fetchMetrics();
            }}
            className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'metrics'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>System Telemetry</span>
          </button>

          <button
            onClick={() => setActiveTab('webhooks')}
            className={`flex items-center space-x-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'webhooks'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Ingestion Webhook Simulator</span>
          </button>
        </div>

        {/* Tab Content Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-zinc-300 text-xs">
          {/* TAB 1: API KEYS */}
          {activeTab === 'keys' && (
            <div className="space-y-6">
              {/* Recently Created Key Alert Banner */}
              {recentlyGeneratedKey && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                  <div className="flex items-center justify-between text-amber-300 font-medium">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      New API Key Generated: &quot;{recentlyGeneratedKey.name}&quot;
                    </span>
                    <span className="text-[11px] text-amber-400/80 font-mono">SAVE IMMEDIATELY</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    This raw secret token will never be displayed again. External bots must pass this in the{' '}
                    <code className="px-1 py-0.5 rounded bg-[#11131a] text-zinc-200">Authorization: Bearer &lt;token&gt;</code> or{' '}
                    <code className="px-1 py-0.5 rounded bg-[#11131a] text-zinc-200">x-api-key: &lt;token&gt;</code> header.
                  </p>
                  <div className="flex items-center space-x-2 pt-1">
                    <input
                      type="text"
                      readOnly
                      value={recentlyGeneratedKey.rawKey}
                      className="flex-1 px-3 py-2 rounded-lg bg-[#090a0f] border border-[#262b3a] text-amber-300 font-mono text-xs select-all outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(recentlyGeneratedKey.rawKey, 'key')}
                      className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold transition-colors"
                    >
                      {copiedKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>{copiedKey ? 'Copied!' : 'Copy Key'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Generate New Key Form */}
              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-amber-400" />
                    Provision New Bot Key
                  </h3>
                  <span className="text-[11px] text-zinc-500">SHA-256 Hashed Persistence</span>
                </div>

                <form onSubmit={handleCreateKey} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                        Key Identifier / Bot Name
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Incident-Triage-Agent, Slack-Bot, Auto-Responder"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-[#090a0f] border border-[#1a1d27] focus:border-amber-400 text-zinc-200 outline-none transition-colors placeholder:text-zinc-600"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                        Granted Scopes
                      </label>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {['read', 'write', 'send', 'admin'].map((scope) => {
                          const isChecked = newKeyScopes.includes(scope);
                          return (
                            <label
                              key={scope}
                              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md border text-xs cursor-pointer select-none transition-all ${
                                isChecked
                                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                                  : 'bg-[#090a0f] border-[#1a1d27] text-zinc-400 hover:text-zinc-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="hidden"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setNewKeyScopes(newKeyScopes.filter((s) => s !== scope));
                                  } else {
                                    setNewKeyScopes([...newKeyScopes, scope]);
                                  }
                                }}
                              />
                              <span className="font-mono text-[11px] uppercase">{scope}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={creatingKey || !newKeyName.trim()}
                      className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>{creatingKey ? 'Hashing & Registering...' : 'Generate API Key'}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Active Keys Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-200">Registered Bot Credentials</h3>
                  <button
                    onClick={fetchKeys}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingKeys ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                <div className="border border-[#1a1d27] rounded-xl overflow-hidden bg-[#11131a]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#090a0f] text-zinc-400 text-[11px] border-b border-[#1a1d27]">
                      <tr>
                        <th className="py-2.5 px-4">Name / Agent</th>
                        <th className="py-2.5 px-4">Key Prefix</th>
                        <th className="py-2.5 px-4">Scopes</th>
                        <th className="py-2.5 px-4">Last Activity</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1a1d27]">
                      {keys.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-zinc-500">
                            No API keys provisioned yet. Generate one above to grant external bots access.
                          </td>
                        </tr>
                      ) : (
                        keys.map((k) => (
                          <tr key={k.id} className="hover:bg-[#151821] transition-colors">
                            <td className="py-3 px-4 font-medium text-zinc-200 flex items-center gap-2">
                              <Lock className="w-3.5 h-3.5 text-zinc-400" />
                              <span>{k.name}</span>
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-amber-400/90">
                              {k.prefix}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex gap-1 flex-wrap">
                                {k.scopes.map((s) => (
                                  <span
                                    key={s}
                                    className="px-1.5 py-0.2 rounded bg-[#090a0f] border border-[#262b3a] text-[10px] font-mono text-zinc-300 uppercase"
                                  >
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-zinc-400 text-[11px]">
                              {k.last_used_at ? (
                                <span className="flex items-center gap-1 text-emerald-400">
                                  <Clock className="w-3 h-3" />
                                  {new Date(k.last_used_at).toLocaleTimeString()}
                                </span>
                              ) : (
                                <span className="text-zinc-600">Never</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => handleRevokeKey(k.id, k.name)}
                                title="Revoke Key"
                                className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bot Integration cURL Recipes */}
              <div className="p-4 rounded-xl bg-[#0d0f16] border border-[#1a1d27] space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-amber-400" />
                    External Agent cURL Recipes
                  </h4>
                  <span className="text-[10px] text-zinc-500">Direct HTTP integration</span>
                </div>

                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] font-mono text-[11px] text-zinc-300 relative group">
                    <div className="text-zinc-500 mb-1 text-[10px] font-sans font-medium flex justify-between">
                      <span>1. Deep Query Incoming Urgent Mails (GET /api/v1/emails)</span>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `curl -H "Authorization: Bearer <your_token>" "${window.location.origin}/api/v1/emails?category=urgent&limit=10"`,
                            'curl',
                            'curl1'
                          )
                        }
                        className="text-amber-400 hover:text-amber-300"
                      >
                        {copiedCurl === 'curl1' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <code>
                      curl -H &quot;Authorization: Bearer aeth_...&quot; &quot;{window.location.origin}/api/v1/emails?category=urgent&amp;limit=10&quot;
                    </code>
                  </div>

                  <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] font-mono text-[11px] text-zinc-300 relative group">
                    <div className="text-zinc-500 mb-1 text-[10px] font-sans font-medium flex justify-between">
                      <span>2. Programmatic Outbound Dispatch (POST /api/v1/emails/send)</span>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `curl -X POST -H "Authorization: Bearer <your_token>" -H "Content-Type: application/json" -d '{"to":"dev-lead@company.com","subject":"Incident Mitigation","htmlBody":"<p>Patch deployed</p>"}' "${window.location.origin}/api/v1/emails/send"`,
                            'curl',
                            'curl2'
                          )
                        }
                        className="text-amber-400 hover:text-amber-300"
                      >
                        {copiedCurl === 'curl2' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <code>
                      curl -X POST -H &quot;Authorization: Bearer aeth_...&quot; -H &quot;Content-Type: application/json&quot; -d &#39;{JSON.stringify({ to: "lead@target.com", subject: "Mitigation Report", htmlBody: "<p>Deployed.</p>" })}&#39; &quot;{window.location.origin}/api/v1/emails/send&quot;
                    </code>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SYSTEM TELEMETRY */}
          {activeTab === 'metrics' && (
            <div className="space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27]">
                  <div className="text-[11px] text-zinc-400 mb-1">Total Synced Emails</div>
                  <div className="text-2xl font-bold text-zinc-100 font-mono">
                    {metrics?.totalEmails ?? '...'}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">Stored in Cloud SQL</div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27]">
                  <div className="text-[11px] text-zinc-400 mb-1">Unread Queue</div>
                  <div className="text-2xl font-bold text-amber-400 font-mono">
                    {metrics?.unreadCount ?? '...'}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">Pending action</div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27]">
                  <div className="text-[11px] text-zinc-400 mb-1">Urgent P0 Alerts</div>
                  <div className="text-2xl font-bold text-rose-400 font-mono">
                    {metrics?.alertCount ?? '...'}
                  </div>
                  <div className="text-[10px] text-rose-400/80 mt-1">Pushed to ntfy.sh</div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27]">
                  <div className="text-[11px] text-zinc-400 mb-1">Active Bot Keys</div>
                  <div className="text-2xl font-bold text-emerald-400 font-mono">
                    {metrics?.activeKeysCount ?? '...'}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">Authorized tokens</div>
                </div>
              </div>

              {/* Category Breakdown */}
              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-4">
                <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-amber-400" />
                  AI Ingestion Category Distribution
                </h4>

                {metrics?.categoryDistribution && (
                  <div className="space-y-2">
                    {Object.entries(metrics.categoryDistribution).map(([cat, rawCount]) => {
                      const count = Number(rawCount);
                      const total = metrics.totalEmails || 1;
                      const percentage = Math.round((count / total) * 100);
                      return (
                        <div key={cat} className="space-y-1">
                          <div className="flex justify-between text-[11px]">
                            <span className="font-mono capitalize text-zinc-300">{cat}</span>
                            <span className="text-zinc-400 font-mono">
                              {count} messages ({percentage}%)
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-[#090a0f] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                cat === 'urgent'
                                  ? 'bg-rose-500'
                                  : cat === 'financial'
                                  ? 'bg-amber-400'
                                  : cat === 'work'
                                  ? 'bg-blue-500'
                                  : cat === 'personal'
                                  ? 'bg-emerald-400'
                                  : 'bg-zinc-600'
                              }`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Integration Topology */}
              <div className="p-4 rounded-xl bg-[#11131a] border border-[#1a1d27] space-y-3">
                <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Service Connection Topology
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                  <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] flex items-center justify-between">
                    <div>
                      <div className="font-medium text-zinc-200">Database Layer</div>
                      <div className="text-zinc-500">Google Cloud SQL (PostgreSQL)</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px]">
                      CONNECTED
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] flex items-center justify-between">
                    <div>
                      <div className="font-medium text-zinc-200">AI Intelligence Core</div>
                      <div className="text-zinc-500">Gemini 2.5 Flash SDK</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px]">
                      ONLINE
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] flex items-center justify-between">
                    <div>
                      <div className="font-medium text-zinc-200">Push Notification Engine</div>
                      <div className="text-zinc-500">ntfy.sh Topic: aethermail-alerts</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono text-[10px]">
                      STANDBY
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] flex items-center justify-between">
                    <div>
                      <div className="font-medium text-zinc-200">Outbound Dispatch</div>
                      <div className="text-zinc-500">Sync REST Engine (Simulated)</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px]">
                      READY
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: WEBHOOK SIMULATOR */}
          {activeTab === 'webhooks' && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-[#11131a] border border-[#1a1d27] flex items-center justify-between">
                <div>
                  <div className="font-medium text-zinc-200">Ingestion Webhook URL</div>
                  <code className="text-[11px] text-amber-400 font-mono">
                    POST {window.location.origin}/api/webhooks/email
                  </code>
                </div>
                <button
                  onClick={() =>
                    copyToClipboard(`${window.location.origin}/api/webhooks/email`, 'key')
                  }
                  className="px-2.5 py-1 rounded bg-[#090a0f] border border-[#262b3a] hover:bg-[#1a1d27] text-zinc-300"
                >
                  {copiedKey ? 'Copied' : 'Copy URL'}
                </button>
              </div>

              {/* Presets */}
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-zinc-400">
                  Quick Load Real-World Payload Scenario:
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_WEBHOOKS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => setWebhookJson(JSON.stringify(preset.payload, null, 2))}
                      className="px-2.5 py-1.5 rounded-lg bg-[#11131a] hover:bg-[#1a1d27] border border-[#1a1d27] text-zinc-300 text-[11px] transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* JSON Editor */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Raw Ingestion Webhook JSON
                </label>
                <textarea
                  rows={8}
                  value={webhookJson}
                  onChange={(e) => setWebhookJson(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#090a0f] border border-[#1a1d27] focus:border-amber-400 text-zinc-200 font-mono text-[11px] outline-none transition-colors"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="text-[11px] text-zinc-500">
                  Ingestion will invoke Gemini 2.5 Flash for category classification and summary generation.
                </div>
                <button
                  onClick={handleSimulateWebhook}
                  disabled={simulating}
                  className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold transition-colors disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${simulating ? 'animate-bounce' : ''}`} />
                  <span>{simulating ? 'Ingesting with Gemini...' : 'Dispatch Webhook'}</span>
                </button>
              </div>

              {/* Simulation Result */}
              {simulationResult && (
                <div className="p-3 rounded-lg bg-[#090a0f] border border-[#1a1d27] font-mono text-[11px] space-y-1">
                  <div className="text-zinc-400 font-sans font-medium flex justify-between">
                    <span>Response from Webhook Handler:</span>
                    <span className={simulationResult.success ? 'text-emerald-400' : 'text-rose-400'}>
                      {simulationResult.success ? '201 Created' : 'Error'}
                    </span>
                  </div>
                  <pre className="text-zinc-300 overflow-x-auto text-[10px]">
                    {JSON.stringify(simulationResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
