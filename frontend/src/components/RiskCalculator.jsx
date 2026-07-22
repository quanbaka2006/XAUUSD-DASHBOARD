import React, { useMemo } from 'react';
import { Sliders } from 'lucide-react';
import { useTradeStore } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';

export function RiskCalculator() {
  const { t } = useTranslation();
  const {
    selectedSymbol,
    currentSignal,
    riskCalculator,
    updateRiskCalculator
  } = useTradeStore();

  const calculatedRisk = useMemo(() => {
    const balance = riskCalculator?.accountBalance ?? 10000;
    const riskPct = riskCalculator?.riskPercentage ?? 1;
    const amountAtRisk = (balance * riskPct) / 100;
    
    let slDistance = 0;
    let positionSizeUnits = 0;
    let positionSizeLots = 0;
    
    const signal = currentSignal || { action: 'stale', entry: 0, sl: 0, tp: 0 };
    
    if (signal && signal.entry > 0 && signal.sl > 0 && signal.action !== 'stale') {
      slDistance = Math.abs(signal.entry - signal.sl);
      if (slDistance > 0) {
        positionSizeUnits = amountAtRisk / slDistance;
        
        // CFD lot sizing configurations
        if (selectedSymbol === 'BTCUSD' || selectedSymbol === 'ETHUSD') {
          // 1 standard lot = 1 coin
          positionSizeLots = positionSizeUnits;
        } else if (selectedSymbol === 'XAUUSD' || selectedSymbol === 'WTIUSD') {
          // 1 standard lot = 100 ounces/barrels
          positionSizeLots = positionSizeUnits / 100;
        } else if (selectedSymbol === 'XAGUSD') {
          // 1 standard lot = 5000 ounces
          positionSizeLots = positionSizeUnits / 5000;
        } else {
          positionSizeLots = positionSizeUnits / 100;
        }
      }
    }
    
    return {
      amountAtRisk,
      slDistance,
      positionSizeUnits,
      positionSizeLots
    };
  }, [riskCalculator, currentSignal, selectedSymbol]);

  const signal = currentSignal || { action: 'stale', entry: 0, sl: 0, tp: 0 };

  return (
    <div className="static-copy-surface space-panel-heavy p-6 rounded-2xl relative flex flex-col gap-4">
      <div className="flex items-center gap-2.5 pb-2.5 border-b border-white/[0.06]">
        <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/25">
          <Sliders className="h-4 w-4 text-amber-500" />
        </div>
        <div>
          <div className="text-xs font-black tracking-widest text-slate-500">{t('convenienceTool')}</div>
          <h3 className="text-sm font-black text-white uppercase tracking-tight">{t('riskTitle')}</h3>
        </div>
      </div>

      <div className="space-y-3">
        {/* Account Balance Input */}
        <div className="space-y-1">
          <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('accountBalance')}</label>
          <input
            type="number"
            value={riskCalculator?.accountBalance ?? 10000}
            onChange={(e) => updateRiskCalculator(Math.max(0, parseFloat(e.target.value) || 0), riskCalculator?.riskPercentage ?? 1)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-amber-500/40"
          />
        </div>

        {/* Risk % Input */}
        <div className="space-y-1">
          <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('riskPerTrade')}</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="10"
              value={riskCalculator?.riskPercentage ?? 1}
              onChange={(e) => updateRiskCalculator(riskCalculator?.accountBalance ?? 10000, Math.max(0.1, parseFloat(e.target.value) || 0.1))}
              className="w-1/2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-amber-500/40"
            />
            <div className="flex gap-1 w-1/2">
              {[0.5, 1, 2, 3].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => updateRiskCalculator(riskCalculator?.accountBalance ?? 10000, pct)}
                  className={`flex-1 py-2 px-1.5 rounded-lg text-[11px] font-black transition-all cursor-pointer border ${
                    riskCalculator?.riskPercentage === pct
                      ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 shadow-[0_0_10px_rgba(234,179,8,0.1)]'
                      : 'bg-white/[0.03] text-slate-400 border-white/[0.07] hover:text-white hover:border-white/[0.12]'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Calculations outputs */}
        <div className="panel-surface p-4 rounded-2xl space-y-2.5 text-xs font-semibold text-slate-400 mt-2 text-left">
          <div className="flex justify-between items-center">
            <span>{t('maxRiskUsd')}</span>
            <span className="text-white font-mono font-bold">${calculatedRisk.amountAtRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between items-center">
            <span>{t('slDistance')}</span>
            <span className="text-amber-500 font-mono font-bold">
              {signal.action === 'stale' 
                ? '---' 
                : `${calculatedRisk.slDistance.toFixed(selectedSymbol === 'XAGUSD' ? 4 : 2)} points`
              }
            </span>
          </div>
          <div className="border-t border-white/[0.06] my-2 pt-2 flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs">
              <span>{t('recommendedSize')}</span>
              <span className="text-white font-mono font-bold text-sm">
                {signal.action === 'stale' 
                  ? '---' 
                  : `${calculatedRisk.positionSizeUnits.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${t('unitsLabel')}`
                }
              </span>
            </div>
            {signal.action !== 'stale' && (selectedSymbol === 'XAUUSD' || selectedSymbol === 'WTIUSD' || selectedSymbol === 'XAGUSD') && (
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-slate-500 font-extrabold uppercase tracking-wider">STANDARD LOTS</span>
                <div className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/35 text-amber-400 font-black text-sm font-mono shadow-[0_0_12px_rgba(245,158,11,0.08)]">
                  {calculatedRisk.positionSizeLots.toFixed(2)} Lots
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
