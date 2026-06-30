import React from 'react';
import { 
  Settings, 
  Eye, 
  EyeOff, 
  Activity, 
  Sliders,
  ChevronDown
} from 'lucide-react';
import { useTradeStore } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';

export function ConfigPanel() {
  const { t } = useTranslation();
  const {
    ind1Type,
    setInd1Type,
    ind1Period,
    setInd1Period,
    ind1Color,
    setInd1Color,
    showInd1,
    setShowInd1,
    ind2Type,
    setInd2Type,
    ind2Period,
    setInd2Period,
    ind2Color,
    setInd2Color,
    showInd2,
    setShowInd2,
    rsiType,
    setRsiType,
    rsiPeriod,
    setRsiPeriod,
    rsiColor,
    setRsiColor,
    showRsi,
    setShowRsi,
    macdType,
    setMacdType,
    macdFast,
    setMacdFast,
    macdSlow,
    setMacdSlow,
    macdSignal,
    setMacdSignal,
    macdColor,
    setMacdColor,
    showMacd,
    setShowMacd,
    smcType,
    setSmcType,
    smcBosColor,
    setSmcBosColor,
    smcChochColor,
    setSmcChochColor,
    showSmc,
    setShowSmc,
    selectedIndicatorSystem,
    zenFastPeriod,
    setZenFastPeriod,
    zenSlowPeriod,
    setZenSlowPeriod,
    utBotKeyValue,
    setUtBotKeyValue,
    utBotAtrPeriod,
    setUtBotAtrPeriod,
    chandelierAtrPeriod,
    setChandelierAtrPeriod,
    chandelierAtrMultiplier,
    setChandelierAtrMultiplier,
    trendlineLength,
    setTrendlineLength,
    trendlineSlopeMult,
    setTrendlineSlopeMult,
    showConfigPanel,
    toggleConfigPanel,
    userBotSettings,
    updateUserSettings,
    fetchUserSettings
  } = useTradeStore();

  const [openSection, setOpenSection] = React.useState('system');

  const toggleSection = (section) => {
    setOpenSection(openSection === section ? null : section);
  };

  React.useEffect(() => {
    fetchUserSettings();
  }, []);

  return (
    <div className="text-left flex flex-col relative transition-all duration-300">
      {/* Title block */}
      <button 
        onClick={toggleConfigPanel}
        className="w-full flex items-center justify-between text-left cursor-pointer group focus:outline-none"
      >
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 dynamic-theme-accent-text group-hover:rotate-45 transition-transform duration-300" />
          <h3 className="text-xs font-black text-white uppercase tracking-wider">{t('configPanelTitle')}</h3>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${showConfigPanel ? 'rotate-180' : ''}`} />
      </button>

      {showConfigPanel && (
        <div className="space-y-2.5 overflow-y-auto pr-0.5 max-h-[60vh] mt-3 pt-3 border-t border-white/[0.06] animate-fadeInNormal">
        {/* SECTION 1: SYSTEM INDICATORS */}
        <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.02]">
          <button
            onClick={() => toggleSection('system')}
            className={`w-full flex justify-between items-center px-3.5 py-2.5 text-xs font-black transition-all text-left cursor-pointer ${
              openSection === 'system' 
                ? 'dynamic-theme-accent-text bg-white/[0.04] border-b border-white/[0.06]'
                : 'text-slate-300 hover:text-white hover:bg-slate-900/10'
            }`}
          >
            <span>{t('systemIndicators').toUpperCase()}</span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${openSection === 'system' ? 'rotate-180' : ''}`} />
          </button>
          
          {openSection === 'system' && (
            <div className="p-3 bg-white/[0.02] space-y-3">
              {/* Zen Trend Config */}
              {selectedIndicatorSystem === 'zen' && (
                <div className="space-y-3 text-left">
                  <div className="border-b border-white/[0.06] pb-1.5">
                    <span className="text-xs font-black dynamic-theme-accent-text">MTF TREND PRICE ACTION (ZEN FINANCE)</span>
                    <p className="text-[11px] text-slate-500 font-bold mt-0.5">{t('zenDesc')}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('fastEMA')}</label>
                      <input 
                        type="number"
                        min="5"
                        max="100"
                        value={zenFastPeriod}
                        onChange={(e) => setZenFastPeriod(Math.max(5, parseInt(e.target.value) || 5))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('slowEMA')}</label>
                      <input 
                        type="number"
                        min="10"
                        max="200"
                        value={zenSlowPeriod}
                        onChange={(e) => setZenSlowPeriod(Math.max(10, parseInt(e.target.value) || 10))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* UT Bot Config */}
              {selectedIndicatorSystem === 'utbot' && (
                <div className="space-y-3 text-left">
                  <div className="border-b border-white/[0.06] pb-1.5">
                    <span className="text-xs font-black dynamic-theme-accent-text">UT BOT ALERTS (QUANTNOMAD)</span>
                    <p className="text-[11px] text-slate-500 font-bold mt-0.5">{t('utbotDesc')}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('sensitivity')}</label>
                      <input 
                        type="number"
                        min="1"
                        max="10"
                        value={utBotKeyValue}
                        onChange={(e) => setUtBotKeyValue(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('atrPeriod')}</label>
                      <input 
                        type="number"
                        min="2"
                        max="100"
                        value={utBotAtrPeriod}
                        onChange={(e) => setUtBotAtrPeriod(Math.max(2, parseInt(e.target.value) || 2))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Chandelier Exit Config */}
              {selectedIndicatorSystem === 'chandelier' && (
                <div className="space-y-3 text-left">
                  <div className="border-b border-white/[0.06] pb-1.5">
                    <span className="text-xs font-black dynamic-theme-accent-text">CHANDELIER EXIT (EVERGET)</span>
                    <p className="text-[11px] text-slate-500 font-bold mt-0.5">{t('chandelierDesc')}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('atrPeriod')}</label>
                      <input 
                        type="number"
                        min="2"
                        max="100"
                        value={chandelierAtrPeriod}
                        onChange={(e) => setChandelierAtrPeriod(Math.max(2, parseInt(e.target.value) || 2))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('atrMultiplier')}</label>
                      <input 
                        type="number"
                        step="0.1"
                        min="1"
                        max="10"
                        value={chandelierAtrMultiplier}
                        onChange={(e) => setChandelierAtrMultiplier(Math.max(1, parseFloat(e.target.value) || 1))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Trendlines with Breaks Config */}
              {selectedIndicatorSystem === 'trendline' && (
                <div className="space-y-3 text-left">
                  <div className="border-b border-white/[0.06] pb-1.5">
                    <span className="text-xs font-black dynamic-theme-accent-text">TRENDLINES WITH BREAKS (LUXALGO)</span>
                    <p className="text-[11px] text-slate-500 font-bold mt-0.5">{t('trendlineDesc')}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('pivotPeriod')}</label>
                      <input 
                        type="number"
                        min="5"
                        max="50"
                        value={trendlineLength}
                        onChange={(e) => setTrendlineLength(Math.max(5, parseInt(e.target.value) || 5))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('slope')}</label>
                      <input 
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="5"
                        value={trendlineSlopeMult}
                        onChange={(e) => setTrendlineSlopeMult(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* SECTION 2: MOVING AVERAGES */}
        <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.02]">
          <button
            onClick={() => toggleSection('ma')}
            className={`w-full flex justify-between items-center px-3.5 py-2.5 text-xs font-black transition-all text-left cursor-pointer ${
              openSection === 'ma' 
                ? 'dynamic-theme-accent-text bg-white/[0.04] border-b border-white/[0.06]'
                : 'text-slate-300 hover:text-white hover:bg-slate-900/10'
            }`}
          >
            <span>{t('movingAverages').toUpperCase()}</span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${openSection === 'ma' ? 'rotate-180' : ''}`} />
          </button>
          
          {openSection === 'ma' && (
            <div className="p-3 bg-white/[0.02] space-y-3">
              {/* Indicator 1 */}
              <div className="panel-surface p-3 rounded-xl space-y-3">
                <div className="flex justify-between items-center border-b border-white/[0.06] pb-1.5">
                  <span className="text-xs font-black text-slate-300">{t('indicator1')}</span>
                  <button 
                    onClick={() => setShowInd1(!showInd1)}
                    className={`p-1 rounded-lg border transition-all cursor-pointer ${showInd1 ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-white/[0.03] border-white/[0.08] text-slate-600'}`}
                  >
                    {showInd1 ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('maType')}</label>
                    <select 
                      value={ind1Type}
                      onChange={(e) => setInd1Type(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/40 cursor-pointer"
                    >
                      <option value="EMA">EMA (Exponential)</option>
                      <option value="SMA">SMA (Simple)</option>
                      <option value="None">{t('maNone')}</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('period')}</label>
                    <input 
                      type="number"
                      min="2"
                      max="200"
                      value={ind1Period}
                      onChange={(e) => setInd1Period(Math.max(2, parseInt(e.target.value) || 2))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">{t('lineColor')}</label>
                  <select
                    value={ind1Color}
                    onChange={(e) => setInd1Color(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/40 cursor-pointer"
                    style={{ color: ind1Color }}
                  >
                    <option value="#ca8a04" style={{ color: '#ca8a04' }} className="bg-[#050507]">Gold</option>
                    <option value="#10b981" style={{ color: '#10b981' }} className="bg-[#050507]">Green</option>
                    <option value="#3b82f6" style={{ color: '#3b82f6' }} className="bg-[#050507]">Blue</option>
                    <option value="#ef4444" style={{ color: '#ef4444' }} className="bg-[#050507]">Red</option>
                    <option value="#a855f7" style={{ color: '#a855f7' }} className="bg-[#050507]">Purple</option>
                    <option value="#b25e3d" style={{ color: '#b25e3d' }} className="bg-[#050507]">Orange</option>
                    <option value="#06b6d4" style={{ color: '#06b6d4' }} className="bg-[#050507]">Cyan</option>
                  </select>
                </div>
              </div>

              {/* Indicator 2 */}
              <div className="panel-surface p-3 rounded-xl space-y-3">
                <div className="flex justify-between items-center border-b border-white/[0.06] pb-1.5">
                  <span className="text-xs font-black text-slate-300">{t('indicator2')}</span>
                  <button 
                    onClick={() => setShowInd2(!showInd2)}
                    className={`p-1 rounded-lg border transition-all cursor-pointer ${showInd2 ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-white/[0.03] border-white/[0.08] text-slate-600'}`}
                  >
                    {showInd2 ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('maType')}</label>
                    <select 
                      value={ind2Type}
                      onChange={(e) => setInd2Type(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/40 cursor-pointer"
                    >
                      <option value="EMA">EMA (Exponential)</option>
                      <option value="SMA">SMA (Simple)</option>
                      <option value="None">{t('maNone')}</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('period')}</label>
                    <input 
                      type="number"
                      min="2"
                      max="200"
                      value={ind2Period}
                      onChange={(e) => setInd2Period(Math.max(2, parseInt(e.target.value) || 2))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">{t('lineColor')}</label>
                  <select
                    value={ind2Color}
                    onChange={(e) => setInd2Color(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/40 cursor-pointer"
                    style={{ color: ind2Color }}
                  >
                    <option value="#b25e3d" style={{ color: '#b25e3d' }} className="bg-[#050507]">Orange</option>
                    <option value="#a855f7" style={{ color: '#a855f7' }} className="bg-[#050507]">Purple</option>
                    <option value="#06b6d4" style={{ color: '#06b6d4' }} className="bg-[#050507]">Cyan</option>
                    <option value="#eab308" style={{ color: '#eab308' }} className="bg-[#050507]">Yellow</option>
                    <option value="#10b981" style={{ color: '#10b981' }} className="bg-[#050507]">Green</option>
                    <option value="#ef4444" style={{ color: '#ef4444' }} className="bg-[#050507]">Red</option>
                    <option value="#ca8a04" style={{ color: '#ca8a04' }} className="bg-[#050507]">Gold</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 3: SMART MONEY CONCEPT (SMC) */}
        <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.02]">
          <button
            onClick={() => toggleSection('smc')}
            className={`w-full flex justify-between items-center px-3.5 py-2.5 text-xs font-black transition-all text-left cursor-pointer ${
              openSection === 'smc' 
                ? 'dynamic-theme-accent-text bg-white/[0.04] border-b border-white/[0.06]'
                : 'text-slate-300 hover:text-white hover:bg-slate-900/10'
            }`}
          >
            <span>{t('smartMoney').toUpperCase()}</span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${openSection === 'smc' ? 'rotate-180' : ''}`} />
          </button>
          
          {openSection === 'smc' && (
            <div className="p-3.5 bg-white/[0.02] space-y-4">
              <div className="flex justify-between items-center border-b border-white/[0.06] pb-2">
                <div>
                  <h4 className="text-xs font-black text-slate-300">{t('smartMoney').toUpperCase()}</h4>
                  <p className="text-[11px] text-slate-500 font-bold mt-0.5">{t('smcDesc')}</p>
                </div>
                <button 
                  onClick={() => setShowSmc(!showSmc)}
                  className={`px-2.5 py-1.5 text-[11px] font-black border rounded-lg transition-all cursor-pointer ${showSmc ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-white/[0.03] border-white/[0.08] text-slate-600'}`}
                >
                  {showSmc ? t('enable') : t('disable')}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {/* BOS Settings */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[11px] font-bold text-slate-300">
                    <span>{t('bosTitle')}</span>
                    <span className="font-mono text-xs" style={{ color: smcBosColor }}>{smcBosColor}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {['#ca8a04', '#10b981', '#3b82f6', '#06b6d4', '#eab308'].map(c => (
                      <button 
                        key={c} 
                        onClick={() => setSmcBosColor(c)} 
                        className={`w-6 h-6 rounded-full border-2 cursor-pointer ${smcBosColor === c ? 'border-white scale-110 shadow' : 'border-transparent'}`} 
                        style={{ backgroundColor: c }} 
                      />
                    ))}
                  </div>
                </div>

                {/* CHoCH Settings */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[11px] font-bold text-slate-300">
                    <span>{t('chochTitle')}</span>
                    <span className="font-mono text-xs" style={{ color: smcChochColor }}>{smcChochColor}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {['#ef4444', '#ca8a04', '#a855f7', '#b25e3d', '#3b82f6'].map(c => (
                      <button 
                        key={c} 
                        onClick={() => setSmcChochColor(c)} 
                        className={`w-6 h-6 rounded-full border-2 cursor-pointer ${smcChochColor === c ? 'border-white scale-110 shadow' : 'border-transparent'}`} 
                        style={{ backgroundColor: c }} 
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 4: RSI & MACD OSCILLATORS */}
        <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.02]">
          <button
            onClick={() => toggleSection('osc')}
            className={`w-full flex justify-between items-center px-3.5 py-2.5 text-xs font-black transition-all text-left cursor-pointer ${
              openSection === 'osc' 
                ? 'dynamic-theme-accent-text bg-white/[0.04] border-b border-white/[0.06]'
                : 'text-slate-300 hover:text-white hover:bg-slate-900/10'
            }`}
          >
            <span>{t('rsiMacd').toUpperCase()}</span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${openSection === 'osc' ? 'rotate-180' : ''}`} />
          </button>
          
          {openSection === 'osc' && (
            <div className="p-3 bg-white/[0.02] space-y-3">
              {/* RSI Config */}
              <div className="panel-surface p-3 rounded-xl space-y-3">
                <div className="flex justify-between items-center border-b border-white/[0.06] pb-1.5">
                  <span className="text-xs font-black text-slate-300">RSI OSCILLATOR PANE</span>
                  <button 
                    onClick={() => setShowRsi(!showRsi)}
                    className={`px-2 py-1 text-[11px] font-black border rounded-lg transition-all cursor-pointer ${showRsi ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-white/[0.03] border-white/[0.08] text-slate-600'}`}
                  >
                    {showRsi ? t('hideSubchart') : t('showSubchart')}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('oscillatorType')}</label>
                    <select 
                      value={rsiType}
                      onChange={(e) => setRsiType(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/40 cursor-pointer"
                    >
                      <option value="RSI">RSI (Relative Strength)</option>
                      <option value="None">{t('maNone')}</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('period')}</label>
                    <input 
                      type="number"
                      min="2"
                      max="100"
                      value={rsiPeriod}
                      onChange={(e) => setRsiPeriod(Math.max(2, parseInt(e.target.value) || 2))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                    />
                  </div>
                </div>
              </div>

              {/* MACD Config */}
              <div className="panel-surface p-3 rounded-xl space-y-3">
                <div className="flex justify-between items-center border-b border-white/[0.06] pb-1.5">
                  <span className="text-xs font-black text-slate-300">MACD OSCILLATOR PANE</span>
                  <button 
                    onClick={() => setShowMacd(!showMacd)}
                    className={`px-2 py-1 text-[11px] font-black border rounded-lg transition-all cursor-pointer ${showMacd ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-white/[0.03] border-white/[0.08] text-slate-600'}`}
                  >
                    {showMacd ? t('hideSubchart') : t('showSubchart')}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block text-center">FAST</label>
                    <input 
                      type="number"
                      min="2"
                      max="50"
                      value={macdFast}
                      onChange={(e) => setMacdFast(Math.max(2, parseInt(e.target.value) || 2))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-1 py-1.5 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block text-center">SLOW</label>
                    <input 
                      type="number"
                      min="5"
                      max="150"
                      value={macdSlow}
                      onChange={(e) => setMacdSlow(Math.max(5, parseInt(e.target.value) || 5))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-1 py-1.5 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block text-center">SIG</label>
                    <input 
                      type="number"
                      min="2"
                      max="50"
                      value={macdSignal}
                      onChange={(e) => setMacdSignal(Math.max(2, parseInt(e.target.value) || 2))}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-1 py-1.5 text-xs text-white text-center font-mono focus:outline-none focus:border-amber-500/40"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        
      </div>
    )}
  </div>
);
}
