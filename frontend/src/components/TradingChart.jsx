import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import {
  Clock,
  ShieldAlert,
  Target,
  Star,
  Activity,
  Zap,
  TrendingUp,
  ChevronsUp,
  ChevronsDown,
  Globe,
  Sliders,
  PenTool,
  MousePointer,
  Slash,
  Minus,
  Square,
  Grid,
  Trash2,
  Undo
} from 'lucide-react';
import { useTradeStore, SOCKET_URL } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';
import { SignalHistoryPanel } from './SignalHistoryPanel';
import { readSignalHistory, replaceSignalHistory } from '../utils/signalHistory';
import {
  calculateIndicatorData,
  calculateRSI,
  calculateMACD,
  calculateSMC,
  calculateZenTrendLines,
  calculateUTBotSignals,
  calculateChandelierExit,
  calculateTrendlinesWithBreaks,
  getCurrentSignal
} from '../utils/indicators';

const SYMBOLS = ['XAUUSD', 'WTIUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];
const SYMBOLS_DISPLAY = {
  'XAUUSD': 'Vàng Spot (XAUUSD)',
  'WTIUSD': 'Dầu WTI Spot (WTIUSD)',
  'XAGUSD': 'Bạc Spot (XAGUSD)',
  'BTCUSD': 'Bitcoin (BTCUSD)',
  'ETHUSD': 'Ethereum (ETHUSD)'
};

// ── Live signal status: compares the latest live price against SL/TP ──
function computeSignalStatus(signal, livePrice) {
  if (!signal || signal.action === 'stale' || !signal.entry) return 'none';
  
  // If the signal has already been permanently flagged as finished or sl by indicators.js, return it immediately
  if (signal.status === 'finished') return 'tp';
  if (signal.status === 'sl') return 'sl';
  if (signal.status === 'closed') return 'none'; // Optional legacy

  if (livePrice == null || isNaN(livePrice) || livePrice === 0) return 'running';

  if (signal.hitTps && signal.hitTps[1]) return 'tp';
  if (signal.hitTps && signal.hitTps[0]) return 'tp1';

  const tp1Value = (signal.tps && signal.tps[0]) || signal.tp || 0;
  const tp2Value = (signal.tps && signal.tps[1]) || tp1Value;

  if (signal.action === 'sell') {
    if (tp2Value && livePrice <= tp2Value) return 'tp';
    if (signal.sl && livePrice >= signal.sl) return 'sl';
    if (tp1Value && livePrice <= tp1Value) return 'tp1';
  } else if (signal.action === 'buy') {
    if (tp2Value && livePrice >= tp2Value) return 'tp';
    if (signal.sl && livePrice <= signal.sl) return 'sl';
    if (tp1Value && livePrice >= tp1Value) return 'tp1';
  }
  return 'running';
}

const STATUS_META = {
  running: { 
    vn: 'ĐANG CHẠY', 
    en: 'ACTIVE', 
    cls: 'text-emerald-400 bg-emerald-950/40 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.25),inset_0_1px_1px_rgba(255,255,255,0.05)] font-black uppercase tracking-wider', 
  },
  tp1: { 
    vn: 'ĐÃ CHẠM TP1', 
    en: 'TP1 HIT', 
    cls: 'text-blue-400 bg-blue-950/45 backdrop-blur-md border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2),inset_0_1px_1px_rgba(255,255,255,0.05)] font-extrabold tracking-wider', 
  },
  tp: { 
    vn: 'ĐÃ CHẠM TP2', 
    en: 'TP2 HIT', 
    cls: 'text-amber-400 bg-amber-950/45 backdrop-blur-md border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.2),inset_0_1px_1px_rgba(255,255,255,0.05)] font-extrabold', 
  },
  sl: { 
    vn: 'ĐÃ CHẠM SL', 
    en: 'SL HIT', 
    cls: 'text-red-400 bg-red-950/45 backdrop-blur-md border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.2),inset_0_1px_1px_rgba(255,255,255,0.05)] font-extrabold', 
  },
  none: { 
    vn: 'HẾT HIỆU LỰC', 
    en: 'EXPIRED', 
    cls: 'text-slate-500 bg-slate-950/20 border-dashed border-slate-700/50 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.02)_0px,rgba(255,255,255,0.02)_2px,transparent_2px,transparent_6px)] font-bold opacity-60 tracking-wider', 
  },
};

// Utility function to play a sleek notification sound
const playNotificationSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.warn('Audio play failed (maybe browser policy)', e);
  }
};

// Guard: returns true if there is an active signal that has NOT yet finished (not hit SL or full TP).
// While locked, new popup notifications are suppressed to avoid overwriting an active trade.
function isSignalLocked() {
  const state = useTradeStore.getState();
  const sig = state.currentSignal;
  const livePrice = state.livePrice;
  if (!sig || sig.action === 'stale') return false;
  if (sig.status === 'closed') return false;
  const status = computeSignalStatus(sig, livePrice);
  // 'running' = price has not yet reached SL, TP1, or TP2
  // 'tp1'     = TP1 touched but TP2 (full finish) not yet reached — still locked
  return status === 'running' || status === 'tp1';
}

function ToastContainer() {
  const toasts = useTradeStore(s => s.toasts);
  
  if (!toasts || toasts.length === 0) return null;
  
  return (
    <div className="fixed top-24 right-4 lg:right-[340px] xl:right-[380px] z-50 flex flex-col gap-3 pointer-events-none">
      {toasts.map(toast => {
        const sig = toast.signal;
        const isBuy = sig.action === 'buy';
        const systemName = (sig.system || 'SYSTEM').toUpperCase();
        const tf = sig.interval || 'M5';
        
        return (
          <div key={toast.id} className={`pointer-events-auto p-4 w-72 rounded-xl backdrop-blur-xl border shadow-2xl transition-all duration-500 animate-in fade-in slide-in-from-right-8 ${isBuy ? 'bg-emerald-950/90 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.3)]' : 'bg-red-950/90 border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.3)]'}`}>
             <div className="flex justify-between items-center mb-2">
               <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>TÍN HIỆU {sig.ticker || sig.symbol || 'XAUUSD'}</span>
               <span className="text-[10px] text-slate-300 font-bold tracking-wider">{tf}</span>
             </div>
             <div className="mb-2">
               <span className="text-sm font-black text-white/90 tracking-wider">{systemName}</span>
             </div>
             <div className="flex justify-between items-baseline mt-1">
               <span className={`text-2xl font-black uppercase tracking-tighter ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>{isBuy ? 'BUY' : 'SELL'}</span>
             </div>
          </div>
        );
      })}
    </div>
  );
}

// Small isolated component: only THIS re-renders on each price tick (not the whole chart)
function SignalStatusBadge({ signal }) {
  const livePrice = useTradeStore(s => s.livePrice);
  const { language } = useTranslation();
  const status = computeSignalStatus(signal, livePrice);
  const m = STATUS_META[status];
  
  let icon = null;
  if (status === 'running') {
    icon = (
      <span className="relative flex h-3 w-3 items-center justify-center shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 bg-emerald-400"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
      </span>
    );
  } else if (status === 'tp' || status === 'tp1') {
    icon = <Star className="h-3 w-3 text-amber-400 fill-amber-400/30 animate-pulse shrink-0" />;
  } else if (status === 'sl') {
    icon = <ShieldAlert className="h-3 w-3 text-red-400 animate-bounce shrink-0" />;
  } else {
    icon = <Clock className="h-3.5 w-3.5 text-slate-600 shrink-0" />;
  }

  return (
    <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase border transition-all duration-300 ${m.cls}`}>
      {icon}
      <span>{language === 'en' ? m.en : m.vn}</span>
    </span>
  );
}

// Live price position between SL and TP — vivid visual gauge
function SignalProgressBar({ signal, symbol }) {
  const livePrice = useTradeStore(s => s.livePrice);
  
  const tp1Value = signal.tps && signal.tps[0] ? signal.tps[0] : signal.tp;
  const tp2Value = signal.tps && signal.tps.length > 1 ? signal.tps[1] : tp1Value;
  
  if (!signal || signal.action === 'stale' || !signal.entry || !signal.sl || !tp2Value) return null;

  const status = computeSignalStatus(signal, livePrice);
  const isFinished = status === 'tp' || status === 'sl';

  const dec = symbol === 'XAGUSD' ? 4 : 2;
  const lo = Math.min(signal.sl, tp2Value);
  const hi = Math.max(signal.sl, tp2Value);
  const span = (hi - lo) || 1;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const entryPct = clamp(((signal.entry - lo) / span) * 100);
  const tp1Pct = clamp(((tp1Value - lo) / span) * 100);
  
  let effectiveLivePrice = livePrice;
  if (isFinished) {
    if (status === 'tp') effectiveLivePrice = tp2Value;
    else if (status === 'sl') effectiveLivePrice = signal.sl;
  }
  
  const hasPrice = effectiveLivePrice != null && !isNaN(effectiveLivePrice) && effectiveLivePrice !== 0;
  const pricePct = hasPrice ? clamp(((effectiveLivePrice - lo) / span) * 100) : entryPct;
  const tpAtRight = signal.action === 'buy'; 
  const trackGradient = tpAtRight
    ? 'linear-gradient(90deg, rgba(244,63,94,0.55), rgba(148,163,184,0.18) 50%, rgba(16,185,129,0.6))'
    : 'linear-gradient(90deg, rgba(16,185,129,0.6), rgba(148,163,184,0.18) 50%, rgba(244,63,94,0.55))';
  const leftVal = tpAtRight ? signal.sl : tp2Value;
  const rightVal = tpAtRight ? tp2Value : signal.sl;
  return (
    <div className="px-1 pt-1 pb-3 relative">
      <div className="flex justify-between text-[10px] font-black tracking-wider mb-1.5">
        <span className={tpAtRight ? 'text-rose-400' : 'text-emerald-400'}>{tpAtRight ? 'SL' : 'TP2'} {leftVal.toFixed(dec)}</span>
        <span className="opacity-0">HIDDEN</span>
        <span className={tpAtRight ? 'text-emerald-400' : 'text-rose-400'}>{tpAtRight ? 'TP2' : 'SL'} {rightVal.toFixed(dec)}</span>
      </div>
      <div className="relative h-2.5 rounded-full" style={{ background: trackGradient }}>
        {/* TP1 Marker Line & Label below */}
        {tp1Value !== tp2Value && (
          <>
            <span className="absolute top-0 bottom-0 w-0.5 bg-blue-400/50 -translate-x-1/2" style={{ left: `${tp1Pct}%` }} />
            <span className="absolute top-4 text-[9px] font-black text-blue-400/80 -translate-x-1/2 whitespace-nowrap" style={{ left: `${tp1Pct}%` }}>
              TP1 {tp1Value.toFixed(dec)}
            </span>
          </>
        )}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pricePct}%` }}>
          <div className={`w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_10px_white] ring-2 ring-slate-900 mb-0.5 mx-auto ${isFinished ? 'opacity-50' : ''}`} />
          {hasPrice && (
            <div className={`px-2 py-0.5 bg-slate-800 text-white text-[10px] font-black rounded-md whitespace-nowrap shadow-lg border border-slate-700 before:content-[''] before:absolute before:-top-1 before:left-1/2 before:-translate-x-1/2 before:border-4 before:border-transparent before:border-b-slate-700 ${isFinished ? 'opacity-50' : ''}`}>
              {effectiveLivePrice.toFixed(dec)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroActionDisplay({ currentSignal }) {
  const livePrice = useTradeStore(s => s.livePrice);
  const { t } = useTranslation();
  const status = computeSignalStatus(currentSignal, livePrice);
  const isFinished = status === 'tp' || status === 'sl' || currentSignal.status === 'closed';

  return (
    <div
      data-signal-result={status === 'tp' ? 'win' : status === 'sl' ? 'loss' : isFinished ? 'finished' : 'active'}
      className={`hero-action-display relative h-14 rounded-xl flex items-center justify-center overflow-hidden transition-all duration-500 ${
      currentSignal.action === 'buy' && !isFinished
        ? 'bg-amber-500/[0.02] glow-neon-border-buy'
        : currentSignal.action === 'sell' && !isFinished
        ? 'bg-red-500/[0.02] glow-neon-border-sell'
        : 'bg-slate-950/20 border-slate-800/60'
    }`}>
      {/* Tech Corner Crosshairs */}
      <span className={`absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 transition-colors duration-500 ${
        !isFinished && currentSignal.action === 'buy' ? 'border-amber-400' : !isFinished && currentSignal.action === 'sell' ? 'border-red-400' : 'border-slate-700'
      }`} />
      <span className={`absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 transition-colors duration-500 ${
        !isFinished && currentSignal.action === 'buy' ? 'border-amber-400' : !isFinished && currentSignal.action === 'sell' ? 'border-red-400' : 'border-slate-700'
      }`} />
      <span className={`absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 transition-colors duration-500 ${
        !isFinished && currentSignal.action === 'buy' ? 'border-amber-400' : !isFinished && currentSignal.action === 'sell' ? 'border-red-400' : 'border-slate-700'
      }`} />
      <span className={`absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 transition-colors duration-500 ${
        !isFinished && currentSignal.action === 'buy' ? 'border-amber-400' : !isFinished && currentSignal.action === 'sell' ? 'border-red-400' : 'border-slate-700'
      }`} />

      {/* Scanning bar effect */}
      {currentSignal.action !== 'stale' && !isFinished && (
        <div className={`absolute inset-x-0 h-[1px] opacity-15 pointer-events-none animate-scanline ${
          currentSignal.action === 'buy' ? 'bg-amber-400' : 'bg-red-400'
        }`} />
      )}

      {/* Glowing text display */}
      <h2 className={`text-2xl lg:text-3xl font-black tracking-[0.1em] leading-none uppercase animate-text-shimmer hud-signal-text ${
        isFinished
          ? 'text-slate-400'
          : currentSignal.action === 'buy'
          ? 'text-amber-300 glow-neon-buy'
          : currentSignal.action === 'sell'
          ? 'text-red-300 glow-neon-sell'
          : 'text-slate-300'
      }`}
      data-text={isFinished ? 'FINISHED' : currentSignal.action === 'buy' ? 'BUY NOW' : currentSignal.action === 'sell' ? 'SELL NOW' : 'WAITING'}
      >
        {isFinished ? 'FINISHED' : currentSignal.action === 'buy' ? 'BUY NOW' : currentSignal.action === 'sell' ? 'SELL NOW' : t('waiting')}
      </h2>
    </div>
  );
}
function TimeAgoDisplay({ timestamp }) {
  const [mins, setMins] = useState(0);
  const { language } = useTranslation();

  useEffect(() => {
    if (!timestamp) return;
    const calc = () => setMins(Math.floor((Date.now() - timestamp) / 60000));
    calc();
    const iv = setInterval(calc, 60000);
    return () => clearInterval(iv);
  }, [timestamp]);

  if (!timestamp) return null;
  
  const label = language === 'en' ? 'REPORTED:' : 'ĐÃ BÁO:';
  const justNow = language === 'en' ? 'JUST NOW' : 'VỪA XONG';
  const minsAgo = language === 'en' ? `${mins} MINS AGO` : `${mins} PHÚT TRƯỚC`;

  return (
    <div className="flex justify-center mb-2">
      <span className="px-3 py-1 rounded-full bg-slate-900/50 border border-white/[0.05] text-[10px] font-black tracking-widest text-slate-400 uppercase">
        {label} <span className="text-amber-500">{mins === 0 ? justNow : minsAgo}</span>
      </span>
    </div>
  );
}

export function TradingChart({ mobileTab }) {
  const { t } = useTranslation();
  const {
    isLoggedIn,
    selectedSymbol,
    setSelectedSymbol,
    selectedTimeframe,
    setSelectedTimeframe,
    selectedIndicatorSystem,
    setSelectedIndicatorSystem,
    backgroundTheme,
    zenFastPeriod,
    zenSlowPeriod,
    utBotKeyValue,
    utBotAtrPeriod,
    chandelierAtrPeriod,
    chandelierAtrMultiplier,
    trendlineLength,
    trendlineSlopeMult,
    connectionStatus,
    setConnectionStatus,
    ind1Type,
    ind1Period,
    ind1Color,
    showInd1,
    ind2Type,
    ind2Period,
    ind2Color,
    showInd2,
    rsiType,
    rsiPeriod,
    rsiColor,
    setRsiColor,
    showRsi,
    macdType,
    macdFast,
    macdSlow,
    macdSignal,
    macdColor,
    setMacdColor,
    showMacd,
    smcType,
    smcBosColor,
    smcChochColor,
    showSmc,
    setSignals,
    setHistoryCount,
    logout,
    setLoginError,
    candleColorTheme,
    setCandleColorTheme,
    riskCalculator,
    updateRiskCalculator,
    showConfigPanel
  } = useTradeStore();

  // DOM refs for live price and clock — bypass React re-render completely
  const livePriceDomRef = React.useRef(null);
  const chartClockDomRef = React.useRef(null);


  // Drawing Tools State
  const [showDrawingToolbar, setShowDrawingToolbar] = React.useState(true);
  const [activeTool, setActiveTool] = React.useState('cursor');
  const [drawings, setDrawings] = React.useState([]);
  const [drawingState, setDrawingState] = React.useState({
    isDrawing: false,
    startPoint: null,
    currentPoint: null
  });

  // Mobile FAB (Floating Action Button) for drawing tools
  const [showMobileFAB, setShowMobileFAB] = React.useState(false);

  // Keyboard shortcut toast hint
  const [keyHint, setKeyHint] = React.useState(null);
  const keyHintTimerRef = React.useRef(null);
  const drawingsSyncDebounceRef = React.useRef(null);
  const pageLoadTimeRef = React.useRef(Date.now());

  // The backend engine is the sole writer. The browser only hydrates a local
  // display cache and receives subsequent authoritative socket snapshots.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    const token = localStorage.getItem('auth_token');

    (async () => {
      try {
        const response = await fetch(`${SOCKET_URL}/api/global-signal-history`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error(`Global signal history request failed (${response.status})`);
        const data = await response.json();
        if (cancelled) return;
        replaceSignalHistory(Array.isArray(data.records) ? data.records : []);
      } catch (error) {
        console.error('Failed to initialize website signal history:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const showKeyHint = (text) => {
    setKeyHint(text);
    if (keyHintTimerRef.current) clearTimeout(keyHintTimerRef.current);
    keyHintTimerRef.current = setTimeout(() => setKeyHint(null), 1800);
  };

  const canvasRef = useRef(null);
  const drawingsRef = useRef([]);
  const drawCanvasRef = useRef(null);

  // Load drawings from server when symbol changes
  useEffect(() => {
    if (!isLoggedIn) return;
    const token = localStorage.getItem('auth_token');
    fetch(`${SOCKET_URL}/api/drawings/${selectedSymbol}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.drawings) {
          setDrawings(data.drawings);
        } else {
          setDrawings([]);
        }
      })
      .catch(() => {
        setDrawings([]);
      });
  }, [selectedSymbol, isLoggedIn]);

  // Debounce-emit drawings to server whenever drawings array changes
  useEffect(() => {
    if (!isLoggedIn) return;
    if (drawingsSyncDebounceRef.current) clearTimeout(drawingsSyncDebounceRef.current);
    drawingsSyncDebounceRef.current = setTimeout(() => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('drawings:save', {
          symbol: selectedSymbol,
          drawings: drawingsRef.current
        });
      }
    }, 600);
  }, [drawings, selectedSymbol, isLoggedIn]);

  // Sync ref with drawings state
  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  // Reset active tool when symbol changes (drawings are loaded from server)
  useEffect(() => {
    setActiveTool('cursor');
  }, [selectedSymbol]);

  const handleUndo = () => {
    setDrawings(prev => prev.slice(0, -1));
  };

  // Keyboard shortcut listener — Ctrl+Z (undo) + T/H/F/R/Esc/Delete
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't fire when typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setDrawings(prev => prev.slice(0, -1));
        showKeyHint('↩ Undo');
        return;
      }
      switch (e.key.toLowerCase()) {
        case 't':
          setActiveTool('trendline');
          showKeyHint('[ T ] Đường xu hướng ✏️');
          break;
        case 'h':
          setActiveTool('horizontal');
          showKeyHint('[ H ] Đường nằm ngang —');
          break;
        case 'f':
          setActiveTool('fib');
          showKeyHint('[ F ] Fibonacci 📐');
          break;
        case 'r':
          setActiveTool('rectangle');
          showKeyHint('[ R ] Hình chữ nhật ▭');
          break;
        case 'escape':
          setActiveTool('cursor');
          showKeyHint('[ Esc ] Con trỏ 🖱️');
          break;
        case 'delete':
        case 'backspace':
          if (e.key === 'Delete') {
            setDrawings([]);
            setActiveTool('cursor');
            showKeyHint('🗑️ Đã xóa tất cả nét vẽ');
          }
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Render pipeline for canvas elements
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !chartInstance.current || !candlestickSeriesRef.current) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const timeScale = chartInstance.current.timeScale();
    const series = candlestickSeriesRef.current;

    // Draw completed drawings
    drawingsRef.current.forEach((drawing) => {
      drawSingleDrawing(ctx, drawing, timeScale, series);
    });

    // Draw temporary drawing in progress
    if (activeTool !== 'cursor' && drawingState.isDrawing && drawingState.startPoint) {
      const tempDrawing = {
        type: activeTool,
        start: drawingState.startPoint,
        end: drawingState.currentPoint || drawingState.startPoint,
      };
      drawSingleDrawing(ctx, tempDrawing, timeScale, series);
    }
  };

  const drawSingleDrawing = (ctx, drawing, timeScale, series) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (drawing.type === 'horizontal') {
      const y = series.priceToCoordinate(drawing.start.price);
      if (y === null) return;
      ctx.beginPath();
      ctx.strokeStyle = '#eab308'; // Gold (yellow-500)
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width - 56, y); // exclude price scale (56px)
      ctx.stroke();
      return;
    }

    if (drawing.type === 'trendline') {
      const x1 = timeScale.timeToCoordinate(drawing.start.time);
      const y1 = series.priceToCoordinate(drawing.start.price);
      const x2 = timeScale.timeToCoordinate(drawing.end.time);
      const y2 = series.priceToCoordinate(drawing.end.price);

      if (x1 === null || y1 === null || x2 === null || y2 === null) return;

      ctx.beginPath();
      ctx.strokeStyle = '#eab308'; // Gold
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Draw small circles at endpoints
      ctx.beginPath();
      ctx.fillStyle = '#eab308';
      ctx.arc(x1, y1, 3.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x2, y2, 3.5, 0, 2 * Math.PI);
      ctx.fill();
      return;
    }

    if (drawing.type === 'rectangle') {
      const x1 = timeScale.timeToCoordinate(drawing.start.time);
      const y1 = series.priceToCoordinate(drawing.start.price);
      const x2 = timeScale.timeToCoordinate(drawing.end.time);
      const y2 = series.priceToCoordinate(drawing.end.price);

      if (x1 === null || y1 === null || x2 === null || y2 === null) return;

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.6)'; // Gold with opacity
      ctx.fillStyle = 'rgba(234, 179, 8, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.rect(x1, y1, x2 - x1, y2 - y1);
      ctx.fill();
      ctx.stroke();
      return;
    }

    if (drawing.type === 'fib') {
      const x1 = timeScale.timeToCoordinate(drawing.start.time);
      const y1 = series.priceToCoordinate(drawing.start.price);
      const x2 = timeScale.timeToCoordinate(drawing.end.time);
      const y2 = series.priceToCoordinate(drawing.end.price);

      if (x1 === null || y1 === null || x2 === null || y2 === null) return;

      const price1 = drawing.start.price;
      const price2 = drawing.end.price;
      const diff = price1 - price2;

      // Fib levels: 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0
      const levels = [
        { ratio: 0, color: 'rgba(239, 68, 68, 0.12)' },       // 0% - Red
        { ratio: 0.236, color: 'rgba(245, 158, 11, 0.08)' }, // 23.6% - Amber
        { ratio: 0.382, color: 'rgba(16, 185, 129, 0.08)' }, // 38.2% - Green
        { ratio: 0.5, color: 'rgba(6, 182, 212, 0.08)' },    // 50% - Cyan
        { ratio: 0.618, color: 'rgba(59, 130, 246, 0.08)' }, // 61.8% - Blue
        { ratio: 0.786, color: 'rgba(139, 92, 246, 0.08)' }, // 78.6% - Purple
        { ratio: 1.0, color: 'rgba(239, 68, 68, 0.12)' }      // 100% - Red
      ];

      const startX = Math.min(x1, x2);
      const endX = Math.max(x1, x2);
      const chartWidth = canvas.width - 56; // Exclude price scale area

      levels.forEach((lvl, index) => {
        const priceVal = price1 - diff * lvl.ratio;
        const yVal = series.priceToCoordinate(priceVal);
        if (yVal === null) return;

        // Draw level line
        ctx.beginPath();
        ctx.strokeStyle = index === 0 || index === 6 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(234, 179, 8, 0.35)';
        ctx.lineWidth = 1;
        ctx.moveTo(startX, yVal);
        ctx.lineTo(chartWidth, yVal);
        ctx.stroke();

        // Draw level background band
        if (index < levels.length - 1) {
          const nextPriceVal = price1 - diff * levels[index + 1].ratio;
          const nextYVal = series.priceToCoordinate(nextPriceVal);
          if (nextYVal !== null) {
            ctx.fillStyle = lvl.color;
            ctx.fillRect(startX, yVal, chartWidth - startX, nextYVal - yVal);
          }
        }

        // Draw level label text
        ctx.fillStyle = '#94a3b8'; // slate-400
        ctx.font = '9px monospace';
        ctx.fillText(`${(lvl.ratio * 100).toFixed(1)}% (${priceVal.toFixed(2)})`, startX + 5, yVal - 3);
      });

      // Draw high-to-low diagonal connector dashed line
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  useEffect(() => {
    drawCanvasRef.current = drawCanvas;
  });

  useEffect(() => {
    drawCanvas();
  }, [drawings, drawingState, activeTool]);

  // Handle panel toggle reflow and chart resize
  useEffect(() => {
    setTimeout(() => {
      if (chartInstance.current && chartContainerRef.current) {
        const w = chartContainerRef.current.clientWidth;
        const h = window.innerWidth < 768 ? 320 : 540;
        chartInstance.current.applyOptions({ width: w, height: h });
        if (rsiChartInstance.current && rsiChartContainerRef.current) {
          rsiChartInstance.current.applyOptions({ width: rsiChartContainerRef.current.clientWidth });
        }
        if (macdChartInstance.current && macdChartContainerRef.current) {
          macdChartInstance.current.applyOptions({ width: macdChartContainerRef.current.clientWidth });
        }
        if (canvasRef.current) {
          canvasRef.current.width = w;
          canvasRef.current.height = h;
          drawCanvas();
        }
      }
    }, 50);
  }, [showDrawingToolbar]);

  // Canvas Mouse Interactions
  const handleMouseDown = (e) => {
    if (activeTool === 'cursor' || !chartInstance.current || !candlestickSeriesRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const time = chartInstance.current.timeScale().coordinateToTime(x);
    const price = candlestickSeriesRef.current.coordinateToPrice(y);

    if (time === null || price === null) return;

    if (activeTool === 'horizontal') {
      const newDrawing = {
        type: 'horizontal',
        start: { time, price }
      };
      setDrawings(prev => [...prev, newDrawing]);
      return;
    }

    setDrawingState({
      isDrawing: true,
      startPoint: { time, price },
      currentPoint: { time, price }
    });
  };

  const handleMouseMove = (e) => {
    if (!drawingState.isDrawing || !chartInstance.current || !candlestickSeriesRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const time = chartInstance.current.timeScale().coordinateToTime(x);
    const price = candlestickSeriesRef.current.coordinateToPrice(y);

    if (time === null || price === null) return;

    setDrawingState(prev => ({
      ...prev,
      currentPoint: { time, price }
    }));
  };

  const handleMouseUp = (e) => {
    if (!drawingState.isDrawing || !chartInstance.current || !candlestickSeriesRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let time = chartInstance.current.timeScale().coordinateToTime(x);
    let price = candlestickSeriesRef.current.coordinateToPrice(y);

    const startPoint = drawingState.startPoint;
    const currentPoint = drawingState.currentPoint;

    const finalEnd = {
      time: time || currentPoint.time,
      price: price || currentPoint.price
    };

    const newDrawing = {
      type: activeTool,
      start: startPoint,
      end: finalEnd
    };

    setDrawings(prev => [...prev, newDrawing]);
    setDrawingState({
      isDrawing: false,
      startPoint: null,
      currentPoint: null
    });
  };

  // DOM elements and chart refs
  const chartContainerRef = useRef(null);
  const rsiChartContainerRef = useRef(null);
  const macdChartContainerRef = useRef(null);

  const chartInstance = useRef(null);
  const rsiChartInstance = useRef(null);
  const macdChartInstance = useRef(null);

  const candlestickSeriesRef = useRef(null);
  const indicator1SeriesRef = useRef(null);
  const indicator2SeriesRef = useRef(null);
  const rsiSeriesRef = useRef(null);
  const macdLineSeriesRef = useRef(null);
  const macdSignalSeriesRef = useRef(null);
  const macdHistSeriesRef = useRef(null);

  // Custom indicator series refs
  const zenFastSeriesRef = useRef(null);
  const zenSlowSeriesRef = useRef(null);
  const utBotTrailingStopSeriesRef = useRef(null);
  const chandelierLongStopSeriesRef = useRef(null);
  const chandelierShortStopSeriesRef = useRef(null);
  const trendlineUpperSeriesRef = useRef(null);
  const trendlineLowerSeriesRef = useRef(null);

  const candlesHistoryRef = useRef([]);
  const socketRef = useRef(null);
  // Throttle indicator recalculation — max once per 500ms regardless of tick rate
  const lastIndicatorUpdateRef = useRef(0);

  // Premium UI Hover & Active Line refs
  const isHoveringRef = useRef(false);
  const priceLineRef = useRef(null);
  const hudOpenRef = useRef(null);
  const hudHighRef = useRef(null);
  const hudLowRef = useRef(null);
  const hudCloseRef = useRef(null);
  const hudChangeRef = useRef(null);
  const hudIndicatorsRef = useRef(null);

  const updatePriceGlowLine = (priceVal) => {
    const activePrice = priceVal !== undefined ? priceVal : useTradeStore.getState().livePrice;
    if (!chartInstance.current || !candlestickSeriesRef.current || activePrice === null || !priceLineRef.current) return;
    const y = candlestickSeriesRef.current.priceToCoordinate(activePrice);
    const currentHeight = window.innerWidth < 768 ? 320 : 540;
    if (y !== null && y >= 0 && y <= currentHeight) {
      priceLineRef.current.style.transform = `translateY(${y}px)`;
      priceLineRef.current.style.display = 'block';
    } else {
      priceLineRef.current.style.display = 'none';
    }
  };

  const showLatestCandleHUD = () => {
    if (!candlesHistoryRef.current || candlesHistoryRef.current.length === 0) return;
    const latest = candlesHistoryRef.current[candlesHistoryRef.current.length - 1];
    if (latest) {
      const open = latest.open;
      const high = latest.high;
      const low = latest.low;
      const close = latest.close;
      const diff = close - open;
      const pct = (diff / open) * 100;
      const isUp = diff >= 0;

      const dec = selectedSymbol === 'XAGUSD' ? 4 : 2;
      if (hudOpenRef.current) hudOpenRef.current.innerText = open.toFixed(dec);
      if (hudHighRef.current) hudHighRef.current.innerText = high.toFixed(dec);
      if (hudLowRef.current) hudLowRef.current.innerText = low.toFixed(dec);
      if (hudCloseRef.current) hudCloseRef.current.innerText = close.toFixed(dec);
      if (hudChangeRef.current) {
        hudChangeRef.current.innerText = `${isUp ? '+' : ''}${diff.toFixed(dec)} (${isUp ? '+' : ''}${pct.toFixed(2)}%)`;
        hudChangeRef.current.className = `text-xs font-black font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`;
      }
      if (hudIndicatorsRef.current) {
        hudIndicatorsRef.current.innerText = '';
      }
    }
  };


  // Dynamic theme variables
  const currentTheme = selectedIndicatorSystem;

  // Trading session detection — read hour directly from Date, no store dependency
  const localHour = new Date().getHours();

  const getSessionStatus = (session) => {
    switch (session) {
      case 'Sydney':
        // Sydney session: 07:00 - 16:00 UTC+7
        return localHour >= 7 && localHour < 16;
      case 'Tokyo':
        // Tokyo session: 08:00 - 17:00 UTC+7
        return localHour >= 8 && localHour < 17;
      case 'London':
        // London session: 14:00 - 23:00 UTC+7
        return localHour >= 14 && localHour < 23;
      case 'New York':
        // NY session: 19:00 - 04:00 (next day) UTC+7
        return localHour >= 19 || localHour < 4;
      default:
        return false;
    }
  };

  // Realtime Feeds & connection details updates without recreating chart
  useEffect(() => {
    if (indicator1SeriesRef.current && candlesHistoryRef.current.length > 0) {
      const data = calculateIndicatorData(candlesHistoryRef.current, ind1Type, ind1Period);
      indicator1SeriesRef.current.setData(data);
      indicator1SeriesRef.current.applyOptions({
        color: ind1Color,
        visible: showInd1 && ind1Type !== 'None'
      });
    }
  }, [ind1Type, ind1Period, ind1Color, showInd1]);

  useEffect(() => {
    if (indicator2SeriesRef.current && candlesHistoryRef.current.length > 0) {
      const data = calculateIndicatorData(candlesHistoryRef.current, ind2Type, ind2Period);
      indicator2SeriesRef.current.setData(data);
      indicator2SeriesRef.current.applyOptions({
        color: ind2Color,
        visible: showInd2 && ind2Type !== 'None'
      });
    }
  }, [ind2Type, ind2Period, ind2Color, showInd2]);

  // Dynamic RSI Color/Visibility
  useEffect(() => {
    if (rsiSeriesRef.current) {
      rsiSeriesRef.current.applyOptions({
        color: rsiColor,
        visible: showRsi && rsiType !== 'None'
      });
    }
  }, [rsiColor, showRsi, rsiType]);

  // Dynamic MACD Colors/Visibility
  useEffect(() => {
    if (macdLineSeriesRef.current && macdSignalSeriesRef.current && macdHistSeriesRef.current) {
      const visible = showMacd && macdType !== 'None';
      macdLineSeriesRef.current.applyOptions({ visible, color: macdColor });
      macdSignalSeriesRef.current.applyOptions({ visible });
      macdHistSeriesRef.current.applyOptions({ visible });
    }
  }, [macdColor, showMacd, macdType]);

  // Dynamic Candlestick Color Theme Updates
  useEffect(() => {
    if (candlestickSeriesRef.current) {
      const isTraditional = candleColorTheme === 'traditional';
      const up = isTraditional ? '#26a69a' : '#ca8a04';
      const down = isTraditional ? '#ef5350' : '#7f1d1d';
      candlestickSeriesRef.current.applyOptions({
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      });
    }
  }, [candleColorTheme]);

  // Subscribe to utcTime from store, write to DOM directly — no re-render
  React.useEffect(() => {
    const unsub = useTradeStore.subscribe((state) => {
      if (chartClockDomRef.current && state.utcTime) {
        chartClockDomRef.current.textContent = state.utcTime.split(' ')[0];
      }
    });
    return unsub;
  }, []);

  // Sockets feed
  useEffect(() => {
    if (!isLoggedIn) return;

    // Fetch user settings
    useTradeStore.getState().fetchUserSettings();

    const token = localStorage.getItem('auth_token');
    const socket = io(SOCKET_URL, {
      auth: { token }
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus(true);
      console.log('Socket connected');
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      if (err.message.includes('Authentication error')) {
        logout();
        setLoginError('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
      }
    });

    socket.on('disconnect', () => {
      setConnectionStatus(false);
      console.log('Socket disconnected');
    });

    // Receive drawings from another device of same user (cloud sync)
    socket.on('drawings:updated', (payload) => {
      const state = useTradeStore.getState();
      if (payload?.symbol === state.selectedSymbol && Array.isArray(payload?.drawings)) {
        setDrawings(payload.drawings);
      }
    });

    socket.on('initial_signals', (initialSignalsData) => {
      setSignals(initialSignalsData);
    });

    socket.on('global_signal_history_updated', (payload) => {
      if (!Array.isArray(payload?.records)) return;
      const previousIds = new Set(readSignalHistory().map(record => record.id));
      const newSignals = payload.records.filter(record => record.outcome === 'running' && !previousIds.has(record.id));
      replaceSignalHistory(payload.records);
      newSignals.forEach((record) => {
        useTradeStore.getState().addToast({
          ticker: record.symbol,
          system: record.indicatorLabel,
          interval: record.timeframe,
          action: record.action,
          entry: record.entry,
          sl: record.sl,
          tps: record.tps,
          confidence: record.confidence,
          timestamp: record.signalTime
        });
      });
      if (newSignals.length > 0) playNotificationSound();
    });

    socket.on('signal_update', (updatedSignal) => {
      setSignals(prev => {
        const oldSignal = prev[updatedSignal.ticker]?.[updatedSignal.interval];
        // Only show pop-up notifications and play sound for new signals generated while online
        // Skip pop-ups for signals that exist during the first 5 seconds of loading/refreshing
        const isInitialLoad = (Date.now() - pageLoadTimeRef.current) < 5000;

        // If it's a completely new signal, play sound and show toast
        if (!isInitialLoad && updatedSignal.action !== 'stale' && (!oldSignal || oldSignal.timestamp !== updatedSignal.timestamp)) {
          const sym = updatedSignal.ticker || updatedSignal.symbol;
          if (sym === 'XAUUSD' && !isSignalLocked()) {
            playNotificationSound();
            useTradeStore.getState().addToast(updatedSignal);
          }
        }
        return {
          ...prev,
          [updatedSignal.ticker]: {
            ...prev[updatedSignal.ticker],
            [updatedSignal.interval]: updatedSignal
          }
        };
      });
    });


    socket.on('price_update', (data) => {
      const state = useTradeStore.getState();
      const currentSelectedSymbol = state.selectedSymbol;
      if (data.ticker === currentSelectedSymbol) {
        // Use the store action so the exact signal shown on the dashboard also
        // receives its SL/TP lifecycle transition before the next signal.
        state.setLivePrice(data.currentPrice);
        // Update price DOM directly — NO React re-render
        if (livePriceDomRef.current) {
          livePriceDomRef.current.textContent = `$${data.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
        }
        requestAnimationFrame(() => updatePriceGlowLine(data.currentPrice));
      }
    });

    socket.on('candle_update', (data) => {
      const state = useTradeStore.getState();
      const currentSelectedSymbol = state.selectedSymbol;
      const currentSelectedTimeframe = state.selectedTimeframe;

      // Only calculate indicators and update chart if it matches currently selected symbol AND timeframe
      if (data.ticker === currentSelectedSymbol && data.interval === currentSelectedTimeframe) {
        if (candlestickSeriesRef.current && candlesHistoryRef.current && candlesHistoryRef.current.length > 0) {
          const history = candlesHistoryRef.current;
          const lastCandle = history[history.length - 1];
          let updated = false;
          let isNewCandle = false;

          if (lastCandle.time === data.candle.time) {
            lastCandle.close = data.candle.close;
            lastCandle.high = data.candle.high;
            lastCandle.low = data.candle.low;
            updated = true;
          } else if (data.candle.time > lastCandle.time) {
            history.push(data.candle);
            if (history.length > 200) history.shift();
            updated = true;
            isNewCandle = true;
          }

          if (updated) {
            if (isNewCandle) {
              useTradeStore.getState().setCandlesHistory([...history]);
              // Only bump historyCount on actual new candle (triggers signal recalc)
              setHistoryCount(prev => prev + 1);
            }
            candlestickSeriesRef.current.update(data.candle);
            if (!isHoveringRef.current) {
              showLatestCandleHUD();
            }
            if (drawCanvasRef.current) {
              requestAnimationFrame(() => drawCanvasRef.current());
            }

            // PERFORMANCE: throttle indicator recalculation to max once per 500ms
            const now = Date.now();
            if (now - lastIndicatorUpdateRef.current < 500) return;
            lastIndicatorUpdateRef.current = now;

            const activeState = useTradeStore.getState();
            const {
              ind1Type, ind1Period, ind2Type, ind2Period, rsiType, rsiPeriod, macdType, macdFast, macdSlow, macdSignal,
              selectedIndicatorSystem, zenFastPeriod, zenSlowPeriod, utBotKeyValue, utBotAtrPeriod,
              chandelierAtrPeriod, chandelierAtrMultiplier, trendlineLength, trendlineSlopeMult
            } = activeState;

            // Realtime Indicator Updates
            if (indicator1SeriesRef.current && ind1Type !== 'None') {
              const ind1Data = calculateIndicatorData(history, ind1Type, ind1Period);
              if (ind1Data.length > 0) {
                indicator1SeriesRef.current.update(ind1Data[ind1Data.length - 1]);
              }
            }

            if (indicator2SeriesRef.current && ind2Type !== 'None') {
              const ind2Data = calculateIndicatorData(history, ind2Type, ind2Period);
              if (ind2Data.length > 0) {
                indicator2SeriesRef.current.update(ind2Data[ind2Data.length - 1]);
              }
            }

            if (rsiSeriesRef.current && rsiType !== 'None') {
              const rsiData = calculateRSI(history, rsiPeriod);
              if (rsiData.length > 0) {
                rsiSeriesRef.current.update(rsiData[rsiData.length - 1]);
              }
            }

            if (macdLineSeriesRef.current && macdSignalSeriesRef.current && macdHistSeriesRef.current && macdType !== 'None') {
              const macdData = calculateMACD(history, macdFast, macdSlow, macdSignal);
              if (macdData.length > 0) {
                const last = macdData[macdData.length - 1];
                macdLineSeriesRef.current.update({ time: last.time, value: last.macd });
                macdSignalSeriesRef.current.update({ time: last.time, value: last.signal });
                macdHistSeriesRef.current.update({
                  time: last.time,
                  value: last.histogram,
                  color: last.histogram >= 0 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
                });
              }
            }

            // Realtime Custom Indicators Updates
            if (selectedIndicatorSystem === 'zen') {
              if (zenFastSeriesRef.current && zenSlowSeriesRef.current) {
                const zenTrendData = calculateZenTrendLines(history, zenFastPeriod, zenSlowPeriod);
                if (zenTrendData.length > 0) {
                  const last = zenTrendData[zenTrendData.length - 1];
                  zenFastSeriesRef.current.update({ time: last.time, value: last.fast });
                  zenSlowSeriesRef.current.update({ time: last.time, value: last.slow });
                }
              }
            } else if (selectedIndicatorSystem === 'utbot') {
              if (utBotTrailingStopSeriesRef.current) {
                const utBotData = calculateUTBotSignals(history, utBotKeyValue, utBotAtrPeriod);
                if (utBotData.length > 0) {
                  const last = utBotData[utBotData.length - 1];
                  if (last.trailingStop !== null) {
                    utBotTrailingStopSeriesRef.current.update({ time: last.time, value: last.trailingStop });
                  }

                  // Re-apply markers
                  const markers = [];
                  utBotData.forEach(d => {
                    if (d.buy) {
                      markers.push({
                        time: d.time,
                        position: 'belowBar',
                        color: '#10b981',
                        shape: 'arrowUp',
                        text: 'BUY',
                        size: 1
                      });
                    } else if (d.sell) {
                      markers.push({
                        time: d.time,
                        position: 'aboveBar',
                        color: '#ef4444',
                        shape: 'arrowDown',
                        text: 'SELL',
                        size: 1
                      });
                    }
                  });
                  candlestickSeriesRef.current.setMarkers(markers);
                }
              }
            } else if (selectedIndicatorSystem === 'chandelier') {
              if (chandelierLongStopSeriesRef.current && chandelierShortStopSeriesRef.current) {
                const chandelierData = calculateChandelierExit(history, chandelierAtrPeriod, chandelierAtrMultiplier);
                if (chandelierData.length > 0) {
                  const last = chandelierData[chandelierData.length - 1];
                  if (last.longStop !== null) {
                    chandelierLongStopSeriesRef.current.update({ time: last.time, value: last.longStop });
                  }
                  if (last.shortStop !== null) {
                    chandelierShortStopSeriesRef.current.update({ time: last.time, value: last.shortStop });
                  }

                  // Re-apply markers
                  const markers = [];
                  chandelierData.forEach(d => {
                    if (d.buy) {
                      markers.push({
                        time: d.time,
                        position: 'belowBar',
                        color: '#10b981',
                        shape: 'arrowUp',
                        text: 'BUY',
                        size: 1
                      });
                    } else if (d.sell) {
                      markers.push({
                        time: d.time,
                        position: 'aboveBar',
                        color: '#ef4444',
                        shape: 'arrowDown',
                        text: 'SELL',
                        size: 1
                      });
                    }
                  });
                  candlestickSeriesRef.current.setMarkers(markers);
                }
              }
            } else if (selectedIndicatorSystem === 'trendline') {
              if (trendlineUpperSeriesRef.current && trendlineLowerSeriesRef.current) {
                const trendlineData = calculateTrendlinesWithBreaks(history, trendlineLength, trendlineSlopeMult);
                if (trendlineData.length > 0) {
                  const last = trendlineData[trendlineData.length - 1];
                  trendlineUpperSeriesRef.current.update({ time: last.time, value: last.upper });
                  trendlineLowerSeriesRef.current.update({ time: last.time, value: last.lower });

                  // Re-apply markers
                  const markers = [];
                  trendlineData.forEach(d => {
                    if (d.buyAtBreakout && d.breakoutTime) {
                      markers.push({
                        time: d.breakoutTime,
                        position: 'belowBar',
                        color: '#26a69a',
                        shape: 'labelUp',
                        text: 'B',
                        size: 1
                      });
                    } else if (d.sellAtBreakout && d.breakoutTime) {
                      markers.push({
                        time: d.breakoutTime,
                        position: 'aboveBar',
                        color: '#ef5350',
                        shape: 'labelDown',
                        text: 'B',
                        size: 1
                      });
                    }
                  });
                  candlestickSeriesRef.current.setMarkers(markers);
                }
              }
            }
          }
        }
      }
    });

    return () => {
      socket.disconnect();
    };
    // selectedSymbol/selectedTimeframe intentionally excluded: every handler above reads
    // the latest values via useTradeStore.getState() at event time, so the socket itself
    // doesn't need to reconnect when the user just switches symbol/timeframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Main & Sub Charts Rendering
  useEffect(() => {
    if (!isLoggedIn || !chartContainerRef.current) return;

    candlesHistoryRef.current = [];
    useTradeStore.getState().setCandlesHistory([]);

    const chartTopColor = selectedIndicatorSystem === 'zen'
      ? '#030d0a'
      : selectedIndicatorSystem === 'utbot'
      ? '#050314'
      : selectedIndicatorSystem === 'chandelier'
      ? '#0a0502'
      : '#020b14';
    const chartBottomColor = selectedIndicatorSystem === 'zen'
      ? '#000101'
      : selectedIndicatorSystem === 'utbot'
      ? '#000102'
      : selectedIndicatorSystem === 'chandelier'
      ? '#000000'
      : '#000102';
    const chartGridColor = selectedIndicatorSystem === 'zen'
      ? 'rgba(16, 185, 129, 0.18)'
      : selectedIndicatorSystem === 'utbot'
      ? 'rgba(139, 92, 246, 0.18)'
      : selectedIndicatorSystem === 'chandelier'
      ? 'rgba(245, 158, 11, 0.18)'
      : 'rgba(6, 182, 212, 0.18)';
    const textColor = selectedIndicatorSystem === 'zen'
      ? '#10b981'
      : selectedIndicatorSystem === 'utbot'
      ? '#a855f7'
      : selectedIndicatorSystem === 'chandelier'
      ? '#f59e0b'
      : '#06b6d4';
    const crosshairLineColor = selectedIndicatorSystem === 'zen'
      ? 'rgba(16, 185, 129, 0.25)'
      : selectedIndicatorSystem === 'utbot'
      ? 'rgba(139, 92, 246, 0.25)'
      : selectedIndicatorSystem === 'chandelier'
      ? 'rgba(245, 158, 11, 0.25)'
      : 'rgba(6, 182, 212, 0.25)';
    const crosshairBg = selectedIndicatorSystem === 'zen'
      ? '#022c22'
      : selectedIndicatorSystem === 'utbot'
      ? '#2e1065'
      : selectedIndicatorSystem === 'chandelier'
      ? '#451a03'
      : '#083344';
    const borderColor = selectedIndicatorSystem === 'zen'
      ? 'rgba(16, 185, 129, 0.12)'
      : selectedIndicatorSystem === 'utbot'
      ? 'rgba(139, 92, 246, 0.12)'
      : selectedIndicatorSystem === 'chandelier'
      ? 'rgba(245, 158, 11, 0.12)'
      : 'rgba(6, 182, 212, 0.12)';

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: textColor,
        fontSize: 11,
        fontFamily: 'Inter, sans-serif',
      },
      grid: {
        vertLines: { color: chartGridColor, style: LineStyle.Solid },
        horzLines: { color: chartGridColor, style: LineStyle.Solid },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: crosshairLineColor, labelBackgroundColor: crosshairBg, width: 1, style: LineStyle.Dashed },
        horzLine: { color: crosshairLineColor, labelBackgroundColor: crosshairBg, width: 1, style: LineStyle.Dashed },
      },
      watermark: {
        visible: false,
        text: '',
      },
      // Enable pinch-to-zoom (trackpad + touch), scroll wheel, and horizontal touch drag
      handleScale: {
        pinch: true,
        mouseWheel: true,
        axisPressedMouseMove: { time: true, price: true },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      rightPriceScale: { borderColor: borderColor, visible: true, entireTextOnly: true },
      timeScale: { borderColor: borderColor, timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth,
      height: window.innerWidth < 768 ? 320 : 540,
    });

    if (canvasRef.current) {
      canvasRef.current.width = chartContainerRef.current.clientWidth;
      canvasRef.current.height = window.innerWidth < 768 ? 320 : 540;
    }


    const isTraditional = useTradeStore.getState().candleColorTheme === 'traditional';
    const initialUpColor = isTraditional ? '#26a69a' : '#ca8a04';
    const initialDownColor = isTraditional ? '#ef5350' : '#7f1d1d';

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: initialUpColor,
      downColor: initialDownColor,
      borderVisible: true,
      borderUpColor: initialUpColor,
      borderDownColor: initialDownColor,
      wickUpColor: initialUpColor,
      wickDownColor: initialDownColor,
    });

    const indicator1Series = chart.addLineSeries({
      color: ind1Color,
      lineWidth: 2,
      priceLineVisible: false,
      visible: showInd1 && ind1Type !== 'None',
    });

    const indicator2Series = chart.addLineSeries({
      color: ind2Color,
      lineWidth: 2,
      priceLineVisible: false,
      visible: showInd2 && ind2Type !== 'None',
    });

    const zenFastSeries = chart.addLineSeries({
      color: '#10b981',
      lineWidth: 2,
      priceLineVisible: false,
      visible: selectedIndicatorSystem === 'zen',
    });

    const zenSlowSeries = chart.addLineSeries({
      color: '#ca8a04',
      lineWidth: 2,
      priceLineVisible: false,
      visible: selectedIndicatorSystem === 'zen',
    });

    const utBotTrailingStopSeries = chart.addLineSeries({
      color: '#f43f5e',
      lineWidth: 2,
      priceLineVisible: false,
      visible: selectedIndicatorSystem === 'utbot',
    });

    const chandelierLongStopSeries = chart.addLineSeries({
      color: '#10b981',
      lineWidth: 2,
      priceLineVisible: false,
      visible: selectedIndicatorSystem === 'chandelier',
    });

    const chandelierShortStopSeries = chart.addLineSeries({
      color: '#ef4444',
      lineWidth: 2,
      priceLineVisible: false,
      visible: selectedIndicatorSystem === 'chandelier',
    });

    const trendlineUpperSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      priceLineVisible: false,
      visible: selectedIndicatorSystem === 'trendline',
    });

    const trendlineLowerSeries = chart.addLineSeries({
      color: '#ef4444',
      lineWidth: 2,
      priceLineVisible: false,
      visible: selectedIndicatorSystem === 'trendline',
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      requestAnimationFrame(() => updatePriceGlowLine());
    });

    chart.subscribeCrosshairMove((param) => {
      if (!hudOpenRef.current || !hudHighRef.current || !hudLowRef.current || !hudCloseRef.current || !hudChangeRef.current) return;

      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current?.clientWidth ||
        param.point.y < 0 ||
        param.point.y > (window.innerWidth < 768 ? 320 : 540)
      ) {
        isHoveringRef.current = false;
        showLatestCandleHUD();
      } else {
        isHoveringRef.current = true;
        const candle = param.seriesData.get(candlestickSeries);
        if (candle) {
          const open = candle.open;
          const high = candle.high;
          const low = candle.low;
          const close = candle.close;

          const diff = close - open;
          const pct = (diff / open) * 100;
          const isUp = diff >= 0;

          const dec = selectedSymbol === 'XAGUSD' ? 4 : 2;
          hudOpenRef.current.innerText = open.toFixed(dec);
          hudHighRef.current.innerText = high.toFixed(dec);
          hudLowRef.current.innerText = low.toFixed(dec);
          hudCloseRef.current.innerText = close.toFixed(dec);

          hudChangeRef.current.innerText = `${isUp ? '+' : ''}${diff.toFixed(dec)} (${isUp ? '+' : ''}${pct.toFixed(2)}%)`;
          hudChangeRef.current.className = `text-xs font-black font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`;

          // Indicators
          if (hudIndicatorsRef.current) {
            let indParts = [];
            if (showInd1 && ind1Type !== 'None') {
              const val = param.seriesData.get(indicator1Series);
              if (val && val.value !== undefined) {
                indParts.push(`${ind1Type}(${ind1Period}): ${val.value.toFixed(2)}`);
              }
            }
            if (showInd2 && ind2Type !== 'None') {
              const val = param.seriesData.get(indicator2Series);
              if (val && val.value !== undefined) {
                indParts.push(`${ind2Type}(${ind2Period}): ${val.value.toFixed(2)}`);
              }
            }
            if (selectedIndicatorSystem === 'zen') {
              const fVal = param.seriesData.get(zenFastSeries);
              const sVal = param.seriesData.get(zenSlowSeries);
              if (fVal && fVal.value !== undefined) indParts.push(`Fast: ${fVal.value.toFixed(2)}`);
              if (sVal && sVal.value !== undefined) indParts.push(`Slow: ${sVal.value.toFixed(2)}`);
            } else if (selectedIndicatorSystem === 'utbot') {
              const tsVal = param.seriesData.get(utBotTrailingStopSeries);
              if (tsVal && tsVal.value !== undefined) indParts.push(`Stop: ${tsVal.value.toFixed(2)}`);
            } else if (selectedIndicatorSystem === 'chandelier') {
              const lVal = param.seriesData.get(chandelierLongStopSeries);
              const sVal = param.seriesData.get(chandelierShortStopSeries);
              if (lVal && lVal.value !== undefined) indParts.push(`Long: ${lVal.value.toFixed(2)}`);
              if (sVal && sVal.value !== undefined) indParts.push(`Short: ${sVal.value.toFixed(2)}`);
            }

            if (indParts.length > 0) {
              hudIndicatorsRef.current.innerText = indParts.join(' | ');
              hudIndicatorsRef.current.style.display = 'block';
            } else {
              hudIndicatorsRef.current.style.display = 'none';
            }
          }
        }
      }
    });

    chartInstance.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    indicator1SeriesRef.current = indicator1Series;
    indicator2SeriesRef.current = indicator2Series;

    zenFastSeriesRef.current = zenFastSeries;
    zenSlowSeriesRef.current = zenSlowSeries;
    utBotTrailingStopSeriesRef.current = utBotTrailingStopSeries;
    chandelierLongStopSeriesRef.current = chandelierLongStopSeries;
    chandelierShortStopSeriesRef.current = chandelierShortStopSeries;
    trendlineUpperSeriesRef.current = trendlineUpperSeries;
    trendlineLowerSeriesRef.current = trendlineLowerSeries;

    let rsiChart = null;
    let rsiSeries = null;
    if (showRsi && rsiType !== 'None' && rsiChartContainerRef.current) {
      rsiChart = createChart(rsiChartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: textColor,
          fontSize: 11,
          fontFamily: 'Inter, sans-serif',
        },

        grid: {
          vertLines: { color: chartGridColor, style: LineStyle.Solid },
          horzLines: { color: chartGridColor, style: LineStyle.Solid },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: borderColor, visible: true, entireTextOnly: true },
        timeScale: { visible: false },
        width: rsiChartContainerRef.current.clientWidth,
        height: 110,
      });

      rsiSeries = rsiChart.addLineSeries({
        color: rsiColor,
        lineWidth: 1.5,
        priceLineVisible: false,
      });

      rsiSeries.createPriceLine({ price: 70, color: '#7f1d1d', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'OB (70)' });
      rsiSeries.createPriceLine({ price: 30, color: '#ca8a04', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'OS (30)' });

      rsiChartInstance.current = rsiChart;
      rsiSeriesRef.current = rsiSeries;
    }

    let macdChart = null;
    let macdLineSeries = null;
    let macdSignalSeries = null;
    let macdHistSeries = null;
    if (showMacd && macdType !== 'None' && macdChartContainerRef.current) {
      macdChart = createChart(macdChartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: textColor,
          fontSize: 11,
          fontFamily: 'Inter, sans-serif',
        },

        grid: {
          vertLines: { color: chartGridColor, style: LineStyle.Solid },
          horzLines: { color: chartGridColor, style: LineStyle.Solid },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: borderColor, visible: true, entireTextOnly: true },
        timeScale: { visible: false },
        width: macdChartContainerRef.current.clientWidth,
        height: 120,
      });

      macdLineSeries = macdChart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 1.5,
        priceLineVisible: false,
      });

      macdSignalSeries = macdChart.addLineSeries({
        color: '#ef4444',
        lineWidth: 1.5,
        priceLineVisible: false,
      });

      macdHistSeries = macdChart.addHistogramSeries({
        color: '#10b981',
        priceFormat: { type: 'volume' },
        priceLineVisible: false,
      });

      macdChartInstance.current = macdChart;
      macdLineSeriesRef.current = macdLineSeries;
      macdSignalSeriesRef.current = macdSignalSeries;
      macdHistSeriesRef.current = macdHistSeries;
    }

    const mainTimeScale = chart.timeScale();
    const rsiTimeScale = rsiChart?.timeScale();
    const macdTimeScale = macdChart?.timeScale();

    if (rsiTimeScale) {
      mainTimeScale.subscribeVisibleTimeRangeChange((range) => {
        if (range) rsiTimeScale.setVisibleRange(range);
      });
      rsiTimeScale.subscribeVisibleTimeRangeChange((range) => {
        if (range) mainTimeScale.setVisibleRange(range);
      });
    }

    if (macdTimeScale) {
      mainTimeScale.subscribeVisibleTimeRangeChange((range) => {
        if (range) macdTimeScale.setVisibleRange(range);
      });
      macdTimeScale.subscribeVisibleTimeRangeChange((range) => {
        if (range) mainTimeScale.setVisibleRange(range);
      });
    }

    mainTimeScale.subscribeVisibleTimeRangeChange(() => {
      if (drawCanvasRef.current) {
        requestAnimationFrame(() => drawCanvasRef.current());
      }
    });

    const token = localStorage.getItem('auth_token');
    fetch(`${SOCKET_URL}/api/history/${selectedSymbol}/${selectedTimeframe}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => {
        if (res.status === 401) {
          logout();
          throw new Error('Session expired');
        }
        return res.json();
      })
      .then(data => {
        const rawHistory = data.history || [];
        if (data.active) rawHistory.push(data.active);

        rawHistory.sort((a, b) => a.time - b.time);

        const history = [];
        for (const item of rawHistory) {
          if (history.length === 0 || history[history.length - 1].time !== item.time) {
            history.push(item);
          } else {
            history[history.length - 1] = item;
          }
        }

        candlestickSeries.setData(history);
        candlesHistoryRef.current = history;
        useTradeStore.getState().setCandlesHistory(history);
        setHistoryCount(prev => prev + 1);
        showLatestCandleHUD();
        requestAnimationFrame(() => updatePriceGlowLine());


        const ind1Data = calculateIndicatorData(history, ind1Type, ind1Period);
        const ind2Data = calculateIndicatorData(history, ind2Type, ind2Period);
        indicator1Series.setData(ind1Data);
        indicator2Series.setData(ind2Data);

        if (selectedIndicatorSystem === 'zen') {
          const zenTrendData = calculateZenTrendLines(history, zenFastPeriod, zenSlowPeriod);
          zenFastSeries.setData(zenTrendData.map(d => ({ time: d.time, value: d.fast })));
          zenSlowSeries.setData(zenTrendData.map(d => ({ time: d.time, value: d.slow })));
        } else if (selectedIndicatorSystem === 'utbot') {
          const utBotData = calculateUTBotSignals(history, utBotKeyValue, utBotAtrPeriod);
          utBotTrailingStopSeries.setData(utBotData.filter(d => d.trailingStop !== null).map(d => ({ time: d.time, value: d.trailingStop })));

          const markers = [];
          utBotData.forEach(d => {
            if (d.buy) {
              markers.push({
                time: d.time,
                position: 'belowBar',
                color: '#10b981',
                shape: 'arrowUp',
                text: 'BUY',
                size: 1
              });
            } else if (d.sell) {
              markers.push({
                time: d.time,
                position: 'aboveBar',
                color: '#ef4444',
                shape: 'arrowDown',
                text: 'SELL',
                size: 1
              });
            }
          });
          candlestickSeries.setMarkers(markers);
        } else if (selectedIndicatorSystem === 'chandelier') {
          const chandelierData = calculateChandelierExit(history, chandelierAtrPeriod, chandelierAtrMultiplier);
          chandelierLongStopSeries.setData(chandelierData.filter(d => d.longStop !== null).map(d => ({ time: d.time, value: d.longStop })));
          chandelierShortStopSeries.setData(chandelierData.filter(d => d.shortStop !== null).map(d => ({ time: d.time, value: d.shortStop })));

          const markers = [];
          chandelierData.forEach(d => {
            if (d.buy) {
              markers.push({
                time: d.time,
                position: 'belowBar',
                color: '#10b981',
                shape: 'arrowUp',
                text: 'BUY',
                size: 1
              });
            } else if (d.sell) {
              markers.push({
                time: d.time,
                position: 'aboveBar',
                color: '#ef4444',
                shape: 'arrowDown',
                text: 'SELL',
                size: 1
              });
            }
          });
          candlestickSeries.setMarkers(markers);
        } else if (selectedIndicatorSystem === 'trendline') {
          const trendlineData = calculateTrendlinesWithBreaks(history, trendlineLength, trendlineSlopeMult);
          trendlineUpperSeries.setData(trendlineData.filter(d => d.upper !== null).map(d => ({ time: d.time, value: d.upper })));
          trendlineLowerSeries.setData(trendlineData.filter(d => d.lower !== null).map(d => ({ time: d.time, value: d.lower })));

          const markers = [];
          trendlineData.forEach(d => {
            if (d.buyAtBreakout && d.breakoutTime) {
              markers.push({
                time: d.breakoutTime,
                position: 'belowBar',
                color: '#26a69a',
                shape: 'labelUp',
                text: 'B',
                size: 1
              });
            } else if (d.sellAtBreakout && d.breakoutTime) {
              markers.push({
                time: d.breakoutTime,
                position: 'aboveBar',
                color: '#ef5350',
                shape: 'labelDown',
                text: 'B',
                size: 1
              });
            }
          });
          candlestickSeries.setMarkers(markers);
        }

        if (rsiSeries) {
          const rsiData = calculateRSI(history, rsiPeriod);
          rsiSeries.setData(rsiData);
        }

        if (macdLineSeries && macdSignalSeries && macdHistSeries) {
          const macdData = calculateMACD(history, macdFast, macdSlow, macdSignal);
          macdLineSeries.setData(macdData.map(d => ({ time: d.time, value: d.macd })));
          macdSignalSeries.setData(macdData.map(d => ({ time: d.time, value: d.signal })));
          macdHistSeries.setData(macdData.map(d => ({
            time: d.time,
            value: d.histogram,
            color: d.histogram >= 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'
          })));
        }

        if (showSmc && smcType !== 'None') {
          const smcResult = calculateSMC(history);
          if (smcResult.bos) {
            candlestickSeries.createPriceLine({
              price: smcResult.bos,
              color: smcBosColor,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: 'BOS',
            });
          }
          if (smcResult.choch) {
            candlestickSeries.createPriceLine({
              price: smcResult.choch,
              color: smcChochColor,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: 'CHoCH',
            });
          }
        }
        if (drawCanvasRef.current) {
          requestAnimationFrame(() => drawCanvasRef.current());
        }
      })
      .catch(err => console.error('Failed loading history:', err));

    const handleResize = () => {
      const w = chartContainerRef.current?.clientWidth;
      if (w) {
        const h = window.innerWidth < 768 ? 320 : 540;
        chart.applyOptions({ width: w, height: h });
        rsiChart?.applyOptions({ width: w });
        macdChart?.applyOptions({ width: w });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      if (rsiChart) rsiChart.remove();
      if (macdChart) macdChart.remove();
    };
  }, [
    selectedSymbol, selectedTimeframe, isLoggedIn, showRsi, rsiType, showMacd, macdType, showSmc, smcType, smcBosColor, smcChochColor,
    selectedIndicatorSystem, zenFastPeriod, zenSlowPeriod, utBotKeyValue, utBotAtrPeriod,
    chandelierAtrPeriod, chandelierAtrMultiplier, trendlineLength, trendlineSlopeMult
  ]);

  // Re-theme the chart instances in place so zoom, drawings and live series stay intact.
  useEffect(() => {
    const isLight = backgroundTheme === 'light';
    const textColor = isLight ? '#475569' : (
      selectedIndicatorSystem === 'zen' ? '#6ee7b7'
        : selectedIndicatorSystem === 'utbot' ? '#d8b4fe'
          : selectedIndicatorSystem === 'chandelier' ? '#fcd34d' : '#67e8f9'
    );
    const gridColor = isLight ? 'rgba(148, 163, 184, 0.24)' : (
      selectedIndicatorSystem === 'zen' ? 'rgba(16,185,129,0.12)'
        : selectedIndicatorSystem === 'utbot' ? 'rgba(168,85,247,0.12)'
          : selectedIndicatorSystem === 'chandelier' ? 'rgba(245,158,11,0.12)' : 'rgba(6,182,212,0.12)'
    );
    const borderColor = isLight ? 'rgba(100, 116, 139, 0.36)' : gridColor;
    const crosshairColor = isLight ? 'rgba(51, 65, 85, 0.52)' : textColor;
    const labelBackground = isLight ? '#334155' : '#111827';
    const commonOptions = {
      layout: {
        background: { type: ColorType.Solid, color: isLight ? '#fcfdff' : 'transparent' },
        textColor,
        fontSize: isLight ? 12 : 11,
        fontFamily: 'Inter, sans-serif',
      },
      grid: {
        vertLines: { color: gridColor, style: LineStyle.Solid },
        horzLines: { color: gridColor, style: LineStyle.Solid },
      },
      rightPriceScale: { borderColor },
      timeScale: { borderColor },
    };

    chartInstance.current?.applyOptions({
      ...commonOptions,
      crosshair: {
        mode: 1,
        vertLine: { color: crosshairColor, labelBackgroundColor: labelBackground, width: 1, style: LineStyle.Dashed },
        horzLine: { color: crosshairColor, labelBackgroundColor: labelBackground, width: 1, style: LineStyle.Dashed },
      },
    });
    rsiChartInstance.current?.applyOptions(commonOptions);
    macdChartInstance.current?.applyOptions(commonOptions);
  }, [backgroundTheme, selectedIndicatorSystem, showRsi, showMacd]);

  // Sync latest signal with Zustand store so that App.jsx can read it
  // NOTE: livePrice intentionally excluded from deps — signal should only update
  // when a new candle CLOSES (historyCount changes), not on every live tick.
  const currentSignal = useTradeStore(state => state.currentSignal) || { action: 'stale', entry: 0, sl: 0, tp: 0, confidence: 0 };
  const historyCount = useTradeStore(state => state.historyCount);

  useEffect(() => {
    const history = candlesHistoryRef.current || [];
    const sig = getCurrentSignal({
      history,
      selectedSymbol,
      selectedIndicatorSystem,
      zenFastPeriod,
      zenSlowPeriod,
      utBotKeyValue,
      utBotAtrPeriod,
      chandelierAtrPeriod,
      chandelierAtrMultiplier,
      trendlineLength,
      trendlineSlopeMult,
    });

    // ── Signal Lock Guard ──────────────────────────────────────────────────
    // If a signal is currently RUNNING (not yet hit SL or full TP2), do NOT
    // overwrite it with a new signal. This prevents the signal panel from
    // jumping to a different signal when the user switches indicators or
    // timeframes, or when a new candle closes with a different signal.
    const existing = useTradeStore.getState().currentSignal;
    const isSameSystem = existing
      && existing.symbol === selectedSymbol
      && existing.timeframe === selectedTimeframe
      && existing.indicatorSystem === selectedIndicatorSystem;

    const isExistingActive = isSameSystem
      && existing.action !== 'stale'
      && existing.status !== 'closed'
      && existing.status !== 'finished'
      && existing.status !== 'sl';

    if (isExistingActive) {
      // Same signal (same entry + timestamp) — update hitTps & status only
      // so the progress bar still reflects TP1 hits in real-time
      if (sig && sig.entry === existing.entry && sig.timestamp === existing.timestamp) {
        const displayedSignal = { ...existing, hitTps: sig.hitTps, status: sig.status };
        useTradeStore.setState({
          currentSignal: displayedSignal
        });
      }
      // Different signal entirely — ignore it, keep the running signal
    } else {
      // No active signal or signal is finished or user changed indicator/timeframe/symbol — allow normal overwrite
      const displayedSignal = sig ? {
        ...sig,
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
        indicatorSystem: selectedIndicatorSystem
      } : null;
      useTradeStore.setState({ currentSignal: displayedSignal });
    }
  }, [
    selectedSymbol,
    selectedTimeframe,
    selectedIndicatorSystem,
    zenFastPeriod,
    zenSlowPeriod,
    utBotKeyValue,
    utBotAtrPeriod,
    chandelierAtrPeriod,
    chandelierAtrMultiplier,
    trendlineLength,
    trendlineSlopeMult,
    historyCount
  ]);

  const getCardColorClass = (action) => {
    if (action === 'buy') return 'glow-amber border-amber-500/35 bg-gradient-to-b from-[#1c1408] to-[#0c0905] shadow-[0_0_30px_rgba(234,179,8,0.06)]';
    if (action === 'sell') return 'glow-amber border-red-900/35 bg-gradient-to-b from-[#1c0a0a] to-[#0c0505] shadow-[0_0_30px_rgba(239,68,68,0.04)]';
    return 'glow-amber border-amber-500/20 bg-gradient-to-b from-[#0f0f12] to-[#0a0a0c]';
  };

  const formatTimestamp = (ts) => {
    const d = new Date(ts);
    const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${timeStr} ${dateStr}`;
  };

  const formatPrice = (val) => {
    if (val === undefined || val === null || isNaN(val) || val === 0 || currentSignal.action === 'stale') return '---';
    const dec = selectedSymbol === 'XAGUSD' ? 4 : 2;
    return val.toFixed(dec);
  };

  const visualSignalStatus = computeSignalStatus(currentSignal, useTradeStore.getState().livePrice);
  const visualSignalResult = visualSignalStatus === 'tp'
    ? 'win'
    : visualSignalStatus === 'sl'
      ? 'loss'
      : ['closed', 'finished'].includes(currentSignal.status)
        ? 'finished'
        : 'active';

  return (
    <>
      <ToastContainer />
      {/* ── Keyboard Shortcut Toast Hint ── */}
      {keyHint && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-xl bg-black/80 border border-amber-500/30 text-amber-400 text-xs font-black shadow-[0_0_20px_rgba(234,179,8,0.15)] backdrop-blur-xl pointer-events-none animate-fadeIn">
          {keyHint}
        </div>
      )}

      {/* ── LEFT PANEL: Signal Card + Live Trading Board ── */}
      {/* Desktop: always show. Mobile: only show when mobileTab === 'signal' */}
      <div className={`lg:order-none w-full lg:w-[22%] lg:min-w-[260px] flex-shrink-0 flex flex-col gap-4 lg:gap-6 ${
        mobileTab === 'signal' ? 'flex order-2' : mobileTab === 'chart' ? 'hidden lg:flex order-2' : 'hidden lg:flex order-2'
      }`}>
        {/* 1. SELL/BUY SIGNAL DETAIL CARD - Redesigned */}
        <div
          data-signal-result={visualSignalResult}
          className="static-copy-surface signal-detail-card panel-primary rounded-2xl flex flex-col relative overflow-hidden transition-all duration-500"
        >

          {/* Subtle neon direction glow aura */}
          <div className={`signal-ambient-aura absolute -top-16 -right-16 w-56 h-56 rounded-full filter blur-[80px] pointer-events-none opacity-20 transition-colors duration-700 ${
            currentSignal.action === 'buy' ? 'bg-amber-500' :
            currentSignal.action === 'sell' ? 'bg-red-500' : 'bg-slate-500'
          }`} />

          {/* ── HEADER: Segmented asset/live feed info ── */}
          <div className="flex justify-between items-center px-3 lg:px-5 py-3 lg:py-4 border-b border-white/[0.06] bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-white tracking-widest font-mono">{selectedSymbol}</span>
              <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded text-[11px] font-mono font-black tracking-widest">{selectedTimeframe}</span>
            </div>

            <SignalStatusBadge signal={currentSignal} />
          </div>

          {/* ── HERO ZONE: Technical action arrow ── */}
          <div className="px-3 lg:px-5 py-4 lg:py-6 flex items-end gap-4">
            <div className={`h-14 w-14 shrink-0 rounded-2xl flex items-center justify-center border transition-all duration-500 relative group overflow-hidden ${
              currentSignal.action === 'buy'
                ? 'bg-gradient-to-br from-amber-500/10 to-yellow-600/5 border-amber-500/30 text-amber-400 shadow-[0_0_25px_rgba(234,179,8,0.2)]'
                : currentSignal.action === 'sell'
                ? 'bg-gradient-to-br from-red-500/10 to-rose-600/5 border-red-500/30 text-red-400 shadow-[0_0_25px_rgba(239,68,68,0.2)]'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}>
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              {currentSignal.action === 'buy' ? (
                <ChevronsUp className="h-7 w-7 animate-arrow-up-stream text-amber-400" />
              ) : currentSignal.action === 'sell' ? (
                <ChevronsDown className="h-7 w-7 animate-arrow-down-stream text-red-400" />
              ) : (
                <Clock className="h-7 w-7 text-slate-500" />
              )}
            </div>
            <div className="text-center flex-1 flex flex-col justify-end">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">{t('latestDetails')}</span>
              
              <HeroActionDisplay currentSignal={currentSignal} />
            </div>
          </div>

          {/* ── PARAMETERS & METRIC AREA ── */}
          <div className="px-3 lg:px-5 pb-4 lg:pb-5 flex flex-col gap-4 lg:gap-5">
            {currentSignal && currentSignal.action !== 'stale' && (
              <TimeAgoDisplay timestamp={currentSignal.timestamp} />
            )}
            <div className="divide-y divide-white/[0.05] panel-surface rounded-2xl overflow-hidden">
              {/* Entry Price */}
              <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-900/20 transition-all duration-300">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{t('entryPrice')}</span>
                </div>
                <span className="text-base font-sans font-black text-white tracking-tighter">{formatPrice(currentSignal.entry)}</span>
              </div>

              {/* Stop Loss (SL) */}
              <div className="flex items-center justify-between px-4 py-3 hover:bg-red-950/5 transition-all duration-300">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{t('stopLoss')}</span>
                </div>
                <span className="text-base font-sans font-black text-red-400 tracking-tighter">{formatPrice(currentSignal.sl)}</span>
              </div>

              {/* Take Profit (TP) */}
              {(currentSignal.tps || [currentSignal.tp]).map((tpVal, idx, arr) => {
                if (!tpVal) return null;
                const status = computeSignalStatus(currentSignal, useTradeStore.getState().livePrice);
                let isHit = false;
                if (idx === 0 && (status === 'tp1' || status === 'tp')) isHit = true;
                if (idx === 1 && status === 'tp') isHit = true;
                
                // Backup: if live price hasn't triggered it but the backend confirmed it was hit
                if (!isHit && currentSignal.hitTps) {
                  isHit = currentSignal.hitTps[idx];
                }
                const label = arr.length > 1 ? `${t('takeProfit')} ${idx + 1}` : t('takeProfit');
                const hitText = idx === 0 && arr.length > 1 ? 'TP1' : idx === 1 ? 'TP2' : 'HIT';
                const labelColorCls = isHit && idx === 0 && arr.length > 1 ? 'text-blue-400' : isHit ? 'text-emerald-400' : 'text-slate-400';
                const valueColorCls = idx === 0 && arr.length > 1 ? 'text-blue-400' : 'text-emerald-400'; // Always color the value
                const bgCls = isHit && idx === 0 && arr.length > 1 ? 'bg-blue-400 shadow-[0_0_8px_#60a5fa]' : isHit ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : idx === 0 && arr.length > 1 ? 'bg-blue-500' : 'bg-emerald-500';
                
                return (
                  <div key={idx} className={`flex items-center justify-between px-4 py-2.5 hover:bg-slate-900/20 transition-all duration-300 ${isHit ? 'bg-white/[0.02]' : ''}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${bgCls}`} />
                      <span className={`text-[11px] font-black uppercase tracking-wider ${labelColorCls}`}>{label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {isHit && (
                        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border border-dashed ${idx === 0 && arr.length > 1 ? 'border-blue-500/50 bg-blue-500/10 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.15)]' : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]'}`}>
                          <svg className="w-3.5 h-3.5 drop-shadow-[0_0_3px_currentColor]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          <span className="text-[10px] font-black uppercase tracking-widest">{hitText}</span>
                        </div>
                      )}
                      <span className={`text-base font-sans font-black tracking-tighter ${valueColorCls}`}>{formatPrice(tpVal)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── LIVE PRICE POSITION GAUGE (SL ↔ live ↔ TP) ── */}
            {currentSignal.action !== 'stale' && (
              <div className="panel-surface p-3 rounded-2xl">
                <SignalProgressBar signal={currentSignal} symbol={selectedSymbol} />
              </div>
            )}

            {/* ── CONFIDENCE PROGRESS METER (Glow Led Indicator) ── */}
            <div className="space-y-2 text-left panel-surface p-3 rounded-2xl">
              <div className="flex justify-between items-center text-[11px] font-black text-slate-400 uppercase tracking-wider">
                <span>{t('confidence')}</span>
                <span className={`font-mono font-black ${
                  currentSignal.action === 'sell' ? 'text-red-400' : 'text-amber-400'
                }`}>{currentSignal.confidence}%</span>
              </div>
              <div className="w-full bg-slate-900/50 h-1.5 rounded-full relative overflow-visible">
                <div
                  className={`h-full rounded-full transition-all duration-700 relative overflow-visible ${
                    currentSignal.action === 'sell'
                      ? 'bg-gradient-to-r from-red-600 to-red-400'
                      : 'bg-gradient-to-r from-amber-500 to-amber-300'
                  }`}
                  style={{ width: `${currentSignal.confidence}%` }}
                >
                  {/* Glow pulsing light at the edge of the bar */}
                  {currentSignal.confidence > 0 && (
                    <span className={`absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full filter blur-[1px] animate-ping ${
                      currentSignal.action === 'sell' ? 'bg-red-400' : 'bg-amber-400'
                    }`} />
                  )}
                  {currentSignal.confidence > 0 && (
                    <span className={`absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${
                      currentSignal.action === 'sell' ? 'bg-red-400 shadow-[0_0_8px_#ef4444]' : 'bg-amber-400 shadow-[0_0_8px_#ea580c]'
                    }`} />
                  )}
                </div>
              </div>
            </div>

            {/* ── TECHNICAL STATS GRID FOOTER ── */}
            <div className="border-t border-white/[0.06] pt-4 space-y-3 text-left">
              {/* Strength Index */}
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-extrabold uppercase tracking-widest">STRENGTH INDEX</span>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, idx) => {
                    const active = currentSignal.confidence >= (idx + 1) * 20;
                    return (
                      <Star
                        key={idx}
                        className={`h-3.5 w-3.5 ${
                          active ? 'fill-amber-400 text-amber-400' : 'fill-slate-900 text-slate-800'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* CENTER COLUMN: CHARTS FEED */}
      {/* Desktop: always show. Mobile: only show when mobileTab === 'chart' */}
      <div className={`chart-copy-surface lg:order-none w-full lg:flex-1 flex flex-col gap-6 ${
        mobileTab === 'chart' || !mobileTab ? 'flex order-1' : 'hidden lg:flex order-1'
      }`}>

        {/* Chart Wrapper — Aurora Nebula panel */}
        <div className="space-panel-heavy rounded-2xl lg:rounded-3xl px-2 lg:px-5 py-3 lg:py-4 flex flex-col justify-start gap-2 lg:gap-3 relative overflow-hidden"
          style={{ border: '1px solid rgba(202, 138, 4, 0.18)' }}>

          {/* Chart Title Overlay */}
          <div className="chart-header-copy flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2.5">
            {/* LEFT: Title + 3 compact dropdowns */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black text-white tracking-wide">TradingView Live Feed</span>


              {/* Live Spot Price Badge */}
              <div className="flex items-baseline gap-1.5 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg text-[11px] font-black text-amber-500 font-mono shadow-[0_0_10px_rgba(234,179,8,0.05)]">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{t('spotPrice')}</span>
                <span className="text-glow-gold" ref={livePriceDomRef}>---</span>
              </div>

              {/* Live status dot */}
              <span className="flex items-center gap-1.5">
                <span className="flex h-2 w-2 relative">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${connectionStatus ? 'bg-sky-400' : 'bg-red-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${connectionStatus ? 'bg-sky-500' : 'bg-red-500'}`}></span>
                </span>
                <span className="text-[10px] font-black text-sky-400 font-mono" ref={chartClockDomRef}>--:--:--</span>
              </span>
            </div>

            {/* RIGHT: Candle color toggles + Sessions Status on mobile */}
            <div className="flex items-center gap-2 mt-1 sm:mt-0 flex-wrap justify-end">
              {/* Candle color toggles */}
              <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] p-0.5 rounded-lg">
                <button
                  onClick={() => setCandleColorTheme('premium')}
                  className={`px-2 py-0.5 rounded text-[11px] font-black transition-all ${candleColorTheme === 'premium' ? 'bg-amber-500 text-black font-black' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Premium
                </button>
                <button
                  onClick={() => setCandleColorTheme('traditional')}
                  className={`px-2 py-0.5 rounded text-[11px] font-black transition-all ${candleColorTheme === 'traditional' ? 'bg-emerald-500 text-white font-black' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  MetaTrader5
                </button>
              </div>

              {/* Sessions Status — ONLY visible on mobile (placed next to color toggles) */}
              <div className="flex md:hidden items-center gap-1">
                {['Sydney', 'Tokyo', 'London', 'New York'].map(session => {
                  const open = getSessionStatus(session);
                  return (
                    <span key={session} data-session-open={open ? 'true' : 'false'}
                      className={`chart-session-badge px-1.5 py-0.5 rounded border text-[9px] font-black tracking-wide uppercase transition-all duration-300 ${
                        open ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-950/40 border-zinc-900/60 text-slate-600'
                      }`}>
                      {session.slice(0, 3)}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* TOOLBAR + SESSIONS — 1 hàng ngang trên chart (Desktop: showing toolbar + sessions, Mobile: showing selectors row) */}
          <div className="flex flex-col gap-2.5 mb-2.5">
            {/* Row 2: Drawing Toolbar (Desktop) & Sessions (Desktop) */}
            <div className="flex flex-row flex-wrap items-center justify-between gap-3">
              {/* Drawing Toolbar — horizontal */}
              {showDrawingToolbar && (
                <div className="drawing-toolbar hidden md:flex flex-row items-center gap-1 bg-[#060b18]/60 px-2 py-1 rounded-xl border border-slate-800/40 select-none shadow-[0_2px_16px_rgba(0,0,0,0.4)]">
                  <button onClick={() => setActiveTool('cursor')}
                    className={`w-7 h-7 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${activeTool === 'cursor' ? 'bg-amber-500/15 border-amber-500/50 text-amber-500' : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-amber-500 hover:border-amber-500/35 hover:bg-amber-500/5'}`}
                    title="Con trỏ chuột"><MousePointer className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setActiveTool('trendline')}
                    className={`w-7 h-7 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${activeTool === 'trendline' ? 'bg-amber-500/15 border-amber-500/50 text-amber-500' : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-amber-500 hover:border-amber-500/35 hover:bg-amber-500/5'}`}
                    title="Đường xu hướng"><Slash className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setActiveTool('horizontal')}
                    className={`w-7 h-7 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${activeTool === 'horizontal' ? 'bg-amber-500/15 border-amber-500/50 text-amber-500' : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-amber-500 hover:border-amber-500/35 hover:bg-amber-500/5'}`}
                    title="Đường nằm ngang"><Minus className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setActiveTool('fib')}
                    className={`w-7 h-7 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${activeTool === 'fib' ? 'bg-amber-500/15 border-amber-500/50 text-amber-500' : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-amber-500 hover:border-amber-500/35 hover:bg-amber-500/5'}`}
                    title="Fibonacci"><Grid className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setActiveTool('rectangle')}
                    className={`w-7 h-7 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${activeTool === 'rectangle' ? 'bg-amber-500/15 border-amber-500/50 text-amber-500' : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-amber-500 hover:border-amber-500/35 hover:bg-amber-500/5'}`}
                    title="Hình chữ nhật"><Square className="h-3.5 w-3.5" /></button>
                  <div className="h-5 w-[1px] bg-zinc-800/60 mx-1" />
                  <button onClick={handleUndo}
                    className="w-7 h-7 rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:text-amber-500 hover:border-amber-500/35 hover:bg-amber-500/5 transition-all cursor-pointer flex items-center justify-center"
                    title="Hoàn tác (Ctrl+Z)"><Undo className="h-3.5 w-3.5" /></button>
                  <button onClick={() => { setDrawings([]); setActiveTool('cursor'); }}
                    className="drawing-danger-tool w-7 h-7 rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-500 hover:text-red-400 hover:border-red-500/35 hover:bg-red-500/10 transition-all cursor-pointer flex items-center justify-center"
                    title="Xóa tất cả"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )}

              {/* Sessions Status — ONLY visible on desktop/tablet (md+) */}
              <div className="hidden md:flex flex-wrap items-center gap-1.5">
                {['Sydney', 'Tokyo', 'London', 'New York'].map(session => {
                  const open = getSessionStatus(session);
                  return (
                    <span key={session} data-session-open={open ? 'true' : 'false'}
                      className={`chart-session-badge px-2 py-0.5 rounded border text-[11px] font-black tracking-wide uppercase transition-all duration-300 ${
                        open ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-950/40 border-zinc-900/60 text-slate-600'
                      }`}>
                      {session.slice(0, 3)}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Mobile Quick Selectors: ONLY visible on screens < lg (mobile/tablet). Centered, wider, sharp borders with golden glow */}
            <div className="grid lg:hidden grid-cols-3 gap-2 w-full p-1.5 bg-[#050914]/90 border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.18)] hover:shadow-[0_0_25px_rgba(245,158,11,0.3)] hover:border-amber-500/50 rounded-xl transition-all duration-500">
              {/* Timeframe Select */}
              <div className="relative">
                <select
                  value={selectedTimeframe}
                  onChange={(e) => setSelectedTimeframe(e.target.value)}
                  className="w-full bg-[#03060f] border border-amber-500/20 hover:border-amber-500/40 focus:border-amber-500 text-amber-400 hover:text-amber-300 rounded-lg px-2 py-1.5 text-[11px] font-black uppercase font-mono focus:outline-none cursor-pointer transition-all appearance-none text-center shadow-[0_0_5px_rgba(245,158,11,0.04)] focus:shadow-[0_0_12px_rgba(245,158,11,0.25)]"
                  title="Khung thời gian"
                >
                  {['M1', 'M5', 'M15', 'H1'].map(tf => (
                    <option key={tf} value={tf} className="bg-[#0b0f19] text-white">{tf}</option>
                  ))}
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-amber-500/80 text-[8px]">▼</div>
              </div>

              {/* Asset Select */}
              <div className="relative">
                <select
                  value={selectedSymbol}
                  onChange={(e) => {
                    setSelectedSymbol(e.target.value);
                    const setLivePrice = useTradeStore.getState().setLivePrice;
                    if (setLivePrice) setLivePrice(null);
                  }}
                  className="w-full bg-[#03060f] border border-amber-500/20 hover:border-amber-500/40 focus:border-amber-500 text-amber-400 hover:text-amber-300 rounded-lg px-2 py-1.5 text-[11px] font-black uppercase font-mono focus:outline-none cursor-pointer transition-all appearance-none text-center shadow-[0_0_5px_rgba(245,158,11,0.04)] focus:shadow-[0_0_12px_rgba(245,158,11,0.25)]"
                  title="Chọn cặp tài sản"
                >
                  {['XAUUSD', 'WTIUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'].map(sym => (
                    <option key={sym} value={sym} className="bg-[#0b0f19] text-white">{sym}</option>
                  ))}
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-amber-500/80 text-[8px]">▼</div>
              </div>

              {/* Indicator Select */}
              <div className="relative">
                <select
                  value={selectedIndicatorSystem}
                  onChange={(e) => setSelectedIndicatorSystem(e.target.value)}
                  className="w-full bg-[#03060f] border border-amber-500/20 hover:border-amber-500/40 focus:border-amber-500 text-amber-400 hover:text-amber-300 rounded-lg px-2 py-1.5 text-[11px] font-black uppercase font-mono focus:outline-none cursor-pointer transition-all appearance-none text-center truncate pr-5 shadow-[0_0_5px_rgba(245,158,11,0.04)] focus:shadow-[0_0_12px_rgba(245,158,11,0.25)]"
                  title="Hệ thống chỉ báo"
                >
                  <option value="zen" className="bg-[#0b0f19] text-white">MTF Trend PA</option>
                  <option value="utbot" className="bg-[#0b0f19] text-white">UT Bot</option>
                  <option value="chandelier" className="bg-[#0b0f19] text-white">Chandelier</option>
                  <option value="trendline" className="bg-[#0b0f19] text-white">Trendlines</option>
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-amber-500/80 text-[8px]">▼</div>
              </div>
            </div>
          </div>

          {/* Charts Stack */}
          <div className="w-full">

            {/* Main Candlestick Chart Container Wrapper with transparent grid and overlays */}
            <div className="chart-frame relative rounded-xl overflow-hidden w-full transition-all duration-500"
              style={{
                background: 'transparent',
                border: '1px solid var(--theme-accent-border, rgba(168,85,247,0.18))',
                boxShadow: '0 0 0 0.5px rgba(255,255,255,0.02) inset, 0 0 40px var(--theme-accent-bg-light, rgba(168,85,247,0.06)) inset',
              }}>

              <div ref={chartContainerRef} className="w-full relative bg-transparent" />

              {/* DRAWING CANVAS OVERLAY */}
              {showDrawingToolbar && (
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  className={`absolute inset-0 z-20 ${
                    activeTool === 'cursor' ? 'pointer-events-none' : 'pointer-events-auto cursor-crosshair'
                  }`}
                />
              )}

              {/* Floating HUD (Symbol, OHLC and Indicator Legend) */}
              <div className="chart-hud absolute top-2.5 left-3 z-20 flex flex-col items-start gap-1 pointer-events-none select-none text-xs text-slate-400">
                {/* Row 1: Symbol & OHLC parameters */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-1">
                    <span className="text-white font-black">{selectedSymbol}</span>
                    <span className="text-amber-500 font-black font-mono text-[11px]">{selectedTimeframe}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <div>O<span ref={hudOpenRef} className="font-sans text-white ml-0.5 font-bold">---</span></div>
                    <div>H<span ref={hudHighRef} className="font-sans text-white ml-0.5 font-bold">---</span></div>
                    <div>L<span ref={hudLowRef} className="font-sans text-white ml-0.5 font-bold">---</span></div>
                    <div>C<span ref={hudCloseRef} className="font-sans text-white ml-0.5 font-bold">---</span></div>
                    <div ref={hudChangeRef} className="font-sans font-bold">---</div>
                  </div>
                  <div ref={hudIndicatorsRef} className="text-slate-500 font-sans text-[11px] pl-2 border-l border-zinc-850 hidden md:block">
                    {/* Dynamic indicators */}
                  </div>
                </div>

                {/* Row 2: Indicator Legends */}
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span className="text-slate-400 normal-case">{t('champagneCandles')}</span>
                  </div>
                  {showInd1 && ind1Type !== 'None' && (
                    <div className="flex items-center gap-1.5">
                      <span className="h-[1.5px] w-3" style={{ backgroundColor: ind1Color }} />
                      <span className="text-slate-400 font-mono normal-case">{ind1Type} ({ind1Period})</span>
                    </div>
                  )}
                  {showInd2 && ind2Type !== 'None' && (
                    <div className="flex items-center gap-1.5">
                      <span className="h-[1.5px] w-3" style={{ backgroundColor: ind2Color }} />
                      <span className="text-slate-400 font-mono normal-case">{ind2Type} ({ind2Period})</span>
                    </div>
                  )}
                  {showSmc && smcType !== 'None' && (
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded ${selectedIndicatorSystem === 'zen' ? 'bg-emerald-500' : 'bg-purple-500'}`} />
                      <span className="text-slate-400 font-mono normal-case">Smart Money Concept (SMC)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Active Price Line Glow Overlay */}
              <div ref={priceLineRef} className="absolute left-0 right-[56px] h-[1px] pointer-events-none hidden z-10" style={{ top: 0 }}>
                <div className="price-glow-line" />
                <div className="price-glow-dot" />
              </div>
            </div>

            {/* ── MOBILE FAB: Floating drawing tools button (mobile only) ── */}
            <div className="md:hidden">
              {/* FAB Toggle Button */}
              <button
                onClick={() => setShowMobileFAB(prev => !prev)}
                className={`fixed bottom-[80px] right-4 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-[0_4px_24px_rgba(0,0,0,0.6)] border transition-all duration-200 active:scale-90 ${
                  showMobileFAB || activeTool !== 'cursor'
                    ? 'bg-amber-500 border-amber-400 text-black shadow-[0_0_20px_rgba(234,179,8,0.4)]'
                    : 'bg-black/60 border-white/[0.12] text-slate-300'
                }`}
                aria-label="Drawing tools"
              >
                <PenTool className="h-5 w-5" />
              </button>

              {/* FAB Tray — slide up above FAB */}
              {showMobileFAB && (
                <div className="fixed bottom-[140px] right-4 z-50 flex flex-col items-center gap-2">
                  {/* Clear All */}
                  <button onClick={() => { setDrawings([]); setActiveTool('cursor'); setShowMobileFAB(false); }}
                    className="w-11 h-11 rounded-full bg-black/60 border border-red-900/50 text-red-400 shadow-lg flex items-center justify-center active:scale-90 transition-all"
                    title="Xóa tất cả">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  {/* Undo */}
                  <button onClick={() => { handleUndo(); }}
                    className="w-11 h-11 rounded-full bg-black/60 border border-white/[0.12] text-slate-300 shadow-lg flex items-center justify-center active:scale-90 transition-all"
                    title="Hoàn tác">
                    <Undo className="h-4 w-4" />
                  </button>
                  {/* Rectangle */}
                  <button onClick={() => { setActiveTool('rectangle'); setShowMobileFAB(false); }}
                    className={`w-11 h-11 rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-all border ${
                      activeTool === 'rectangle' ? 'bg-amber-500 border-amber-400 text-black' : 'bg-black/60 border-white/[0.12] text-slate-300'
                    }`} title="Hình chữ nhật">
                    <Square className="h-4 w-4" />
                  </button>
                  {/* Fibonacci */}
                  <button onClick={() => { setActiveTool('fib'); setShowMobileFAB(false); }}
                    className={`w-11 h-11 rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-all border ${
                      activeTool === 'fib' ? 'bg-amber-500 border-amber-400 text-black' : 'bg-black/60 border-white/[0.12] text-slate-300'
                    }`} title="Fibonacci">
                    <Grid className="h-4 w-4" />
                  </button>
                  {/* Horizontal */}
                  <button onClick={() => { setActiveTool('horizontal'); setShowMobileFAB(false); }}
                    className={`w-11 h-11 rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-all border ${
                      activeTool === 'horizontal' ? 'bg-amber-500 border-amber-400 text-black' : 'bg-black/60 border-white/[0.12] text-slate-300'
                    }`} title="Đường nằm ngang">
                    <Minus className="h-4 w-4" />
                  </button>
                  {/* Trendline */}
                  <button onClick={() => { setActiveTool('trendline'); setShowMobileFAB(false); }}
                    className={`w-11 h-11 rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-all border ${
                      activeTool === 'trendline' ? 'bg-amber-500 border-amber-400 text-black' : 'bg-black/60 border-white/[0.12] text-slate-300'
                    }`} title="Đường xu hướng">
                    <Slash className="h-4 w-4" />
                  </button>
                  {/* Cursor */}
                  <button onClick={() => { setActiveTool('cursor'); setShowMobileFAB(false); }}
                    className={`w-11 h-11 rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-all border ${
                      activeTool === 'cursor' ? 'bg-amber-500 border-amber-400 text-black' : 'bg-black/60 border-white/[0.12] text-slate-300'
                    }`} title="Con trỏ">
                    <MousePointer className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>


            {/* RSI Chart Pane (Conditional) */}
            {showRsi && rsiType !== 'None' && (
              <div className="relative mt-3 p-3 bg-slate-950/40 border border-zinc-900 rounded-2xl text-left">
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-black text-amber-500 uppercase tracking-wider">
                    <Activity className="h-3.5 w-3.5" />
                    <span>RSI ({rsiPeriod})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-500 uppercase">{t('lineColor') + ":"}</span>
                    <div className="flex gap-1">
                      {['#eab308', '#10b981', '#3b82f6', '#ef4444', '#ca8a04'].map(c => (
                        <button
                          key={c}
                          onClick={() => setRsiColor(c)}
                          className={`w-2.5 h-2.5 rounded-full border ${rsiColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div ref={rsiChartContainerRef} className="w-full h-24 relative rounded-xl overflow-hidden" />
              </div>
            )}

            {/* MACD Chart Pane (Conditional) */}
            {showMacd && macdType !== 'None' && (
              <div className="relative mt-3 p-3 bg-slate-950/40 border border-zinc-900 rounded-2xl text-left">
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-black text-amber-500 uppercase tracking-wider">
                    <Sliders className="h-3.5 w-3.5" />
                    <span>MACD ({macdFast}, {macdSlow}, {macdSignal})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-500 uppercase">{t('lineColor') + ":"}</span>
                    <div className="flex gap-1">
                      {['#3b82f6', '#10b981', '#ef4444', '#ca8a04', '#eab308'].map(c => (
                        <button
                          key={c}
                          onClick={() => setMacdColor(c)}
                          className={`w-2.5 h-2.5 rounded-full border ${macdColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div ref={macdChartContainerRef} className="w-full h-28 relative rounded-xl overflow-hidden" />
              </div>
            )}
            
            

          </div>
        </div>

        <SignalHistoryPanel />
      </div>
    </>
  );
}

export default TradingChart;
