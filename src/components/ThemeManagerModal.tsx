import React from 'react';
import { X, Check, Palette, Sparkles, Shield, Monitor } from 'lucide-react';

export type ThemeId = 'obsidian' | 'midnight' | 'navy' | 'matrix' | 'crimson';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  category: string;
  previewBg: string;
  previewCard: string;
  previewBorder: string;
  accentColor: string;
  accentText: string;
  accentBadge: string;
  swatches: string[];
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'obsidian',
    name: 'Obsidian NOC',
    tagline: 'Default dark graphite with warm amber & cyber cyan accents',
    category: 'NOC Command',
    previewBg: '#090a0f',
    previewCard: '#11131a',
    previewBorder: '#1a1d27',
    accentColor: '#f59e0b',
    accentText: 'text-amber-400',
    accentBadge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    swatches: ['#090a0f', '#11131a', '#f59e0b', '#06b6d4'],
  },
  {
    id: 'midnight',
    name: 'Midnight Cyber',
    tagline: 'Deep indigo with electric violet & laser cyan highlights',
    category: 'Cyberpunk',
    previewBg: '#080714',
    previewCard: '#100e26',
    previewBorder: '#231e4d',
    accentColor: '#a855f7',
    accentText: 'text-purple-400',
    accentBadge: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    swatches: ['#080714', '#100e26', '#a855f7', '#38bdf8'],
  },
  {
    id: 'navy',
    name: 'Enterprise Slate',
    tagline: 'Oceanic navy blue with crisp sky-blue and emerald telemetry',
    category: 'Corporate SLA',
    previewBg: '#050b14',
    previewCard: '#0d1d3d',
    previewBorder: '#1a325e',
    accentColor: '#38bdf8',
    accentText: 'text-sky-400',
    accentBadge: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    swatches: ['#050b14', '#0d1d3d', '#38bdf8', '#10b981'],
  },
  {
    id: 'matrix',
    name: 'Stealth Matrix',
    tagline: 'Pure OLED black with high-efficiency terminal emerald glow',
    category: 'Minimalist Terminal',
    previewBg: '#030805',
    previewCard: '#0c2016',
    previewBorder: '#183d2c',
    accentColor: '#10b981',
    accentText: 'text-emerald-400',
    accentBadge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    swatches: ['#030805', '#0c2016', '#10b981', '#34d399'],
  },
  {
    id: 'crimson',
    name: 'Red Team Alert',
    tagline: 'High-alert deep burgundy with vivid crimson and gold accents',
    category: 'Incident Response',
    previewBg: '#0c0608',
    previewCard: '#221219',
    previewBorder: '#3f1e2c',
    accentColor: '#f43f5e',
    accentText: 'text-rose-400',
    accentBadge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    swatches: ['#0c0608', '#221219', '#f43f5e', '#fbbf24'],
  },
];

interface ThemeManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
}

export const ThemeManagerModal: React.FC<ThemeManagerModalProps> = ({
  isOpen,
  onClose,
  currentTheme,
  onSelectTheme,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in select-none">
      <div className="w-full max-w-2xl bg-[#0c0e14] border border-[#1e2330] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-[#1a1d27] bg-[#11131a] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-sm">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wider font-mono flex items-center gap-2">
                <span>Theme Manager</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                  WORKSPACE STYLING
                </span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Customize AetherMail aesthetic, spacing density, and color palette
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

        {/* Modal Body: Theme Cards Grid */}
        <div className="p-5 overflow-y-auto space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {THEMES.map((th) => {
              const isActive = currentTheme === th.id;
              return (
                <div
                  key={th.id}
                  onClick={() => onSelectTheme(th.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer relative group flex flex-col justify-between ${
                    isActive
                      ? 'border-amber-400/80 bg-[#161a26] shadow-lg ring-1 ring-amber-400/30'
                      : 'border-[#1a1d27] bg-[#10121a] hover:border-[#2d3448] hover:bg-[#141722]'
                  }`}
                >
                  {/* Top: Name & Tag */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-xs text-zinc-100 truncate">
                          {th.name}
                        </span>
                        <span className={`text-[9px] font-mono uppercase px-1.5 py-0.2 rounded border ${th.accentBadge}`}>
                          {th.category}
                        </span>
                      </div>
                      {isActive && (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-600/50">
                          <Check className="w-3 h-3" />
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">
                      {th.tagline}
                    </p>
                  </div>

                  {/* Swatches preview pill */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#1e2330]">
                    <div className="flex items-center space-x-1.5">
                      {th.swatches.map((color, idx) => (
                        <div
                          key={idx}
                          className="w-4 h-4 rounded-full border border-black/40 shadow-sm"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors">
                      {isActive ? 'Current Style' : 'Click to apply'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Performance & Memory Optimization Info */}
          <div className="p-3.5 rounded-xl bg-[#090b10] border border-[#1a1d27] flex items-center justify-between text-xs font-mono text-zinc-400">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>Theme changes persist across sessions &amp; apply instantaneously without reload.</span>
            </div>
            <span className="text-emerald-400 font-bold text-[10px]">Zero GPU Overhead</span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#1a1d27] bg-[#090a0f] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs font-mono transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
