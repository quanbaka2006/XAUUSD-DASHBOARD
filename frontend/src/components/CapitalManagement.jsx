import React, { useState } from 'react';
import { 
  Play, 
  Square, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Percent, 
  ShieldAlert, 
  Brain, 
  RotateCcw, 
  Calculator, 
  BookOpen, 
  ArrowUpRight, 
  ArrowDownRight, 
  Target, 
  Shield, 
  Clock, 
  Compass, 
  Coins,
  Settings,
  Activity,
  History 
} from 'lucide-react';
import { useTradeStore } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';

export function CapitalManagement() {
  const { t } = useTranslation();
  const {
    virtualAccount,
    startingCapital,
    simulatedSpread,
    simulatedRiskPercent,
    simulatedSlPoints,
    simulatedTpPoints,
    simulatedIndicator,
    isSimulating,
    selectedSymbol,
    selectedIndicatorSystem,
    livePrice,
    setStartingCapital,
    setSimulatedSpread,
    setSimulatedRiskPercent,
    setSimulatedSlPoints,
    setSimulatedTpPoints,
    setSimulatedIndicator,
    startVirtualSimulation,
    stopVirtualSimulation
  } = useTradeStore();

  const {
    balance = startingCapital || 10000,
    equity = startingCapital || 10000,
    history: rawHistory = [],
    openTrades: rawOpenTrades = [],
    maxDrawdown = 0,
    psychologyScore: rawPsychologyScore = { discipline: 100, patience: 100, emotionalControl: 100, focus: 100 }
  } = virtualAccount || {};

  const history = Array.isArray(rawHistory) ? rawHistory : [];
  const openTrades = Array.isArray(rawOpenTrades) ? rawOpenTrades : [];
  const psychologyScore = {
    discipline: 100,
    patience: 100,
    emotionalControl: 100,
    focus: 100,
    ...rawPsychologyScore
  };

  // Local state for the safe lot calculator
  const [calcSlPoints, setCalcSlPoints] = useState(2.0); // e.g. 2.0 USD for Gold / 20 pips

  // Calculate stats for display
  const totalTrades = history.length + openTrades.length;
  const winningTrades = history.filter(t => t.profit >= 0).length;
  const winRate = totalTrades > 0 ? Math.round((winningTrades / history.filter(t => t.profit !== undefined).length || 0) * 100) : 100;
  
  // Total profit/loss
  const totalPnl = parseFloat((balance - startingCapital).toFixed(2));
  const pnlPercent = startingCapital > 0 
    ? parseFloat(((totalPnl / startingCapital) * 100).toFixed(2)) 
    : 0;

  // Risk zone determination
  let riskZone = 'An Toàn';
  let riskZoneColor = 'text-emerald-400';
  let riskZoneBg = 'bg-emerald-500/10 border-emerald-500/20';
  
  if (maxDrawdown >= 4.0) {
    riskZone = t('haltTrading');
    riskZoneColor = 'text-red-500';
    riskZoneBg = 'bg-red-500/10 border-red-500/20';
  } else if (maxDrawdown >= 2.5) {
    riskZone = t('danger');
    riskZoneColor = 'text-orange-500';
    riskZoneBg = 'bg-orange-500/10 border-orange-500/20';
  } else if (maxDrawdown >= 1.0) {
    riskZone = t('warning');
    riskZoneColor = 'text-amber-500';
    riskZoneBg = 'bg-amber-500/10 border-amber-500/20';
  } else {
    riskZone = t('safe');
  }

  // Safe lot calculation helper for Gold
  const contractSize = selectedSymbol.includes('XAU') ? 100 
                     : selectedSymbol.includes('WTI') ? 1000 
                     : selectedSymbol.includes('XAG') ? 5000 
                     : (selectedSymbol.includes('BTC') || selectedSymbol.includes('ETH')) ? 1 
                     : 100;
                     
  const calculatedSafeLot = calcSlPoints > 0 
    ? parseFloat(((balance * (simulatedRiskPercent / 100)) / (calcSlPoints * contractSize)).toFixed(2))
    : 0.1;

  // Format date helper
  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="w-full flex flex-col gap-6 text-slate-100 font-sans">

      {/* PAGE HEADER */}
      <div className="panel-primary flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-5 rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Coins className="h-5 w-5" />
          </div>
          <div className="text-left">
            <span className="text-xs font-black text-amber-500 uppercase tracking-widest block">{t('capitalManagement').toUpperCase()}</span>
            <h2 className="text-xl font-black text-white uppercase mt-0.5 tracking-tight">{t('capitalBacktestConsole')}</h2>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-black ${isSimulating ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/[0.04] border-white/[0.08] text-slate-400'}`}>
            <span className={`h-2 w-2 rounded-full ${isSimulating ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`} />
            {isSimulating ? t('running') : t('stopped')}
          </div>
          <span className="text-xs font-black text-amber-500/80 uppercase tracking-widest">{simulatedIndicator.toUpperCase()} • {selectedSymbol}</span>
        </div>
      </div>

      {/* 1. HUD HEADER */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* HUD Card 1: Balance */}
        <div className="panel-primary p-4 rounded-2xl flex items-center justify-between relative group overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/0 via-amber-500/2 to-transparent group-hover:left-full transition-all duration-1000 ease-out" />
          <div className="text-left">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider block">{t('accountBalance').toUpperCase()}</span>
            <span className="text-2xl font-black font-mono text-white mt-1 block">${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="text-xs font-medium text-slate-500 mt-0.5 block">{t('startingCapitalLabel')}: ${startingCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400">
            <DollarSign className="h-5 w-5" />
          </div>
        </div>

        {/* HUD Card 2: Equity */}
        <div className="panel-primary p-4 rounded-2xl flex items-center justify-between relative overflow-hidden">
          <div className="text-left">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider block">{t('equity').toUpperCase()}</span>
            <span className="text-2xl font-black font-mono text-amber-500 mt-1 block">${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="text-xs font-medium text-slate-400 mt-0.5 block">
              {openTrades.length > 0 
                ? `${t('runningTrades')} ${openTrades.length} ${t('tradesUnit')}`
                : t('noOpenPositions')}
            </span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Coins className="h-5 w-5 animate-pulse" />
          </div>
        </div>

        {/* HUD Card 3: Today's Profit */}
        <div className="panel-primary p-4 rounded-2xl flex items-center justify-between relative overflow-hidden">
          <div className="text-left">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider block">{t('profit').toUpperCase()} / {t('lossStatus').toUpperCase()}</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-2xl font-black font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <span className={`text-xs font-extrabold flex items-center gap-0.5 mt-0.5 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? <ArrowUpRight className="h-3 w-3 inline" /> : <ArrowDownRight className="h-3 w-3 inline" />}
              {totalPnl >= 0 ? '+' : ''}{pnlPercent}%
            </span>
          </div>
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center border ${totalPnl >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
            {totalPnl >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          </div>
        </div>

        {/* HUD Card 4: Max Drawdown */}
        <div className="panel-primary p-4 rounded-2xl flex items-center justify-between relative overflow-hidden">
          <div className="text-left">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider block">{t('maxDrawdown').toUpperCase()}</span>
            <span className="text-2xl font-black font-mono text-red-400 mt-1 block">{maxDrawdown}%</span>
            <span className="text-xs font-medium text-slate-400 mt-0.5 block">{t('capitalManagement') === 'Capital Management' ? 'Maximum limit: 5%' : 'Giới hạn tối đa: 5%'}</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
            <ShieldAlert className="h-5 w-5" />
          </div>
        </div>

        {/* HUD Card 5: Simulation Status */}
        <div className="panel-primary p-4 rounded-2xl flex items-center justify-between relative overflow-hidden">
          <div className="text-left">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider block">{t('simulationSystem')}</span>
            <span className={`text-sm font-black mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border ${isSimulating ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/[0.04] border-white/[0.08] text-slate-400'}`}>
              <span className={`h-2 w-2 rounded-full ${isSimulating ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
              {isSimulating ? t('running') : t('stopped')}
            </span>
            <span className="text-xs font-bold text-amber-500 uppercase tracking-wider mt-1 block">{t('indicatorLabel')}: {simulatedIndicator.toUpperCase()} • {selectedSymbol}</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400">
            <Compass className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* 2. BODY LAYOUT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Card: Controller Config */}
          <div className="space-panel-heavy p-6 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/35 to-transparent" />
            <h2 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Settings className="h-4 w-4 text-amber-500" />
              {t('capitalBacktestConsole')}
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('startingCapitalLabel')}</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={startingCapital}
                    onChange={(e) => setStartingCapital(Math.max(100, parseInt(e.target.value) || 0))}
                    disabled={isSimulating}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none transition-colors disabled:opacity-50"
                  />
                  <DollarSign className="absolute right-3 top-3 h-3.5 w-3.5 text-slate-500" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('simulatedSpreadLabel')}</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.01"
                    value={simulatedSpread}
                    onChange={(e) => setSimulatedSpread(Math.max(0, parseFloat(e.target.value) || 0))}
                    disabled={isSimulating}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none transition-colors disabled:opacity-50"
                  />
                  <Percent className="absolute right-3 top-3 h-3.5 w-3.5 text-slate-500" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('riskPerTrade')}</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.1"
                    value={simulatedRiskPercent}
                    onChange={(e) => setSimulatedRiskPercent(Math.max(0.1, Math.min(10, parseFloat(e.target.value) || 0)))}
                    disabled={isSimulating}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none transition-colors disabled:opacity-50"
                  />
                  <ShieldAlert className="absolute right-3 top-3 h-3.5 w-3.5 text-slate-500" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('selectBacktestIndicator')}</label>
                <select 
                  value={simulatedIndicator}
                  onChange={(e) => setSimulatedIndicator(e.target.value)}
                  disabled={isSimulating}
                  className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-4 py-2.5 text-xs text-white font-bold focus:outline-none transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <option value="zen">Zen Trend Ribbon</option>
                  <option value="utbot">UT Bot Alerts</option>
                  <option value="chandelier">Chandelier Exit</option>
                  <option value="trendline">Trendlines with Breaks</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('slDistanceLabel')}</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.1"
                    value={simulatedSlPoints}
                    onChange={(e) => setSimulatedSlPoints(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                    disabled={isSimulating}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none transition-colors disabled:opacity-50"
                  />
                  <span className="absolute right-3 top-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">SL</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('tpDistanceLabel')}</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.1"
                    value={simulatedTpPoints}
                    onChange={(e) => setSimulatedTpPoints(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                    disabled={isSimulating}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none transition-colors disabled:opacity-50"
                  />
                  <span className="absolute right-3 top-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">TP</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 items-center justify-between border-t border-white/[0.06] pt-4">
              <div className="text-left">
                <span className="text-xs text-slate-400 block font-medium">
                  {t('simulationDesc')}
                </span>
              </div>
              <div className="flex gap-3">
                {isSimulating ? (
                  <button 
                    onClick={stopVirtualSimulation}
                    className="bg-red-500 hover:bg-red-600 text-[#0c0905] font-black py-2.5 px-6 rounded-xl text-xs transition-all tracking-wider shadow-[0_0_15px_rgba(239,68,68,0.2)] flex items-center gap-2 cursor-pointer"
                  >
                    <Square className="h-4 w-4 fill-current" />
                    <span>{t('stopSimulation')}</span>
                  </button>
                ) : (
                  <button 
                    onClick={startVirtualSimulation}
                    className="bg-amber-500 hover:bg-amber-600 text-[#0c0905] font-black py-2.5 px-6 rounded-xl text-xs transition-all tracking-wider shadow-[0_0_20px_rgba(234,179,8,0.25)] flex items-center gap-2 cursor-pointer"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>{t('startSimulation')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Card: Current Open Trades */}
          <div className="space-panel-heavy p-6 rounded-2xl relative">
            <h2 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              {t('openPositionsTitle')}
            </h2>

            {openTrades.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-white/[0.08] rounded-xl text-slate-500 text-xs font-bold bg-white/[0.02]">
                {t('noPositionsWaitingPrefix')}{simulatedIndicator.toUpperCase()}...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-slate-500 text-[11px] font-black uppercase tracking-wider">
                      <th className="py-2.5">ID</th>
                      <th>{t('symbolHeader')}</th>
                      <th>{t('typeHeader')}</th>
                      <th>{t('volumeHeader')}</th>
                      <th>{t('entryPrice').toUpperCase()}</th>
                      <th>{t('livePriceHeader')}</th>
                      <th>SL / TP</th>
                      <th className="text-right">{t('profit').toUpperCase()} / {t('lossStatus').toUpperCase()}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40 text-xs font-mono">
                    {openTrades.map((trade) => {
                      const profit = trade.floatingPnl !== undefined ? trade.floatingPnl : 0;
                      return (
                        <tr key={trade.id} className="hover:bg-white/[0.03]">
                          <td className="py-3 font-bold text-slate-400">{trade.id}</td>
                          <td className="font-extrabold text-slate-200">{trade.symbol}</td>
                          <td>
                            <span className={`px-2 py-0.5 text-[11px] font-black rounded-md uppercase tracking-wider ${
                              trade.type === 'buy' ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400' : 'bg-red-500/10 border border-red-500/25 text-red-400'
                            }`}>
                              {trade.type}
                            </span>
                          </td>
                          <td className="text-slate-300 font-bold">{trade.lot} Lots</td>
                          <td className="text-slate-400">${trade.openPrice.toFixed(2)}</td>
                          <td className="text-slate-300">${(livePrice || trade.openPrice).toFixed(2)}</td>
                          <td>
                            <div className="text-xs text-slate-400">
                              SL: <span className="text-red-400/80">${trade.sl.toFixed(2)}</span>
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              TP: <span className="text-emerald-400/80">${trade.tp.toFixed(2)}</span>
                            </div>
                          </td>
                          <td className={`text-right font-black text-sm ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {profit >= 0 ? '+' : ''}${profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Card: History Trade Journal */}
          <div className="space-panel-heavy p-6 rounded-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                <History className="h-4 w-4 text-amber-500" />
                {t('simulatedHistory')}
              </h2>
              <div className="flex gap-4 text-xs font-black tracking-wider uppercase text-slate-400">
                <div>{t('winRateLabel')}: <span className="text-emerald-400 font-black">{winRate}%</span></div>
                <div>{t('closedTradesLabel')}: <span className="text-slate-200 font-black">{history.length}</span></div>
              </div>
            </div>

            {history.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-white/[0.08] rounded-xl text-slate-500 text-xs font-bold bg-white/[0.02]">
                {t('tradeLogEmpty')}
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[360px] overflow-y-auto pr-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500 text-[11px] font-black uppercase tracking-wider sticky top-0 bg-[#040810]/95 py-2">
                      <th className="py-2.5">{t('closeTime').toUpperCase()}</th>
                      <th>{t('typeHeader')}</th>
                      <th>{t('symbolHeader')}</th>
                      <th>{t('volumeHeader')}</th>
                      <th>{t('entryPrice').toUpperCase()}</th>
                      <th>{t('closePriceHeader')}</th>
                      <th>{t('closeReason').toUpperCase()}</th>
                      <th className="text-right">{t('profit').toUpperCase()}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40 text-xs font-mono">
                    {[...history].reverse().map((trade, idx) => (
                      <tr key={trade.id || idx} className="hover:bg-white/[0.03]">
                        <td className="py-3 text-slate-500 font-bold">{formatTime(trade.closeTime)}</td>
                        <td>
                          <span className={`px-1.5 py-0.5 text-[11px] font-black rounded uppercase ${
                            trade.type === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                          }`}>
                            {trade.type}
                          </span>
                        </td>
                        <td className="font-bold text-slate-300">{trade.symbol}</td>
                        <td className="text-slate-400 font-semibold">{trade.lot} Lot</td>
                        <td className="text-slate-500">${trade.openPrice.toFixed(2)}</td>
                        <td className="text-slate-300">${trade.closePriceActual ? trade.closePriceActual.toFixed(2) : trade.closePrice.toFixed(2)}</td>
                        <td>
                          <span className={`px-1.5 py-0.5 text-[11px] font-black rounded-md ${
                            trade.reason === 'TP' 
                              ? 'bg-emerald-500/10 text-emerald-400' 
                              : trade.reason === 'SL' 
                              ? 'bg-red-500/10 text-red-400' 
                              : 'bg-amber-500/10 text-amber-500'
                          }`}>
                            {trade.reason}
                          </span>
                        </td>
                        <td className={`text-right font-black ${trade.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trade.profit >= 0 ? '+' : ''}${trade.profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Psychology, Risk Dial, Safe Calculator & Golden Rules */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Card: Risk Dial & Category */}
          <div className="space-panel-heavy p-6 rounded-2xl flex flex-col items-center">
            <h2 className="text-xs font-black text-white uppercase tracking-wider mb-5 self-start flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-400" />
              {t('riskLimitsTitle')}
            </h2>

            {/* Circular Gauge Ring */}
            <div className="relative flex items-center justify-center h-32 w-32 mb-4">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="52"
                  strokeWidth="10"
                  stroke="rgba(30, 41, 59, 0.6)"
                  fill="transparent"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="52"
                  strokeWidth="10"
                  stroke={maxDrawdown >= 4.0 ? '#ef4444' : maxDrawdown >= 2.5 ? '#f97316' : maxDrawdown >= 1.0 ? '#f59e0b' : '#10b981'}
                  strokeDasharray={`${Math.PI * 2 * 52}`}
                  strokeDashoffset={`${Math.PI * 2 * 52 * (1 - Math.min(maxDrawdown, 5) / 5)}`}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-2xl font-black font-mono text-white">{maxDrawdown}%</span>
                <span className="text-xs text-slate-500 font-bold uppercase mt-0.5">{t('maxDrawdown').toUpperCase()}</span>
              </div>
            </div>

            {/* Risk Zone HUD Box */}
            <div className={`w-full py-3 px-4 rounded-xl border text-center font-bold text-xs uppercase tracking-wider mb-2 ${riskZoneBg}`}>
              {t('currentZoneLabel')} <span className={`font-black ${riskZoneColor}`}>{riskZone}</span>
            </div>
            
            <p className="text-xs text-slate-500 text-center leading-relaxed font-medium mt-1">
              {t('drawdownLimitDesc')}
            </p>
          </div>

          {/* Card: Psychology Meter */}
          <div className="space-panel-heavy p-6 rounded-2xl">
            <h2 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-400" />
              {t('traderPsychology')}
            </h2>
            
            <div className="space-y-4">
              
              {/* Discipline Metric */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-slate-400 flex items-center gap-1.5 uppercase">
                    <Shield className="h-3 w-3 text-emerald-400" />
                    {t('discipline').toUpperCase()}
                  </span>
                  <span className={`font-mono font-black ${psychologyScore.discipline >= 80 ? 'text-emerald-400' : psychologyScore.discipline >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                    {psychologyScore.discipline}/100
                  </span>
                </div>
                <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                  <div 
                    style={{ width: `${psychologyScore.discipline}%` }} 
                    className={`h-full rounded-full transition-all duration-700 ${
                      psychologyScore.discipline >= 80 ? 'bg-emerald-500' : psychologyScore.discipline >= 60 ? 'bg-amber-500' : 'bg-red-500'
                    }`} 
                  />
                </div>
              </div>

              {/* Patience Metric */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-slate-400 flex items-center gap-1.5 uppercase">
                    <Clock className="h-3 w-3 text-violet-400" />
                    {t('patience').toUpperCase()}
                  </span>
                  <span className={`font-mono font-black ${psychologyScore.patience >= 80 ? 'text-violet-400' : psychologyScore.patience >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                    {psychologyScore.patience}/100
                  </span>
                </div>
                <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                  <div
                    style={{ width: `${psychologyScore.patience}%` }}
                    className={`h-full rounded-full transition-all duration-700 ${
                      psychologyScore.patience >= 80 ? 'bg-violet-500' : psychologyScore.patience >= 60 ? 'bg-amber-500' : 'bg-red-500'
                    }`} 
                  />
                </div>
              </div>

              {/* Emotional Control Metric */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-slate-400 flex items-center gap-1.5 uppercase">
                    <Brain className="h-3 w-3 text-purple-400" />
                    {t('emotionalControl').toUpperCase()}
                  </span>
                  <span className={`font-mono font-black ${psychologyScore.emotionalControl >= 80 ? 'text-purple-400' : psychologyScore.emotionalControl >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                    {psychologyScore.emotionalControl}/100
                  </span>
                </div>
                <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                  <div 
                    style={{ width: `${psychologyScore.emotionalControl}%` }} 
                    className={`h-full rounded-full transition-all duration-700 ${
                      psychologyScore.emotionalControl >= 80 ? 'bg-purple-500' : psychologyScore.emotionalControl >= 60 ? 'bg-amber-500' : 'bg-red-500'
                    }`} 
                  />
                </div>
              </div>

              {/* Focus Metric */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-slate-400 flex items-center gap-1.5 uppercase">
                    <Target className="h-3 w-3 text-pink-400" />
                    {t('focus').toUpperCase()}
                  </span>
                  <span className={`font-mono font-black ${psychologyScore.focus >= 80 ? 'text-pink-400' : psychologyScore.focus >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                    {psychologyScore.focus}/100
                  </span>
                </div>
                <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                  <div 
                    style={{ width: `${psychologyScore.focus}%` }} 
                    className={`h-full rounded-full transition-all duration-700 ${
                      psychologyScore.focus >= 80 ? 'bg-pink-500' : psychologyScore.focus >= 60 ? 'bg-amber-500' : 'bg-red-500'
                    }`} 
                  />
                </div>
              </div>

            </div>
            
            <div className="mt-4 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[11px] text-slate-500 text-left font-medium leading-normal">
              {t('psychologyScoreDesc')}
            </div>
          </div>

          {/* Card: Safe Lot Volume Calculator */}
          <div className="space-panel-heavy p-6 rounded-2xl">
            <h2 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Calculator className="h-4 w-4 text-emerald-400" />
              {t('safeLotCalculatorTitle')}
            </h2>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block text-left">{t('slDistanceLabel')}</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.1"
                    value={calcSlPoints}
                    onChange={(e) => setCalcSlPoints(Math.max(0.1, parseFloat(e.target.value) || 0))}
                    className="w-full bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14] focus:border-amber-500/50 rounded-xl px-4 py-2.5 text-xs font-mono text-white placeholder-slate-600 focus:outline-none transition-colors"
                  />
                  <span className="absolute right-3.5 top-3 text-xs text-slate-500 font-extrabold uppercase">USD</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-left">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('recommendedSize')}</div>
                <div className="text-2xl font-black font-mono text-emerald-400 mt-1 flex items-baseline gap-1">
                  {calculatedSafeLot} <span className="text-xs text-slate-400 font-extrabold uppercase tracking-wide">Lots</span>
                </div>
                <div className="text-xs text-slate-500 font-medium leading-normal mt-1.5 border-t border-white/[0.06] pt-1.5">
                  {t('recommendedSizeDesc').replace('{amount}', `$${(balance * (simulatedRiskPercent / 100)).toFixed(2)}`)}
                </div>
              </div>
            </div>
          </div>

          {/* Card: Golden Rules */}
          <div className="space-panel-heavy p-6 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/5 rounded-full filter blur-xl" />
            <h2 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-amber-500" />
              {t('goldenRulesTitle')}
            </h2>
            
            <ul className="space-y-2.5 text-xs font-bold text-slate-400 text-left leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-black">1.</span>
                <span>{t('rule1')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-black">2.</span>
                <span>{t('rule2')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-black">3.</span>
                <span>{t('rule3')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-black">4.</span>
                <span>{t('rule4')}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
