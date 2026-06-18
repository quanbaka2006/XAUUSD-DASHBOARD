import React, { useEffect, useRef, useMemo } from 'react';
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
  Undo,
  Brain,
  Shield
} from 'lucide-react';
import { useTradeStore, SOCKET_URL } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';
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
  if (livePrice == null || isNaN(livePrice) || livePrice === 0) return 'running';
  if (signal.action === 'sell') {
    if (livePrice <= signal.tp) return 'tp';
    if (livePrice >= signal.sl) return 'sl';
  } else if (signal.action === 'buy') {
    if (livePrice >= signal.tp) return 'tp';
    if (livePrice <= signal.sl) return 'sl';
  }
  return 'running';
}

const STATUS_META = {
  running: { vn: 'ĐANG CHẠY', en: 'ACTIVE', cls: 'text-emerald-200 bg-emerald-500/20 border-emerald-300/50 shadow-[0_0_20px_rgba(16,185,129,0.45)]', dot: 'bg-emerald-300' },
  tp:      { vn: 'ĐÃ CHẠM TP', en: 'TP HIT', cls: 'text-emerald-100 bg-emerald-400/30 border-emerald-200/70 shadow-[0_0_26px_rgba(16,185,129,0.7)]', dot: 'bg-emerald-200' },
  sl:      { vn: 'ĐÃ CHẠM SL', en: 'SL HIT', cls: 'text-rose-100 bg-rose-500/30 border-rose-200/70 shadow-[0_0_26px_rgba(244,63,94,0.7)]', dot: 'bg-rose-200' },
  none:    { vn: 'HẾT HIỆU LỰC', en: 'EXPIRED', cls: 'text-slate-300 bg-slate-500/15 border-slate-400/30', dot: 'bg-slate-400' },
};

// Small isolated component: only THIS re-renders on each price tick (not the whole chart)
function SignalStatusBadge({ signal }) {
  const livePrice = useTradeStore(s => s.livePrice);
  const { language } = useTranslation();
  const status = computeSignalStatus(signal, livePrice);
  const m = STATUS_META[status];
  const running = status === 'running';
  return (
    <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black tracking-widest uppercase border ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full inline-block ${m.dot} ${running ? 'animate-ping' : ''}`} />
      {language === 'en' ? m.en : m.vn}
    </span>
  );
}

// Live price position between SL and TP — vivid visual gauge
function SignalProgressBar({ signal, symbol }) {
  const livePrice = useTradeStore(s => s.livePrice);
  const { language } = useTranslation();
  if (!signal || signal.action === 'stale' || !signal.entry || !signal.sl || !signal.tp) return null;
  const dec = symbol === 'XAGUSD' ? 4 : 2;
  const lo = Math.min(signal.sl, signal.tp);
  const hi = Math.max(signal.sl, signal.tp);
  const span = (hi - lo) || 1;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const entryPct = clamp(((signal.entry - lo) / span) * 100);
  const hasPrice = livePrice != null && !isNaN(livePrice) && livePrice !== 0;
  const pricePct = hasPrice ? clamp(((livePrice - lo) / span) * 100) : entryPct;
  const tpAtRight = signal.tp >= signal.sl; // buy: TP is the high end (right); sell: TP is the low end (left)
  const trackGradient = tpAtRight
    ? 'linear-gradient(90deg, rgba(244,63,94,0.55), rgba(148,163,184,0.18) 50%, rgba(16,185,129,0.6))'
    : 'linear-gradient(90deg, rgba(16,185,129,0.6), rgba(148,163,184,0.18) 50%, rgba(244,63,94,0.55))';
  const leftVal = tpAtRight ? signal.sl : signal.tp;
  const rightVal = tpAtRight ? signal.tp : signal.sl;
  return (
    <div className="px-1 pt-1">
      <div className="flex justify-between text-[10px] font-black tracking-wider mb-1.5">
        <span className={tpAtRight ? 'text-rose-400' : 'text-emerald-400'}>{tpAtRight ? 'SL' : 'TP'} {leftVal.toFixed(dec)}</span>
        <span className="text-amber-300/90 uppercase">{language === 'en' ? 'Live' : 'Giá hiện tại'}</span>
        <span className={tpAtRight ? 'text-emerald-400' : 'text-rose-400'}>{tpAtRight ? 'TP' : 'SL'} {rightVal.toFixed(dec)}</span>
      </div>
      <div className="relative h-2.5 rounded-full" style={{ background: trackGradient }}>
        {/* entry marker */}
        <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-[3px] h-4 bg-white/80 rounded-full" style={{ left: `${entryPct}%` }} />
        {/* live price marker */}
        <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.95)]" style={{ left: `${pricePct}%` }} />
      </div>
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

    socket.on('signal_update', (updatedSignal) => {
      setSignals(prev => ({
        ...prev,
        [updatedSignal.ticker]: {
          ...prev[updatedSignal.ticker],
          [updatedSignal.interval]: updatedSignal
        }
      }));
    });

    socket.on('price_update', (data) => {
      const state = useTradeStore.getState();
      const currentSelectedSymbol = state.selectedSymbol;
      if (data.ticker === currentSelectedSymbol) {
        // Write to store for any other consumers (e.g. signal calc)
        useTradeStore.setState({ livePrice: data.currentPrice });
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

          if (lastCandle.time === data.candle.time) {
            lastCandle.close = data.candle.close;
            lastCandle.high = data.candle.high;
            lastCandle.low = data.candle.low;
            updated = true;
          } else if (data.candle.time > lastCandle.time) {
            history.push(data.candle);
            if (history.length > 200) history.shift();
            updated = true;
          }

          if (updated) {
            // Only sync Zustand store on new candle open (not every tick) — avoids re-renders
            const isNewCandle = data.candle.time > (history[history.length - 2]?.time ?? 0);
            if (isNewCandle) {
              useTradeStore.getState().setCandlesHistory([...history]);
              // Only bump historyCount on actual new candle (triggers signal recalc)
              setHistoryCount(prev => prev + 1);
            }
            candlestickSeriesRef.current.update(data.candle);
            if (!isHoveringRef.current) {
              showLatestCandleHUD();
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
                  chandelierLongStopSeriesRef.current.update({ time: last.time, value: last.longStop });
                  chandelierShortStopSeriesRef.current.update({ time: last.time, value: last.shortStop });

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

  // Sync latest signal with Zustand store so that App.jsx can read it
  // NOTE: livePrice intentionally excluded from deps — signal should only update
  // when a new candle CLOSES (historyCount changes), not on every live tick.
  const currentSignal = useMemo(() => {
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

    // Defer the Zustand state update to prevent React render warnings (updating store while rendering)
    setTimeout(() => {
      useTradeStore.setState({ currentSignal: sig });
    }, 0);

    return sig;
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
    // livePrice intentionally removed — entry/SL/TP must be stable after signal fires
    useTradeStore((state) => state.historyCount)
  ]);

  const psychologyScore = useMemo(() => {
    if (!currentSignal || currentSignal.action === 'stale') {
      return {
        discipline: 50,
        patience: 50,
        emotionalControl: 50,
        focus: 50,
        total: 50,
        label: 'Bình thường',
        color: 'text-slate-400',
        strokeColor: '#64748b'
      };
    }

    // 1. Kỷ luật (Discipline): based on signal confidence
    const discipline = currentSignal.confidence || 75;

    // 2. Kiên nhẫn (Patience): based on how long since the signal was generated (age).
    const ageMs = Date.now() - (currentSignal.timestamp || Date.now());
    const ageMins = Math.max(0, ageMs / 60000);
    let patience = Math.max(50, Math.min(95, Math.round(95 - (ageMins / 2))));
    if (isNaN(patience)) patience = 75;

    // 3. Kiểm soát cảm xúc (Emotional Control): based on R:R ratio (Reward-to-Risk ratio)
    const risk = Math.abs(currentSignal.entry - currentSignal.sl);
    const reward = Math.abs(currentSignal.tp - currentSignal.entry);
    const rr = risk > 0 ? (reward / risk) : 2.0;
    
    let emotionalControl = 90;
    if (rr >= 1.8 && rr <= 2.2) {
      emotionalControl = 95;
    } else if (rr < 1.0) {
      emotionalControl = Math.max(40, Math.round(40 + rr * 30));
    } else if (rr > 3.0) {
      emotionalControl = Math.max(50, Math.round(95 - (rr - 2.0) * 15));
    } else {
      emotionalControl = Math.round(90 - Math.abs(rr - 2.0) * 20);
    }
    if (isNaN(emotionalControl)) emotionalControl = 80;

    // 4. Tập trung (Focus): based on trend strength and timeframe noise level
    let focus = 80;
    if (selectedTimeframe === 'M1') focus = 70;
    else if (selectedTimeframe === 'M5') focus = 75;
    else if (selectedTimeframe === 'M15') focus = 82;
    else if (selectedTimeframe === 'H1') focus = 90;
    else if (selectedTimeframe === 'H4') focus = 96;

    if (selectedIndicatorSystem === 'zen') focus += 3;
    if (selectedIndicatorSystem === 'trendline') focus -= 2;
    
    focus = Math.max(40, Math.min(98, focus));

    // Weighted average:
    const total = Math.round(
      discipline * 0.35 +
      patience * 0.25 +
      emotionalControl * 0.25 +
      focus * 0.15
    );

    let label = 'Tốt';
    let color = 'text-amber-400';
    let strokeColor = '#fbbf24'; // amber-400
    if (total >= 85) {
      label = 'Tuyệt vời';
      color = 'text-emerald-400';
      strokeColor = '#34d399'; // emerald-400
    } else if (total >= 70) {
      label = 'Tốt';
      color = 'text-amber-400';
      strokeColor = '#fbbf24'; // amber-400
    } else if (total >= 50) {
      label = 'Trung bình';
      color = 'text-sky-400';
      strokeColor = '#38bdf8'; // sky-400
    } else {
      label = 'Cảnh báo';
      color = 'text-red-400';
      strokeColor = '#f87171'; // text-red-400
    }

    return {
      discipline,
      patience,
      emotionalControl,
      focus,
      total,
      label,
      color,
      strokeColor
    };
  }, [currentSignal, selectedTimeframe, selectedIndicatorSystem]);

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

  return (
    <>
      {/* ── Keyboard Shortcut Toast Hint ── */}
      {keyHint && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-xl bg-black/80 border border-amber-500/30 text-amber-400 text-xs font-black shadow-[0_0_20px_rgba(234,179,8,0.15)] backdrop-blur-xl pointer-events-none animate-fadeIn">
          {keyHint}
        </div>
      )}

      {/* ── LEFT PANEL: Signal Card + Live Trading Board ── */}
      {/* Desktop: always show. Mobile: only show when mobileTab === 'signal' */}
      <div className={`lg:order-none w-full lg:w-[22%] lg:min-w-[260px] flex-shrink-0 flex flex-col gap-6 ${
        mobileTab === 'signal' ? 'flex order-2' : mobileTab === 'chart' ? 'hidden lg:flex order-2' : 'hidden lg:flex order-2'
      }`}>
        {/* 1. SELL/BUY SIGNAL DETAIL CARD - Redesigned */}
        <div className="panel-primary rounded-2xl flex flex-col relative overflow-hidden transition-all duration-500">

          {/* Subtle neon direction glow aura */}
          <div className={`absolute -top-16 -right-16 w-56 h-56 rounded-full filter blur-[80px] pointer-events-none opacity-20 transition-colors duration-700 ${
            currentSignal.action === 'buy' ? 'bg-amber-500' :
            currentSignal.action === 'sell' ? 'bg-red-500' : 'bg-slate-500'
          }`} />

          {/* ── HEADER: Segmented asset/live feed info ── */}
          <div className="flex justify-between items-center px-5 py-4 border-b border-white/[0.06] bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-white tracking-widest font-mono">{selectedSymbol}</span>
              <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded text-[11px] font-mono font-black tracking-widest">{selectedTimeframe}</span>
            </div>

            <SignalStatusBadge signal={currentSignal} />
          </div>

          {/* ── HERO ZONE: Technical action arrow ── */}
          <div className="px-5 py-6 flex items-center gap-4">
            <div className={`h-14 w-14 rounded-2xl flex items-center justify-center border transition-all duration-500 relative group overflow-hidden ${
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
            <div className="text-left">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest block">{t('latestDetails')}</span>
              <h2 className={`text-3xl font-black tracking-wider leading-none mt-1.5 uppercase bg-clip-text text-transparent animate-text-shimmer ${
                currentSignal.action === 'buy'
                  ? 'bg-gradient-to-r from-amber-200 via-yellow-400 to-orange-400 animate-glow-buy'
                  : currentSignal.action === 'sell'
                  ? 'bg-gradient-to-r from-rose-300 via-red-400 to-orange-500 animate-glow-sell'
                  : 'bg-gradient-to-r from-slate-300 to-slate-500'
              }`}>
                {currentSignal.action === 'buy' ? 'BUY NOW' : currentSignal.action === 'sell' ? 'SELL NOW' : t('waiting')}
              </h2>
            </div>
          </div>

          {/* ── PARAMETERS & METRIC AREA ── */}
          <div className="px-5 pb-5 flex flex-col gap-5">
            <div className="divide-y divide-white/[0.05] panel-surface rounded-2xl overflow-hidden">
              {/* Entry Price */}
              <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-900/20 transition-all duration-300">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{t('entryPrice')}</span>
                </div>
                <span className="text-base font-mono font-black text-white tracking-tighter">{formatPrice(currentSignal.entry)}</span>
              </div>

              {/* Stop Loss (SL) */}
              <div className="flex items-center justify-between px-4 py-3 hover:bg-red-950/5 transition-all duration-300">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">STOP LOSS</span>
                </div>
                <span className="text-base font-mono font-black text-red-400 tracking-tighter">{formatPrice(currentSignal.sl)}</span>
              </div>

              {/* Take Profit (TP) */}
              <div className="flex items-center justify-between px-4 py-3 hover:bg-emerald-950/5 transition-all duration-300">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">TAKE PROFIT</span>
                </div>
                <span className="text-base font-mono font-black text-emerald-400 tracking-tighter">{formatPrice(currentSignal.tp)}</span>
              </div>
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

        {/* 2. TRADER PSYCHOLOGY CARD */}
        <div className="panel-primary rounded-2xl flex flex-col relative overflow-hidden transition-all duration-500">
          
          {/* Subtle neon glowing aura */}
          <div className="absolute -top-16 -left-16 w-56 h-56 rounded-full bg-purple-500/10 filter blur-[80px] pointer-events-none" />

          {/* Header */}
          <div className="flex justify-between items-center px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-400 animate-pulse" />
              <span className="text-[11px] font-black text-white tracking-widest font-mono uppercase">
                {t('traderPsychology')}
              </span>
            </div>
          </div>

          {/* Semi-circular gauge */}
          <div className="flex flex-col items-center justify-center pt-3 pb-0.5 px-4">
            <div className="relative w-32 h-16 flex items-center justify-center overflow-hidden">
              <svg className="w-full h-full" viewBox="0 0 100 55">
                {/* Track */}
                <path
                  d="M 15 48 A 32 32 0 0 1 85 48"
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                {/* Progress */}
                <path
                  d="M 15 48 A 32 32 0 0 1 85 48"
                  fill="none"
                  stroke={psychologyScore.strokeColor}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray="100"
                  strokeDashoffset={100 - (100 * psychologyScore.total) / 100}
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute bottom-0 flex flex-col items-center">
                <span className="text-xl font-black font-mono text-white leading-none">
                  {psychologyScore.total}
                </span>
                <span className={`text-[9px] font-black tracking-wider uppercase mt-0.5 ${psychologyScore.color}`}>
                  {psychologyScore.label}
                </span>
              </div>
            </div>
          </div>

          {/* Sub metrics list - 2x2 grid to save space */}
          <div className="px-4 pb-4 grid grid-cols-2 gap-2 mt-2">
            {/* Discipline */}
            <div className="panel-surface p-2 rounded-xl space-y-1 hover:border-purple-500/20 transition-all text-left">
              <div className="flex justify-between items-center text-[9px] font-black text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1">
                  <Shield className="h-2.5 w-2.5 text-emerald-400" />
                  <span>{t('discipline')}</span>
                </div>
                <span className="font-mono text-emerald-400">{psychologyScore.discipline}%</span>
              </div>
              <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700"
                  style={{ width: `${psychologyScore.discipline}%` }}
                />
              </div>
            </div>

            {/* Patience */}
            <div className="panel-surface p-2 rounded-xl space-y-1 hover:border-purple-500/20 transition-all text-left">
              <div className="flex justify-between items-center text-[9px] font-black text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5 text-sky-400" />
                  <span>{t('patience')}</span>
                </div>
                <span className="font-mono text-sky-400">{psychologyScore.patience}%</span>
              </div>
              <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-sky-500 to-sky-400 rounded-full transition-all duration-700"
                  style={{ width: `${psychologyScore.patience}%` }}
                />
              </div>
            </div>

            {/* Emotional Control */}
            <div className="panel-surface p-2 rounded-xl space-y-1 hover:border-purple-500/20 transition-all text-left">
              <div className="flex justify-between items-center text-[9px] font-black text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1">
                  <Activity className="h-2.5 w-2.5 text-amber-400" />
                  <span>{t('emotionalControl')}</span>
                </div>
                <span className="font-mono text-amber-400">{psychologyScore.emotionalControl}%</span>
              </div>
              <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-700"
                  style={{ width: `${psychologyScore.emotionalControl}%` }}
                />
              </div>
            </div>

            {/* Focus */}
            <div className="panel-surface p-2 rounded-xl space-y-1 hover:border-purple-500/20 transition-all text-left">
              <div className="flex justify-between items-center text-[9px] font-black text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5 text-purple-400" />
                  <span>{t('focus')}</span>
                </div>
                <span className="font-mono text-purple-400">{psychologyScore.focus}%</span>
              </div>
              <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all duration-700"
                  style={{ width: `${psychologyScore.focus}%` }}
                />
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* CENTER COLUMN: CHARTS FEED */}
      {/* Desktop: always show. Mobile: only show when mobileTab === 'chart' */}
      <div className={`lg:order-none w-full lg:flex-1 flex flex-col gap-6 ${
        mobileTab === 'chart' || !mobileTab ? 'flex order-1' : 'hidden lg:flex order-1'
      }`}>

        {/* Chart Wrapper — Aurora Nebula panel */}
        <div className="space-panel-heavy rounded-3xl px-5 py-4 flex flex-col justify-start gap-3 relative h-full overflow-hidden"
          style={{ border: '1px solid rgba(202, 138, 4, 0.18)' }}>

          {/* Chart Title Overlay */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2.5">
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

            {/* RIGHT: Candle color toggles */}
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
          </div>

          {/* TOOLBAR + SESSIONS — 1 hàng ngang trên chart */}
          <div className="flex flex-row flex-wrap items-center justify-between gap-3 mb-2.5">
            {/* Drawing Toolbar — horizontal */}
            {showDrawingToolbar && (
              <div className="hidden md:flex flex-row items-center gap-1 bg-[#060b18]/60 px-2 py-1 rounded-xl border border-slate-800/40 select-none shadow-[0_2px_16px_rgba(0,0,0,0.4)]">
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
                  className="w-7 h-7 rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-500 hover:text-red-400 hover:border-red-500/35 hover:bg-red-500/10 transition-all cursor-pointer flex items-center justify-center"
                  title="Xóa tất cả"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            )}

            {/* Sessions Status */}
            <div className="flex flex-wrap items-center gap-1.5">
              {['Sydney', 'Tokyo', 'London', 'New York'].map(session => {
                const open = getSessionStatus(session);
                return (
                  <span key={session}
                    className={`px-2 py-0.5 rounded border text-[11px] font-black tracking-wide uppercase transition-all duration-300 ${
                      open ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-950/40 border-zinc-900/60 text-slate-600'
                    }`}>
                    {session.slice(0, 3)}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Charts Stack */}
          <div className="w-full">

            {/* Main Candlestick Chart Container Wrapper with transparent grid and overlays */}
            <div className="relative rounded-xl overflow-hidden w-full transition-all duration-500"
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
              <div className="absolute top-2.5 left-3 z-20 flex flex-col items-start gap-1 pointer-events-none select-none text-xs text-slate-400">
                {/* Row 1: Symbol & OHLC parameters */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-1">
                    <span className="text-white font-black">{selectedSymbol}</span>
                    <span className="text-amber-500 font-black font-mono text-[11px]">{selectedTimeframe}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <div>O<span ref={hudOpenRef} className="font-mono text-white ml-0.5 font-bold">---</span></div>
                    <div>H<span ref={hudHighRef} className="font-mono text-white ml-0.5 font-bold">---</span></div>
                    <div>L<span ref={hudLowRef} className="font-mono text-white ml-0.5 font-bold">---</span></div>
                    <div>C<span ref={hudCloseRef} className="font-mono text-white ml-0.5 font-bold">---</span></div>
                    <div ref={hudChangeRef} className="font-mono font-bold">---</div>
                  </div>
                  <div ref={hudIndicatorsRef} className="text-slate-500 font-mono text-[11px] pl-2 border-l border-zinc-850 hidden md:block">
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
      </div>
    </>
  );
}
