import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  User, 
  Lock, 
  Sliders, 
  Menu, 
  X, 
  Activity, 
  Target, 
  TrendingUp, 
  LogOut,
  Coins,
  Calendar
} from 'lucide-react';
import './App.css';
import logoImg from './assets/logo.png';
import telegramQrImg from './assets/telegram_qr.png';
import { useTradeStore } from './store/useTradeStore';
import { Sidebar } from './components/Sidebar';
import { AdminPanel } from './components/AdminPanel';

import { RiskCalculator } from './components/RiskCalculator';
import { TradingChart } from './components/TradingChart';
import { CoreController } from './components/CoreController';
import { CapitalManagement } from './components/CapitalManagement';
import { EconomicCalendar } from './components/EconomicCalendar';
import { MobileTabBar } from './components/MobileTabBar';
import { useTranslation } from './utils/translations';

function App() {
  const { t, language, setLanguage } = useTranslation();
  // Mobile tab state: 'chart' | 'signal' | 'manage'
  const [activeMobileTab, setActiveMobileTab] = useState('chart');
  // Authentication & Global Store
  const {
    isLoggedIn,
    user,
    isRegistering,
    loginError,
    registerSuccessMsg,
    currentView,
    selectedSymbol,
    selectedIndicatorSystem,
    marketSpread,
    marketVolume,
    utcTime,
    isSidebarHovered,
    isMobileMenuOpen,
    setIsRegistering,
    setLoginError,
    setRegisterSuccessMsg,
    setCurrentView,
    setMarketSpread,
    setMarketVolume,
    setUtcTime,
    setIsMobileMenuOpen,
    login,
    register,
    logout,
    checkAuth,
    setAdminError,
    setAdminSuccess,
    showConfigPanel,
    toggleConfigPanel,
    connectionStatus
  } = useTradeStore();

  // Local form input states (kept local for performance & scoping)
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerName, setRegisterName] = useState('');

  // Auth local storage check for session persistence
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // URL routing synchronization & popstate listener
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      let view = 'dashboard';
      if (path === '/capital') view = 'capital';
      else if (path === '/calendar') view = 'calendar';
      else if (path === '/admin') view = 'admin';
      
      const current = useTradeStore.getState().currentView;
      if (current !== view) {
        setCurrentView(view);
      }
    };

    // Initialize routing based on URL path when app loads
    handlePopState();

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setCurrentView]);

  // Clock & market stats timer
  useEffect(() => {
    if (!isLoggedIn) return;

    const updateClock = () => {
      const date = new Date();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      setUtcTime(`${hours}:${minutes}:${seconds} UTC+7`);
    };

    updateClock();
    const clockTimer = setInterval(updateClock, 1000);

    const statsTimer = setInterval(() => {
      setMarketSpread(parseFloat((0.10 + Math.random() * 0.12).toFixed(2)));
      setMarketVolume(useTradeStore.getState().marketVolume + Math.floor(Math.random() * 15) + 3);
    }, 4000);

    return () => {
      clearInterval(clockTimer);
      clearInterval(statsTimer);
    };
  }, [isLoggedIn, setUtcTime, setMarketSpread, setMarketVolume]);

  // Auth Form Handlers
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    const success = await login(loginUsername, loginPassword);
    if (success) {
      setLoginUsername('');
      setLoginPassword('');
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    const success = await register(loginUsername, loginPassword, registerName);
    if (success) {
      setRegisterName('');
      setLoginPassword('');
    }
  };

  const handleLogout = () => {
    logout();
  };

  // Get the latest signal from Zustand, fallback to stale signal
  const currentSignal = useTradeStore(state => state.currentSignal) || {
    action: 'stale',
    entry: 0,
    sl: 0,
    tp: 0,
    confidence: 0,
    timestamp: Date.now()
  };

  // Portal render (Login / Register Screen)
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#040810] py-8 px-4 flex justify-center items-center relative overflow-hidden font-sans">
        {/* Login page aurora orbs */}
        <div className="aurora-orb-1" style={{opacity: 0.6}} />
        <div className="aurora-orb-2" style={{opacity: 0.5}} />
        <div className="aurora-orb-4" style={{opacity: 0.5}} />
        <div className="absolute inset-0 pointer-events-none opacity-[0.2] cyber-grid-overlay" />
        
        <div className="panel-primary p-8 rounded-2xl max-w-md w-full relative z-10">
          <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
          
          <div className="text-center mb-6">
            <img 
              src={logoImg} 
              alt="Alpha Gold Logo" 
              className="h-20 w-20 mx-auto mb-4 object-contain filter drop-shadow-[0_0_15px_rgba(245,158,11,0.4)]" 
            />
            <h1 className="text-2xl font-black text-white tracking-tight">ALPHA GOLD CONSOLE</h1>
            <p className="text-xs text-amber-500/80 uppercase font-black tracking-[0.25em] mt-1.5">
              {t('authRequired')}
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('username')}</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder={t('username')} 
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pl-11 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors"
                />
                <User className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-600" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('password')}</label>
              <div className="relative">
                <input 
                  type="password" 
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder={t('password')} 
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pl-11 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors"
                />
                <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-600" />
              </div>
            </div>

            {loginError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-bold leading-relaxed">
                ⚠️ {loginError}
              </div>
            )}

            <button 
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-600 text-[#040406] font-black py-3.5 px-4 rounded-xl text-xs transition-all duration-300 tracking-wider shadow-[0_0_15px_rgba(234,179,8,0.15)] flex items-center justify-center gap-2 cursor-pointer mt-4"
            >
              <span>{t('login')}</span>
            </button>

            <div className="pt-5 mt-4 border-t border-white/[0.06] text-center flex flex-col items-center gap-4 font-sans">
              <div>
                <p className="text-slate-400 text-xs font-bold leading-relaxed">
                  Chức năng đăng ký tài khoản tự do đã bị khóa.
                </p>
                <p className="text-slate-500 text-[11px] mt-0.5 font-medium leading-relaxed">
                  Vui lòng liên hệ Admin để tạo tài khoản mới hoặc gia hạn sử dụng.
                </p>
              </div>

              {/* Telegram Support Button */}
              <a
                href="https://t.me/alphagoldhelper"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white/[0.03] border border-sky-500/20 text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 hover:border-sky-500/40 rounded-xl text-xs font-black transition-all duration-300 tracking-wide uppercase cursor-pointer"
              >
                <Zap className="h-4 w-4" />
                <span>Liên hệ hỗ trợ tạo tài khoản</span>
              </a>

              {/* Telegram QR Code */}
              <div className="flex flex-col items-center p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl w-full">
                <img 
                  src={telegramQrImg} 
                  alt="Telegram Support QR" 
                  className="h-32 w-32 object-contain rounded-lg border border-white/[0.08] p-1 bg-white" 
                />
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-2.5">
                  Quét mã QR để chat với Alphagold Support
                </span>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const currentTheme = selectedIndicatorSystem;

  return (
    <div className={`min-h-screen bg-[#040810] flex font-sans overflow-x-hidden relative theme-${selectedIndicatorSystem}`}>
      {/* Sidebar Menu - Hidden on Mobile */}
      <Sidebar />

      {/* Main Content Dashboard - Responsive Padding */}
      <div 
        className={`flex-1 min-h-screen p-4 md:py-6 md:pr-6 transition-all duration-300 ease-in-out ${isSidebarHovered ? 'md:pl-[240px]' : 'md:pl-[80px]'} pl-4 flex flex-col items-center relative overflow-hidden dynamic-theme-bg`}
      >
        {/* Cybernetic Tech Grid Overlay — subtle, low opacity */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.25] cyber-grid-overlay" />

        {/* Aurora Animated Background Orbs */}
        <div className="aurora-orb-1" />
        <div className="aurora-orb-2" />
        <div className="aurora-orb-3" />
        <div className="aurora-orb-4" />
        <div className="aurora-orb-5" />

        {/* Nebula Gradient Blobs — large soft breathing gradients */}
        <div className="nebula-blob-1" />
        <div className="nebula-blob-2" />
        <div className="nebula-blob-3" />

        {/* Shooting Streaks — horizontal light trails */}
        <div className="shooting-streak shooting-streak-1" />
        <div className="shooting-streak shooting-streak-2" />
        <div className="shooting-streak shooting-streak-3" />

        {/* Firefly Luminous Particles — glowing floating dots */}
        <div className="firefly-1 absolute w-[3px] h-[3px] rounded-full pointer-events-none" style={{bottom:'12%',left:'15%',background:'radial-gradient(circle,rgba(251,191,36,0.9),rgba(251,191,36,0.3))',boxShadow:'0 0 8px rgba(251,191,36,0.6), 0 0 20px rgba(251,191,36,0.3)'}} />
        <div className="firefly-2 absolute w-[2px] h-[2px] rounded-full pointer-events-none" style={{bottom:'25%',left:'45%',background:'radial-gradient(circle,rgba(255,255,255,0.9),rgba(255,255,255,0.2))',boxShadow:'0 0 6px rgba(255,255,255,0.5), 0 0 16px rgba(255,255,255,0.2)'}} />
        <div className="firefly-3 absolute w-[4px] h-[4px] rounded-full pointer-events-none" style={{bottom:'8%',left:'70%',background:'radial-gradient(circle,rgba(168,85,247,0.9),rgba(168,85,247,0.3))',boxShadow:'0 0 10px rgba(168,85,247,0.6), 0 0 25px rgba(168,85,247,0.3)'}} />
        <div className="firefly-4 absolute w-[2.5px] h-[2.5px] rounded-full pointer-events-none" style={{bottom:'35%',left:'85%',background:'radial-gradient(circle,rgba(6,182,212,0.9),rgba(6,182,212,0.3))',boxShadow:'0 0 8px rgba(6,182,212,0.5), 0 0 18px rgba(6,182,212,0.2)'}} />
        <div className="firefly-5 absolute w-[3px] h-[3px] rounded-full pointer-events-none" style={{bottom:'50%',left:'30%',background:'radial-gradient(circle,rgba(251,191,36,0.8),rgba(251,191,36,0.2))',boxShadow:'0 0 8px rgba(251,191,36,0.5), 0 0 20px rgba(251,191,36,0.2)'}} />
        <div className="firefly-6 absolute w-[2px] h-[2px] rounded-full pointer-events-none" style={{bottom:'18%',left:'55%',background:'radial-gradient(circle,rgba(255,255,255,0.8),rgba(255,255,255,0.2))',boxShadow:'0 0 6px rgba(255,255,255,0.4), 0 0 14px rgba(255,255,255,0.15)'}} />
        <div className="firefly-7 absolute w-[3.5px] h-[3.5px] rounded-full pointer-events-none" style={{bottom:'5%',left:'92%',background:'radial-gradient(circle,rgba(168,85,247,0.85),rgba(168,85,247,0.2))',boxShadow:'0 0 10px rgba(168,85,247,0.5), 0 0 22px rgba(168,85,247,0.2)'}} />
        <div className="firefly-8 absolute w-[2.5px] h-[2.5px] rounded-full pointer-events-none" style={{bottom:'40%',left:'8%',background:'radial-gradient(circle,rgba(6,182,212,0.85),rgba(6,182,212,0.25))',boxShadow:'0 0 8px rgba(6,182,212,0.5), 0 0 18px rgba(6,182,212,0.2)'}} />
      
        {/* Container */}
        <div className="w-full max-w-[1680px] flex flex-col gap-6 relative z-10">
          
          {/* Header Ribbon */}
          <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between md:justify-start gap-3">
              <div className="flex items-center gap-3">
                {/* Mobile Hamburger Button */}
                <button 
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="md:hidden p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-300 hover:text-white transition-all shadow-[0_0_15px_rgba(0,0,0,0.4)]"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <img 
                  src={logoImg} 
                  alt="Alpha Gold Logo" 
                  className="h-20 w-24 md:h-24 md:w-28 object-contain filter drop-shadow-[0_0_20px_rgba(245,158,11,0.5)] transition-all duration-500 hover:scale-105" 
                />
                <div className="filter drop-shadow-[0_0_15px_rgba(245,158,11,0.45)] hover:drop-shadow-[0_0_25px_rgba(245,158,11,0.7)] transition-all duration-700">
                  <h1 className="text-3xl md:text-4xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-amber-100 via-amber-400 to-amber-600 select-none uppercase font-sans">
                    {currentView === 'dashboard' ? 'DASHBOARD'
                      : currentView === 'capital' ? t('capitalManagement').toUpperCase()
                      : currentView === 'calendar' ? t('economicCalendar').toUpperCase()
                      : currentView === 'admin' ? 'ADMIN PANEL'
                      : 'DASHBOARD'}
                  </h1>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Live Indicator */}
              <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.07] px-3.5 py-1.5 rounded-xl">
                <div className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${connectionStatus ? 'bg-sky-400' : 'bg-red-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${connectionStatus ? 'bg-sky-500' : 'bg-red-500'}`}></span>
                </div>
                <div className="text-left leading-none">
                  <div className="text-[11px] text-sky-500/70 font-bold uppercase tracking-wider">{t('feeds')}</div>
                  <div className="text-xs font-black text-sky-400 font-mono mt-0.5">{utcTime || '00:00:00'}</div>
                </div>
              </div>

              {/* Admin Panel Button */}
              {user?.role === 'Administrator' && (
                <button
                  onClick={() => {
                    setAdminError('');
                    setAdminSuccess('');
                    setCurrentView(currentView === 'dashboard' ? 'admin' : 'dashboard');
                  }}
                  className={`flex items-center gap-2 border px-3 py-2 rounded-xl text-xs font-black transition-all duration-300 cursor-pointer ${
                    currentView === 'admin'
                      ? 'bg-amber-500 border-amber-500 text-[#040406] shadow-[0_0_15px_rgba(234,179,8,0.25)]'
                      : 'bg-white/[0.04] border-amber-500/30 text-amber-500 hover:border-amber-500/60 hover:bg-amber-500/5'
                  }`}
                >
                  <Sliders className="h-4 w-4" />
                  <span className="hidden sm:inline">{currentView === 'admin' ? t('adminPanel') : t('memberManagement')}</span>
                </button>
              )}

              {/* Settings Toggle Button */}
              {currentView !== 'admin' && (
                <button
                  onClick={toggleConfigPanel}
                  title={t('configPanelTitle')}
                  className={`p-2.5 border rounded-xl text-xs font-black transition-all duration-300 cursor-pointer flex items-center justify-center ${
                    showConfigPanel
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-500 shadow-[0_0_15px_rgba(234,179,8,0.1)]'
                      : 'bg-white/[0.04] border-white/[0.07] text-slate-400 hover:text-white hover:border-white/[0.15]'
                  }`}
                >
                  <Sliders className="h-4 w-4" />
                </button>
              )}

              {/* Language Toggle */}
              <div className="flex bg-white/[0.04] border border-white/[0.07] p-0.5 rounded-xl">
                <button
                  onClick={() => setLanguage('en')}
                  className={`px-2 py-1 text-xs font-black rounded-lg transition-all duration-200 cursor-pointer ${
                    language === 'en'
                      ? 'bg-amber-500 text-[#040406] shadow-[0_0_8px_rgba(234,179,8,0.15)]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  EN
                </button>
                <button
                  onClick={() => setLanguage('vn')}
                  className={`px-2 py-1 text-xs font-black rounded-lg transition-all duration-200 cursor-pointer ${
                    language === 'vn'
                      ? 'bg-amber-500 text-[#040406] shadow-[0_0_8px_rgba(234,179,8,0.15)]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  VN
                </button>
              </div>

              {/* Profile Widget */}
              <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.07] px-3 py-1.5 rounded-xl">
                <div className="h-7 w-7 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-xs font-black text-amber-500 font-mono">
                  {user?.name ? user.name.slice(0,2).toUpperCase() : 'US'}
                </div>
                <div className="text-left hidden sm:block">
                  <div className="text-[11px] text-slate-500 font-bold leading-none tracking-wider">{t('account')}</div>
                  <div className="text-xs font-black text-slate-300 mt-0.5">{user?.name || 'Trader'}</div>
                </div>
                <button 
                  onClick={handleLogout}
                  title={t('logout')}
                  className="ml-1 p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-300 cursor-pointer flex items-center justify-center"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {currentView === 'admin' ? (
            <AdminPanel />
          ) : currentView === 'capital' ? (
            <CapitalManagement />
          ) : currentView === 'calendar' ? (
            <EconomicCalendar />
          ) : (
            <>
              {/* ── DESKTOP LAYOUT (lg+): 3-column layout ── */}
              <div className="hidden lg:flex flex-row items-stretch gap-6 w-full">
                <TradingChart />
                <div className="w-[22%] min-w-[260px] flex-shrink-0 flex flex-col gap-6">
                  <CoreController />
                  <RiskCalculator />
                </div>
              </div>

              {/* ── MOBILE LAYOUT (< lg): Tab-based single-panel display ── */}
              <div className="flex lg:hidden flex-col w-full pb-[76px]">
                {/* Tab: Chart — full TradingChart with chart + left signal panels */}
                {activeMobileTab === 'chart' && (
                  <div className="w-full">
                    <TradingChart mobileTab="chart" />
                  </div>
                )}

                {/* Tab: Signal — signal card + live trading board from TradingChart */}
                {activeMobileTab === 'signal' && (
                  <div className="w-full">
                    <TradingChart mobileTab="signal" />
                  </div>
                )}

                {/* Tab: Manage — CoreController + ConfigPanel + RiskCalculator */}
                {activeMobileTab === 'manage' && (
                  <div className="flex flex-col gap-4 w-full">
                    <CoreController />
                    <RiskCalculator />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── MOBILE TAB BAR (bottom navigation) ── */}
      {isLoggedIn && currentView === 'dashboard' && (
        <MobileTabBar activeTab={activeMobileTab} onTabChange={setActiveMobileTab} />
      )}

      {/* Slide-out Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end md:hidden">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          {/* Drawer Panel */}
          <div className="relative w-80 max-w-[85vw] h-full panel-surface border-l border-white/[0.06] p-6 flex flex-col justify-between shadow-2xl z-10 transition-transform duration-300 ease-in-out">
            <div className="flex flex-col gap-6">
              {/* Drawer Header */}
              <div className="flex justify-between items-center pb-4 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <img 
                    src={logoImg} 
                    alt="Alpha Gold Logo" 
                    className="h-10 w-10 object-contain filter drop-shadow-[0_0_10px_rgba(245,158,11,0.3)]" 
                  />
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-black text-amber-500 tracking-wider">ALPHA GOLD</span>
                    <span className="text-[11px] text-slate-400 font-bold uppercase mt-0.5">MULTI-ASSET CONSOLE</span>
                  </div>
                </div>
                
                {/* Close Button (X) */}
                <button 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white transition-colors"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Navigation Links inside Drawer */}
              <nav className="flex flex-col gap-2 overflow-y-auto max-h-[60vh] text-left">
                <button 
                  onClick={() => {
                    setCurrentView('dashboard');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-4 py-3 px-4 rounded-xl transition-all cursor-pointer ${
                    currentView === 'dashboard'
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-black'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04] text-xs font-bold border border-transparent'
                  }`}
                >
                  <TrendingUp className={`h-5 w-5 ${currentView === 'dashboard' ? 'text-amber-500' : 'text-slate-400'}`} />
                  <span>{t('dashboard')}</span>
                </button>
                
                <button 
                  onClick={() => {
                    setCurrentView('capital');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between py-3 px-4 rounded-xl transition-all cursor-pointer ${
                    currentView === 'capital'
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-black'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04] text-xs font-bold border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <Coins className={`h-5 w-5 ${currentView === 'capital' ? 'text-amber-500' : 'text-slate-400'}`} />
                    <span>{t('capitalManagement')}</span>
                  </div>
                  <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded text-[11px] font-black tracking-widest">SAFE</span>
                </button>

                <button 
                  onClick={() => {
                    setCurrentView('calendar');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-4 py-3 px-4 rounded-xl transition-all cursor-pointer ${
                    currentView === 'calendar'
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-black'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04] text-xs font-bold border border-transparent'
                  }`}
                >
                  <Calendar className={`h-5 w-5 ${currentView === 'calendar' ? 'text-amber-500' : 'text-slate-400'}`} />
                  <span>{t('economicCalendar')}</span>
                </button>
              </nav>
            </div>

            {/* Profile Widget inside Drawer */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-left">
                <div className="h-8 w-8 rounded-full bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-xs font-black text-amber-500 font-mono">
                  {user?.name ? user.name.slice(0, 2).toUpperCase() : 'US'}
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-black text-white leading-none">{user?.name || 'Trader'}</span>
                  <span className="text-xs text-amber-500/80 font-bold mt-1 uppercase">{t('premiumMember')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
