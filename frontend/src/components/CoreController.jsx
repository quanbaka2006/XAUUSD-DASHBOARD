import React from 'react';
import { useTradeStore } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';
import { Sliders } from 'lucide-react';
import { ConfigPanel } from './ConfigPanel';

const SYMBOLS = ['XAUUSD', 'WTIUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];

export function CoreController() {
  const { t } = useTranslation();
  const {
    selectedSymbol,
    setSelectedSymbol,
    selectedTimeframe,
    setSelectedTimeframe,
    selectedIndicatorSystem,
    setSelectedIndicatorSystem,
    setLivePrice
  } = useTradeStore();

  return (
    <div className="panel-primary rounded-2xl flex flex-col relative overflow-hidden transition-all duration-500 p-4 text-left gap-4">
      {/* Subtle top amber glow line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
      
      {/* Header inside HUD with pulsing radar dot */}
      <div className="flex items-center gap-2 select-none border-b border-white/[0.06] pb-2.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
        </span>
        <span className="text-[10px] font-black text-amber-500/95 tracking-[0.2em] font-mono uppercase">
          ⚡ CORE ALGORITHM TERMINAL
        </span>
      </div>

      {/* Selectors grid/row — only visible on desktop (lg) since mobile has them directly on the chart tab */}
      <div className="hidden lg:flex flex-col gap-3">
        {/* Symbol Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Cặp Tài Sản (Asset)</label>
          <div className="relative w-full">
            <select
              value={selectedSymbol}
              onChange={(e) => { setSelectedSymbol(e.target.value); setLivePrice(null); }}
              className="w-full bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/40 rounded-xl px-4 py-2.5 text-xs font-black text-amber-400 focus:outline-none focus:border-amber-500 cursor-pointer appearance-none transition-all shadow-[0_0_12px_rgba(234,179,8,0.12)] hover:shadow-[0_0_16px_rgba(234,179,8,0.22)] dynamic-theme-select pr-8"
              title="Chọn cặp tài sản"
            >
              {SYMBOLS.map(sym => (
                <option key={sym} value={sym} className="bg-[#050507] text-white">{sym}</option>
              ))}
            </select>
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-amber-500/80 text-[10px]">▼</div>
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Khung Thời Gian (Timeframe)</label>
          <div className="relative w-full">
            <select
              value={selectedTimeframe}
              onChange={(e) => setSelectedTimeframe(e.target.value)}
              className="w-full bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/40 rounded-xl px-4 py-2.5 text-xs font-black text-amber-400 focus:outline-none focus:border-amber-500 cursor-pointer appearance-none transition-all shadow-[0_0_12px_rgba(234,179,8,0.12)] hover:shadow-[0_0_16px_rgba(234,179,8,0.22)] dynamic-theme-select pr-8"
              title="Khung thời gian"
            >
              {['M1','M5','M15','H1'].map(tf => (
                <option key={tf} value={tf} className="bg-[#050507] text-white">{tf}</option>
              ))}
            </select>
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-amber-500/80 text-[10px]">▼</div>
          </div>
        </div>

        {/* Indicator Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Hệ Thống Chỉ Báo (Indicator)</label>
          <div className="relative w-full">
            <select
              value={selectedIndicatorSystem}
              onChange={(e) => setSelectedIndicatorSystem(e.target.value)}
              className="w-full bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/40 rounded-xl px-4 py-2.5 text-xs font-black text-amber-400 focus:outline-none focus:border-amber-500 cursor-pointer appearance-none transition-all shadow-[0_0_12px_rgba(234,179,8,0.12)] hover:shadow-[0_0_16px_rgba(234,179,8,0.22)] dynamic-theme-select pr-8"
              title="Hệ thống chỉ báo"
            >
              <option value="zen" className="bg-[#050507] text-white">MTF Trend PA</option>
              <option value="utbot" className="bg-[#050507] text-white">UT Bot</option>
              <option value="chandelier" className="bg-[#050507] text-white">Chandelier</option>
              <option value="trendline" className="bg-[#050507] text-white">Trendlines</option>
              <option value="tsunami" className="bg-[#050507] text-white">TSUNAMI (Telegram)</option>
            </select>
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-amber-500/80 text-[10px]">▼</div>
          </div>
        </div>
      </div>

      {/* Integrated Collapsible Config Panel */}
      <div className="border-t border-white/[0.06] pt-3.5 mt-1">
        <ConfigPanel />
      </div>
    </div>
  );
}
