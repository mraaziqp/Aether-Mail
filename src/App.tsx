import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { DashboardHeader } from './components/DashboardHeader.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { EmailList } from './components/EmailList.tsx';
import { EmailDetail } from './components/EmailDetail.tsx';
import { DeveloperConsole } from './components/DeveloperConsole.tsx';
import { WebhookModal } from './components/WebhookModal.tsx';
import { NewAccountModal } from './components/NewAccountModal.tsx';
import { DeveloperModal } from './components/DeveloperModal.tsx';
import { ComposeModal } from './components/ComposeModal.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { ProfileModal } from './components/ProfileModal.tsx';
import type { Account, EmailItem, ParsedSearchIntent, BatchActionType } from './types.ts';

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [alertFilterOnly, setAlertFilterOnly] = useState<boolean>(false);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // View Switcher: Incident Feed vs Developer & Autonomous Agents Console
  const [currentView, setCurrentView] = useState<'feed' | 'developer'>('feed');

  // Sidebar Collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  // Mobile Detail View state
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState<boolean>(false);

  // Natural Language Smart Search State
  const [activeSearchQuery, setActiveSearchQuery] = useState<string>('');
  const [isSmartSearching, setIsSmartSearching] = useState<boolean>(false);
  const [parsedIntent, setParsedIntent] = useState<ParsedSearchIntent | null>(null);

  // Batch Selection State
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set());
  const [isBatchLoading, setIsBatchLoading] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [isGeneratingReply, setIsGeneratingReply] = useState<boolean>(false);
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState<boolean>(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);
  const [isDeveloperModalOpen, setIsDeveloperModalOpen] = useState<boolean>(false);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState<boolean>(false);

  // User Authentication & Profile State
  const [currentUser, setCurrentUser] = useState<{
    username: string;
    displayName: string;
    role: string;
    primaryEmail: string;
  } | null>(() => {
    try {
      const saved = localStorage.getItem('aethermail_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);

  const handleLoginSuccess = (user: {
    username: string;
    displayName: string;
    role: string;
    primaryEmail: string;
  }) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('aethermail_auth_token');
    localStorage.removeItem('aethermail_user');
    setCurrentUser(null);
    setIsProfileModalOpen(false);
  };

  // Jarvis Real-Time Sentry & Notification State
  const initialSyncDoneRef = useRef(false);
  const knownEmailIdsRef = useRef<Set<string>>(new Set());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );
  const [jarvisBanner, setJarvisBanner] = useState<{
    id: string;
    subject: string;
    summary: string;
    isPayFast: boolean;
  } | null>(null);

  // High-tech synthesized Jarvis alert chime
  const playJarvisChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, now + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.3); // D6

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.18);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.4);
    } catch (err) {
      console.warn('Audio chime unsupported or blocked:', err);
    }
  }, []);

  // Request or toggle notification permission with live test
  const handleToggleOrRequestNotifications = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      alert('Desktop notifications are not supported on this browser.');
      return;
    }

    playJarvisChime();

    if (Notification.permission === 'granted') {
      new Notification('🤖 Jarvis Alerts Active', {
        body: 'Real-time incident & business mail monitoring is armed and operational.',
        icon: '/favicon.ico',
      });
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      setNotificationPermission(perm);
      if (perm === 'granted') {
        new Notification('🤖 Jarvis Alerts Enabled', {
          body: 'You will now receive instant desktop alerts for urgent emails and PayFast verifications.',
          icon: '/favicon.ico',
        });
      }
    } catch (err) {
      console.warn('Permission request error:', err);
    }
  }, [playJarvisChime]);

  // Fetch accounts
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
      }
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  }, []);

  // Fetch emails with active filters (supports silent background fetch)
  const fetchEmails = useCallback(
    async (silent: boolean = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (selectedAccountId !== 'all') params.append('accountId', selectedAccountId);
        if (selectedCategory !== 'all') params.append('category', selectedCategory);
        if (alertFilterOnly) params.append('alertOnly', 'true');
        if (searchTerm.trim()) params.append('search', searchTerm.trim());

        const res = await fetch(`/api/emails?${params.toString()}`);
        if (res.ok) {
          const data: EmailItem[] = await res.json();
          setEmails(data);

          // Detect new arrivals for Jarvis alerting
          if (initialSyncDoneRef.current) {
            const newUrgent = data.filter((e) => {
              return (
                !knownEmailIdsRef.current.has(e.id) &&
                (e.requires_alert ||
                  e.category === 'financial' ||
                  e.category === 'urgent' ||
                  e.subject.toLowerCase().includes('payfast') ||
                  e.account_email?.includes('arpcloudsolutions.co.za'))
              );
            });

            if (newUrgent.length > 0) {
              const newest = newUrgent[0];
              playJarvisChime();

              const isPayFast =
                newest.subject.toLowerCase().includes('payfast') ||
                newest.ai_summary.toLowerCase().includes('payfast');

              setJarvisBanner({
                id: newest.id,
                subject: newest.subject,
                summary: newest.ai_summary,
                isPayFast,
              });

              if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted'
              ) {
                new Notification(`🤖 Jarvis Alert: ${newest.subject}`, {
                  body: newest.ai_summary || newest.body_snippet,
                  icon: '/favicon.ico',
                  tag: newest.id,
                });
              }
            }
          }

          // Populate known IDs
          data.forEach((e) => knownEmailIdsRef.current.add(e.id));
          initialSyncDoneRef.current = true;

          // Auto-select first email if none selected or selected is gone
          if (data.length > 0) {
            setSelectedEmailId((prev) => {
              if (!prev || !data.some((e) => e.id === prev)) {
                return data[0].id;
              }
              return prev;
            });
          } else {
            setSelectedEmailId(null);
          }
        }
      } catch (err) {
        console.error('Failed to load emails:', err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedAccountId, selectedCategory, alertFilterOnly, searchTerm, playJarvisChime]
  );

  // Initial load and periodic 20s real-time auto-sync + focus trigger
  useEffect(() => {
    fetchAccounts();
    fetchEmails(false);

    // 20-second background sync interval
    const interval = setInterval(async () => {
      try {
        await fetch('/api/sync/all');
      } catch {}
      await fetchEmails(true);
    }, 20000);

    // Tab focus listener for instant updates
    const handleFocus = async () => {
      try {
        await fetch('/api/sync/all');
      } catch {}
      await fetchEmails(true);
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchAccounts, fetchEmails]);

  // Handle seed action
  const handleSeedData = async () => {
    try {
      setLoading(true);
      await fetch('/api/seed', { method: 'POST' });
      await fetchAccounts();
      await fetchEmails();
    } catch (err) {
      console.error('Seed error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Unified multi-account background sync + refetch
  const handleSyncAll = async () => {
    try {
      setLoading(true);
      await fetch('/api/sync/all', { method: 'POST' });
    } catch (err) {
      console.warn('Sync all trigger error:', err);
    } finally {
      await fetchAccounts();
      await fetchEmails();
    }
  };

  // Toggle email read status
  const handleToggleRead = async (email: EmailItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const newStatus = !email.is_read;
    setEmails((prev) =>
      prev.map((item) => (item.id === email.id ? { ...item, is_read: newStatus } : item))
    );

    try {
      await fetch(`/api/emails/${email.id}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: newStatus }),
      });
    } catch (err) {
      console.error('Error toggling read status:', err);
    }
  };

  // Delete email
  const handleDeleteEmail = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEmails((prev) => prev.filter((item) => item.id !== id));
    setSelectedEmailIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (selectedEmailId === id) {
      setSelectedEmailId(null);
    }
    try {
      await fetch(`/api/emails/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Error deleting email:', err);
    }
  };

  // Batch action handler (mark read, mark unread, delete)
  const handleBatchAction = async (action: BatchActionType) => {
    const ids = Array.from(selectedEmailIds);
    if (ids.length === 0) return;

    try {
      setIsBatchLoading(true);
      const res = await fetch('/api/emails/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailIds: ids, action }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Batch operation failed');
      }

      // Optimistically update local state
      if (action === 'mark_read') {
        setEmails((prev) =>
          prev.map((e) => (ids.includes(e.id) ? { ...e, is_read: true } : e))
        );
      } else if (action === 'mark_unread') {
        setEmails((prev) =>
          prev.map((e) => (ids.includes(e.id) ? { ...e, is_read: false } : e))
        );
      } else if (action === 'delete') {
        setEmails((prev) => prev.filter((e) => !ids.includes(e.id)));
        if (selectedEmailId && ids.includes(selectedEmailId)) {
          setSelectedEmailId(null);
        }
      }

      setSelectedEmailIds(new Set());
    } catch (err) {
      console.error('Batch action failed:', err);
    } finally {
      setIsBatchLoading(false);
    }
  };

  // Toggle selection for an email
  const handleToggleSelectEmail = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedEmailIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all currently visible emails
  const handleSelectAll = () => {
    setSelectedEmailIds(new Set(emails.map((e) => e.id)));
  };

  // Clear all selections
  const handleClearSelection = () => {
    setSelectedEmailIds(new Set());
  };

  // Natural Language Smart Search
  const handleExecuteSmartSearch = async (query: string) => {
    if (!query.trim()) return;

    try {
      setIsSmartSearching(true);
      const res = await fetch('/api/smart-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          accountId: selectedAccountId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setEmails(data.emails);
        setParsedIntent(data.parsedIntent || null);

        if (data.emails.length > 0) {
          setSelectedEmailId(data.emails[0].id);
        } else {
          setSelectedEmailId(null);
        }
      }
    } catch (err) {
      console.error('Smart search failed:', err);
    } finally {
      setIsSmartSearching(false);
    }
  };

  // Reset Smart Search
  const handleClearSmartSearch = () => {
    setParsedIntent(null);
    setActiveSearchQuery('');
    fetchEmails();
  };

  // Generate Smart Reply (calling Server Action API)
  const handleGenerateSmartReply = async (params: {
    emailId: string;
    tone: 'professional' | 'concise' | 'friendly' | 'firm';
    instructions?: string;
  }): Promise<string | null> => {
    try {
      setIsGeneratingReply(true);
      const res = await fetch('/api/smart-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate smart reply');
      }

      return data.draftReply || null;
    } catch (err) {
      console.error('Smart reply failed:', err);
      return null;
    } finally {
      setIsGeneratingReply(false);
    }
  };

  const selectedEmail = emails.find((e) => e.id === selectedEmailId) || null;

  const getCategoryTitle = () => {
    if (parsedIntent) return 'Smart Search Results';
    if (alertFilterOnly) return 'Action Required';
    if (selectedCategory === 'all') return 'All Messages';
    if (selectedCategory === 'urgent') return 'Urgent Action';
    if (selectedCategory === 'work') return 'Work & Projects';
    if (selectedCategory === 'financial') return 'Financial';
    if (selectedCategory === 'personal') return 'Personal';
    if (selectedCategory === 'newsletter') return 'Newsletters';
    if (selectedCategory === 'automated') return 'Automated & System';
    return selectedCategory;
  };

  const alertCount = emails.filter((e) => e.requires_alert && !e.is_read).length;

  if (!currentUser) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090a0f] text-zinc-100 font-sans overflow-hidden antialiased select-none">
      {/* 0. Unified Top Dashboard Header with Gemini Smart Search */}
      <DashboardHeader
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onExecuteSmartSearch={handleExecuteSmartSearch}
        isSmartSearching={isSmartSearching}
        parsedIntent={parsedIntent}
        onClearSmartSearch={handleClearSmartSearch}
        onOpenWebhookModal={() => setIsWebhookModalOpen(true)}
        onOpenDeveloperModal={() => setIsDeveloperModalOpen(true)}
        onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        activeSearchQuery={activeSearchQuery}
        setActiveSearchQuery={setActiveSearchQuery}
        currentView={currentView}
        onSelectView={setCurrentView}
        alertCount={alertCount}
        onRefresh={handleSyncAll}
        loading={loading}
        notificationPermission={notificationPermission}
        onRequestNotificationPermission={handleToggleOrRequestNotifications}
        onLogout={handleLogout}
        onOpenProfileModal={() => setIsProfileModalOpen(true)}
      />

      {/* Jarvis Urgent Alert Banner */}
      {jarvisBanner && (
        <div className="bg-gradient-to-r from-amber-950/80 via-[#131620] to-rose-950/60 border-b border-amber-500/40 px-4 py-2 flex items-center justify-between gap-3 text-xs animate-fade-in shadow-lg z-30">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
            <span className="font-mono font-bold text-amber-400 uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 flex-shrink-0">
              🤖 Jarvis Alert
            </span>
            <span className="font-semibold text-zinc-100 truncate">
              {jarvisBanner.subject}
            </span>
            <span className="text-zinc-400 hidden md:inline truncate text-[11px]">
              — {jarvisBanner.summary}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => {
                setSelectedEmailId(jarvisBanner.id);
                setJarvisBanner(null);
              }}
              className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-mono font-bold text-[11px] transition-colors"
            >
              View Email
            </button>
            {jarvisBanner.isPayFast && (
              <a
                href="https://www.payfast.co.za/user/verify?email=info@arpcloudsolutions.co.za&token=pf_sec_789410294"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-block px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-[11px] transition-colors shadow-sm"
              >
                Verify PayFast PIN (849201)
              </a>
            )}
            <button
              onClick={() => setJarvisBanner(null)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1d27]"
              title="Dismiss alert"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Work Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* 1. Sidebar */}
        <Sidebar
          accounts={accounts}
          emails={emails}
          selectedAccountId={selectedAccountId}
          selectedCategory={selectedCategory}
          alertFilterOnly={alertFilterOnly}
          onSelectAccount={(accId) => {
            setSelectedAccountId(accId);
            if (parsedIntent) handleClearSmartSearch();
            if (currentView !== 'feed') setCurrentView('feed');
          }}
          onSelectCategory={(catId) => {
            setSelectedCategory(catId);
            if (parsedIntent) handleClearSmartSearch();
            if (currentView !== 'feed') setCurrentView('feed');
          }}
          onToggleAlertFilter={() => {
            setAlertFilterOnly((prev) => !prev);
            if (parsedIntent) handleClearSmartSearch();
            if (currentView !== 'feed') setCurrentView('feed');
          }}
          onOpenComposeModal={() => setIsComposeModalOpen(true)}
          onOpenWebhookModal={() => setIsWebhookModalOpen(true)}
          onOpenAccountModal={() => setIsAccountModalOpen(true)}
          onOpenDeveloperModal={() => setIsDeveloperModalOpen(true)}
          onRefresh={handleSyncAll}
          onSeedData={handleSeedData}
          loading={loading}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          currentView={currentView}
          onSelectView={setCurrentView}
          onLogout={handleLogout}
          onOpenProfileModal={() => setIsProfileModalOpen(true)}
        />

        {currentView === 'developer' ? (
          /* Dedicated Developer & Autonomous Agents Command Console View */
          <DeveloperConsole
            onReturnToFeed={() => setCurrentView('feed')}
            onEmailIngested={() => {
              fetchAccounts();
              fetchEmails();
            }}
          />
        ) : (
          /* Incident Feed & Inspection Drawer Work Area */
          <div className="flex-1 flex overflow-hidden w-full">
            {/* 2. Email Feed with Batch Management */}
            <div className={`h-full flex-shrink-0 ${isMobileDetailOpen ? 'hidden md:flex' : 'flex flex-1 md:flex-none'}`}>
              <EmailList
                emails={emails}
                selectedEmailId={selectedEmailId}
                onSelectEmail={(email) => {
                  setSelectedEmailId(email.id);
                  setIsMobileDetailOpen(true);
                  if (!email.is_read) {
                    handleToggleRead(email);
                  }
                }}
                onToggleRead={handleToggleRead}
                onDeleteEmail={handleDeleteEmail}
                selectedEmailIds={selectedEmailIds}
                onToggleSelectEmail={handleToggleSelectEmail}
                onSelectAll={handleSelectAll}
                onClearSelection={handleClearSelection}
                onBatchAction={handleBatchAction}
                isBatchLoading={isBatchLoading}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                activeCategoryLabel={getCategoryTitle()}
                loading={loading}
                parsedIntent={parsedIntent}
                onClearSmartSearch={handleClearSmartSearch}
              />
            </div>

            {/* 3. Detail View with Outbound Sending Engine & Inspection Drawer */}
            <div className={`flex-1 h-full overflow-hidden ${!isMobileDetailOpen ? 'hidden md:flex' : 'flex'}`}>
              <EmailDetail
                email={selectedEmail}
                onGenerateSmartReply={handleGenerateSmartReply}
                isGeneratingReply={isGeneratingReply}
                onToggleRead={(email) => handleToggleRead(email)}
                onBack={() => setIsMobileDetailOpen(false)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Webhook Ingestion Testing Modal */}
      <WebhookModal
        isOpen={isWebhookModalOpen}
        onClose={() => setIsWebhookModalOpen(false)}
        accounts={accounts}
        onIngestSuccess={() => {
          fetchAccounts();
          fetchEmails();
        }}
      />

      {/* New Account Modal */}
      <NewAccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onAccountCreated={() => {
          fetchAccounts();
          fetchEmails();
        }}
      />

      {/* Developer & Agent Bot API Engine Modal */}
      <DeveloperModal
        isOpen={isDeveloperModalOpen}
        onClose={() => setIsDeveloperModalOpen(false)}
        onEmailIngested={() => {
          fetchAccounts();
          fetchEmails();
        }}
      />

      {/* Compose & Outbound Dispatch Modal */}
      <ComposeModal
        isOpen={isComposeModalOpen}
        onClose={() => setIsComposeModalOpen(false)}
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onEmailSent={() => {
          fetchAccounts();
          fetchEmails();
        }}
      />

      {/* Profile Management Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        accounts={accounts}
        onLogout={handleLogout}
        currentUser={currentUser || undefined}
        onUpdateProfile={(updated) => {
          if (currentUser) {
            const next = { ...currentUser, ...updated };
            setCurrentUser(next);
            localStorage.setItem('aethermail_user', JSON.stringify(next));
          }
        }}
      />
    </div>
  );
}
