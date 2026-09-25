import React, { useState } from 'react';
import { 
  X, 
  User, 
  Shield, 
  Mail, 
  Building2, 
  Key, 
  LogOut, 
  Check, 
  Save, 
  Globe, 
  Clock,
  Sparkles
} from 'lucide-react';
import type { Account } from '../types.ts';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  onLogout: () => void;
  currentUser?: {
    username: string;
    displayName: string;
    role: string;
    primaryEmail: string;
  };
  onUpdateProfile?: (updated: { displayName: string; primaryEmail: string }) => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onLogout,
  currentUser = {
    username: 'mraaziqp',
    displayName: 'Mohamed Raaziq',
    role: 'Super Admin',
    primaryEmail: 'mraaziqp@gmail.com',
  },
  onUpdateProfile,
}) => {
  const [displayName, setDisplayName] = useState(currentUser.displayName || 'Mohamed Raaziq');
  const [primaryEmail, setPrimaryEmail] = useState(currentUser.primaryEmail || 'mraaziqp@gmail.com');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (newPassword && newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }

    if (onUpdateProfile) {
      onUpdateProfile({ displayName, primaryEmail });
    }

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in font-sans select-none">
      <div className="w-full max-w-xl bg-[#0c0e14] border border-[#1e2330] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header Bar */}
        <div className="p-5 border-b border-[#1a1d27] bg-[#11131a] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-black font-extrabold text-sm shadow-md">
              {displayName.charAt(0) || 'M'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-zinc-100 font-mono">
                  {currentUser.username}
                </h2>
                <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-bold">
                  {currentUser.role}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 font-mono">
                Administrator Profile &amp; Mailbox Orchestration
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1d27] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 text-xs text-zinc-200">
          {savedSuccess && (
            <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Profile configurations saved successfully!</span>
            </div>
          )}

          {/* 1. Identity & Details Form */}
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
                  Admin Username
                </label>
                <input
                  type="text"
                  value={currentUser.username}
                  disabled
                  className="w-full px-3 py-2 rounded-xl bg-[#11131a] border border-[#1e2330] text-zinc-400 font-mono text-xs cursor-not-allowed opacity-80"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#11131a] border border-[#1e2330] focus:border-amber-500/60 text-zinc-100 font-mono text-xs outline-none"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
                  Primary Routing Email
                </label>
                <input
                  type="email"
                  value={primaryEmail}
                  onChange={(e) => setPrimaryEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#11131a] border border-[#1e2330] focus:border-amber-500/60 text-zinc-100 font-mono text-xs outline-none"
                />
              </div>
            </div>

            {/* 2. Connected Mailbox Profiles */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Managed Mail Profiles ({accounts.length})</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-500">Live Active</span>
              </div>

              <div className="space-y-1.5 max-h-36 overflow-y-auto rounded-xl bg-[#11131a] p-2 border border-[#1a1d27]">
                {accounts.map((acc) => {
                  const isBiz = acc.email_address.includes('arpcloudsolutions.co.za');
                  const isGmail = acc.email_address.includes('@gmail.com');
                  return (
                    <div
                      key={acc.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-[#090a0f] border border-[#1a1d27] text-xs font-mono"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-base">{isBiz ? '🏢' : isGmail ? '📬' : '🤖'}</span>
                        <span className="text-zinc-200 truncate">{acc.email_address}</span>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                        {isBiz ? 'BUSINESS' : isGmail ? 'GMAIL IMAP' : 'AGENT'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-mono font-bold text-xs transition-colors flex items-center gap-1.5 shadow-md"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Profile Changes</span>
              </button>
            </div>
          </form>

          {/* 3. Security & Termination Section */}
          <div className="pt-4 border-t border-[#1a1d27] flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-zinc-300">Terminal Authentication</div>
              <div className="text-[11px] text-zinc-500 font-mono">
                Active credentials for user: <strong className="text-amber-300">mraaziqp</strong>
              </div>
            </div>

            <button
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-500/40 font-mono font-bold text-xs transition-colors flex items-center gap-1.5 shadow-sm"
              title="Terminate session and return to login screen"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
