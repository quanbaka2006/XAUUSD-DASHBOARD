import React from 'react';
import { TrendingUp, Zap, Sliders } from 'lucide-react';
import { useTranslation } from '../utils/translations';

const TABS = [
  {
    id: 'chart',
    icon: TrendingUp,
    labelVn: 'Biểu đồ',
    labelEn: 'Chart',
  },
  {
    id: 'signal',
    icon: Zap,
    labelVn: 'Tín hiệu',
    labelEn: 'Signal',
  },
  {
    id: 'manage',
    icon: Sliders,
    labelVn: 'Quản lý',
    labelEn: 'Manage',
  },
];

export function MobileTabBar({ activeTab, onTabChange }) {
  const { language } = useTranslation();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Separator glow line */}
      <div className="h-[1px] bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />

      <div className="bg-[#040810]/96 backdrop-blur-xl flex items-stretch h-[60px]">
        {TABS.map((tab, idx) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const label = language === 'vn' ? tab.labelVn : tab.labelEn;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex-1 flex flex-col items-center justify-center gap-1
                min-h-[44px] transition-all duration-200 active:scale-95
                relative select-none
                ${isActive
                  ? 'text-amber-400'
                  : 'text-slate-500 hover:text-slate-300'
                }
              `}
              aria-label={label}
            >
              {/* Active indicator bar at top */}
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-amber-400 shadow-[0_0_8px_rgba(234,179,8,0.6)]" />
              )}

              {/* Icon with glow when active */}
              <div className={`relative transition-all duration-200 ${isActive ? 'drop-shadow-[0_0_6px_rgba(234,179,8,0.5)]' : ''}`}>
                <Icon className={`transition-all duration-200 ${isActive ? 'h-5 w-5' : 'h-[18px] w-[18px]'}`} />
              </div>

              {/* Label */}
              <span className={`text-[11px] font-black uppercase tracking-wider leading-none transition-all duration-200 ${isActive ? 'text-amber-400' : 'text-slate-600'}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
