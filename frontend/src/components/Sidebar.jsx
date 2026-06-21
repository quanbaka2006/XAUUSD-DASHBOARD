import React from 'react';
import { 
  TrendingUp, 
  Activity, 
  Zap, 
  ShieldAlert, 
  DollarSign, 
  Lock, 
  Star,
  Settings,
  Menu,
  LayoutDashboard,
  Calendar,
  HelpCircle,
  Sparkles,
  Coins
} from 'lucide-react';
import { useTradeStore } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';
import logoImg from '../assets/logo.png';

export function Sidebar() {
  const { t } = useTranslation();
  const { isSidebarHovered, setIsSidebarHovered, currentView, setCurrentView, user } = useTradeStore();

  return (
    <aside
      onMouseEnter={() => setIsSidebarHovered(true)}
      onMouseLeave={() => setIsSidebarHovered(false)}
      className={`hidden md:flex fixed top-0 left-0 h-full z-50 flex-col justify-between py-6 transition-all duration-300 ease-in-out ${isSidebarHovered ? 'w-56 px-4' : 'w-16 px-2'} panel-surface border-r border-white/[0.06]`}
    >
      {/* Top: Logo & Branding */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2 overflow-hidden px-1 text-left">
          <div className={`transition-all duration-300 flex items-center ${isSidebarHovered ? 'opacity-100 w-5 mr-1.5' : 'opacity-0 w-0 pointer-events-none'}`}>
            <Menu className="h-5 w-5 text-slate-400 min-w-[20px]" />
          </div>
          
          <img 
            src={logoImg} 
            alt="Alpha Gold Logo" 
            className="h-10 w-10 min-w-[40px] object-contain filter drop-shadow-[0_0_10px_rgba(245,158,11,0.3)]" 
          />

          <div className={`flex flex-col transition-all duration-300 whitespace-nowrap ${isSidebarHovered ? 'opacity-100' : 'opacity-0 w-0 pointer-events-none'}`}>
            <span className="text-xs font-black text-amber-500 tracking-wider">ALPHA GOLD</span>
            <span className="text-[11px] text-slate-400 font-bold tracking-[0.05em] uppercase mt-0.5">MULTI-ASSET CONSOLE</span>
          </div>
        </div>

        {/* Menu Items */}
        <nav className="flex flex-col gap-1 overflow-y-auto max-h-[55vh] pr-1">
          {/* Dashboard View Tab */}
          <div className="relative">
            <button 
              onClick={() => setCurrentView('dashboard')}
              className={`w-full flex items-center gap-4 py-2.5 px-3 rounded-xl transition-all cursor-pointer ${
                currentView === 'dashboard'
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40 text-xs font-bold border border-transparent'
              }`}
            >
              <LayoutDashboard className={`h-5 w-5 min-w-[20px] ${currentView === 'dashboard' ? 'text-amber-500' : 'text-slate-400'}`} />
              <span className={`transition-all duration-300 whitespace-nowrap text-left ${isSidebarHovered ? 'opacity-100' : 'opacity-0 w-0 pointer-events-none'}`}>{t('dashboard')}</span>
            </button>
            {currentView === 'dashboard' && (
              <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-amber-500 rounded-r" />
            )}
          </div>

          {/* Capital Management View Tab */}
          <div className="relative">
            <button 
              onClick={() => setCurrentView('capital')}
              className={`w-full flex items-center justify-between py-2.5 px-3 rounded-xl transition-all cursor-pointer ${
                currentView === 'capital'
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40 text-xs font-bold border border-transparent'
              }`}
            >
              <div className="flex items-center gap-4">
                <Coins className={`h-5 w-5 min-w-[20px] ${currentView === 'capital' ? 'text-amber-500' : 'text-slate-400'}`} />
                <span className={`transition-all duration-300 whitespace-nowrap ${isSidebarHovered ? 'opacity-100' : 'opacity-0 w-0 pointer-events-none'}`}>{t('capitalManagement')}</span>
              </div>
              <span className={`px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded text-[11px] font-black tracking-widest ${isSidebarHovered ? 'opacity-100' : 'opacity-0 w-0 pointer-events-none'}`}>SAFE</span>
            </button>
            {currentView === 'capital' && (
              <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-amber-500 rounded-r" />
            )}
          </div>

          {/* Auto Trade View Tab */}
          <div className="relative">
            <button 
              onClick={() => setCurrentView('autotrade')}
              className={`w-full flex items-center gap-4 py-2.5 px-3 rounded-xl transition-all cursor-pointer ${
                currentView === 'autotrade'
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40 text-xs font-bold border border-transparent'
              }`}
            >
              <Zap className={`h-5 w-5 min-w-[20px] ${currentView === 'autotrade' ? 'text-amber-500' : 'text-slate-400'}`} />
              <span className={`transition-all duration-300 whitespace-nowrap text-left ${isSidebarHovered ? 'opacity-100' : 'opacity-0 w-0 pointer-events-none'}`}>{t('autoTrade')}</span>
            </button>
            {currentView === 'autotrade' && (
              <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-amber-500 rounded-r" />
            )}
          </div>

          {/* Economic Calendar Tab */}
          <div className="relative">
            <button 
              onClick={() => setCurrentView('calendar')}
              className={`w-full flex items-center gap-4 py-2.5 px-3 rounded-xl transition-all cursor-pointer ${
                currentView === 'calendar'
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-black'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40 text-xs font-bold border border-transparent'
              }`}
            >
              <Calendar className={`h-5 w-5 min-w-[20px] ${currentView === 'calendar' ? 'text-amber-500' : 'text-slate-400'}`} />
              <span className={`transition-all duration-300 whitespace-nowrap text-left ${isSidebarHovered ? 'opacity-100' : 'opacity-0 w-0 pointer-events-none'}`}>{t('economicCalendar')}</span>
            </button>
            {currentView === 'calendar' && (
              <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-amber-500 rounded-r" />
            )}
          </div>
        </nav>
      </div>

      {/* Bottom: VIP Card & User Profile */}
      <div className="flex flex-col gap-4">
        {/* VIP Upgrade Card */}
        <div className={`panel-primary p-4 rounded-2xl text-left transition-all duration-300 ${isSidebarHovered ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-90 pointer-events-none h-0 p-0 overflow-hidden border-none'}`}>
          <div className="flex items-center gap-1.5">
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
            <span className="text-xs font-black text-amber-500 uppercase tracking-widest">{t('upgradeTo')}</span>
          </div>
          <div className="text-sm font-black text-white mt-0.5">{t('vipPro')}</div>
          <ul className="space-y-1.5 my-3 text-xs font-bold text-slate-300">
            <li className="flex items-center gap-1.5 text-left">
              <span className="text-amber-500">✓</span> {t('accessPremiumSignals')}
            </li>
            <li className="flex items-center gap-1.5 text-left">
              <span className="text-amber-500">✓</span> {t('aiSmartMoney')}
            </li>
            <li className="flex items-center gap-1.5 text-left">
              <span className="text-amber-500">✓</span> {t('advancedBacktesting')}
            </li>
            <li className="flex items-center gap-1.5 text-left">
              <span className="text-amber-500">✓</span> {t('mtfAnalysis')}
            </li>
          </ul>
          <button className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-black py-2 rounded-xl text-xs transition-all tracking-wider shadow-[0_0_15px_rgba(234,179,8,0.2)]">
            {t('upgradeNow')}
          </button>
        </div>

        {/* User Profile Widget */}
        <div className="flex items-center gap-3 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div className="h-8 w-8 min-w-[32px] rounded-full bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-xs font-black text-amber-500 font-mono">
            {user?.name ? user.name.slice(0, 2).toUpperCase() : 'US'}
          </div>
          <div className={`flex flex-col text-left transition-all duration-300 whitespace-nowrap ${isSidebarHovered ? 'opacity-100' : 'opacity-0 w-0 pointer-events-none'}`}>
            <span className="text-xs font-black text-white leading-none">{user?.name || 'Trader'}</span>
            <span className="text-xs text-amber-500/80 font-bold mt-1.5 uppercase">{t('premiumMember')}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
