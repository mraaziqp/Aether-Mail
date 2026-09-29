import React from 'react';
import type { EmailCategory } from '../types.ts';

export const CATEGORY_META: Record<EmailCategory, { label: string; dot: string; badge: string }> = {
  urgent:     { label: 'Urgent',     dot: 'bg-rose-400',    badge: 'text-rose-300 bg-rose-500/10 border-rose-500/25' },
  financial:  { label: 'Financial',  dot: 'bg-emerald-400', badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' },
  work:       { label: 'Work',       dot: 'bg-sky-400',     badge: 'text-sky-300 bg-sky-500/10 border-sky-500/25' },
  personal:   { label: 'Personal',   dot: 'bg-violet-400',  badge: 'text-violet-300 bg-violet-500/10 border-violet-500/25' },
  newsletter: { label: 'Newsletter', dot: 'bg-amber-400',   badge: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  automated:  { label: 'Automated',  dot: 'bg-zinc-400',    badge: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/25' },
  spam:       { label: 'Spam',       dot: 'bg-orange-500',  badge: 'text-orange-300 bg-orange-500/10 border-orange-500/25' },
};

/** Kept for components that still import it from the old EmailList. */
export const getCategoryBadgeStyle = (category: string) =>
  `border ${CATEGORY_META[category as EmailCategory]?.badge ?? CATEGORY_META.automated.badge}`;

export function CategoryBadge({ category }: { category: string }) {
  const meta = CATEGORY_META[category as EmailCategory] ?? CATEGORY_META.automated;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-mono uppercase tracking-wider ${meta.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/** "Jane Doe <jane@x.com>" → { name: "Jane Doe", address: "jane@x.com" } */
export function parseSender(raw: string): { name: string; address: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2], address: m[2].trim() };
  return { name: raw.split('@')[0] || raw, address: raw.trim() };
}

const AVATAR_TONES = [
  'from-cyan-500/30 to-sky-600/20 text-cyan-200',
  'from-violet-500/30 to-fuchsia-600/20 text-violet-200',
  'from-emerald-500/30 to-teal-600/20 text-emerald-200',
  'from-amber-500/30 to-orange-600/20 text-amber-200',
  'from-rose-500/30 to-pink-600/20 text-rose-200',
  'from-indigo-500/30 to-blue-600/20 text-indigo-200',
];

export function Avatar({ label, size = 40 }: { label: string; size?: number }) {
  const clean = label.replace(/[^A-Za-z0-9 ]/g, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <div
      className={`flex-shrink-0 rounded-xl bg-gradient-to-br border border-white/5 flex items-center justify-center font-semibold ${AVATAR_TONES[hash % AVATAR_TONES.length]}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

export function relativeTime(iso?: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(t).toLocaleDateString();
}

export function listTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (diffDays < 6) return d.toLocaleDateString([], { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' });
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-[#262b3a] bg-[#11131a] text-[10px] font-mono text-zinc-400">{children}</kbd>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  width = 'max-w-2xl',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  width?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in" onMouseDown={onClose}>
      <div
        className={`w-full ${width} max-h-[92vh] flex flex-col rounded-2xl border border-[#1f2331] bg-[#0d0f15] shadow-[0_30px_120px_-20px_rgba(0,0,0,0.8)] overflow-hidden animate-pop-in`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-[#1a1d27]">
          <div className="flex items-start gap-3.5">
            {icon && <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 flex items-center justify-center">{icon}</div>}
            <div>
              <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
              {subtitle && <p className="text-sm text-zinc-400 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#1a1d27]" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-[#1a1d27] bg-[#0b0d12]">{footer}</div>}
      </div>
    </div>
  );
}

export const inputClass =
  'w-full rounded-xl bg-[#0a0c11] border border-[#1f2331] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/15 transition';

export const buttonPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-950 bg-gradient-to-r from-cyan-400 to-sky-400 hover:from-cyan-300 hover:to-sky-300 shadow-[0_8px_30px_-8px_rgba(34,211,238,0.6)] disabled:opacity-50 disabled:cursor-not-allowed transition';

export const buttonGhost =
  'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-zinc-300 border border-[#1f2331] bg-[#11131a] hover:bg-[#161a24] hover:text-zinc-100 disabled:opacity-50 transition';

export const iconButton =
  'inline-flex items-center justify-center w-9 h-9 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-[#161a24] border border-transparent hover:border-[#1f2331] disabled:opacity-40 transition';
