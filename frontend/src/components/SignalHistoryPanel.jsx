import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ChevronDown,
  CircleDot,
  Filter,
  History,
  ShieldCheck,
  Target,
  Trophy
} from 'lucide-react';
import {
  INDICATOR_LABELS,
  readSignalHistory,
  subscribeSignalHistory
} from '../utils/signalHistory';

const formatPrice = (value, symbol = '') => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('en-US', {
    minimumFractionDigits: symbol === 'XAGUSD' ? 3 : 2,
    maximumFractionDigits: symbol === 'XAGUSD' ? 4 : 2
  });
};

const formatTime = (value) => {
  const date = new Date(value);
  return {
    time: date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    date: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
  };
};

const OUTCOME_META = {
  win: { label: 'THẮNG', detail: 'TP2', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' },
  loss: { label: 'THUA', detail: 'SL', className: 'border-red-500/25 bg-red-500/10 text-red-400' },
  breakeven: { label: 'HÒA', detail: 'ĐÓNG GIÁ VỐN', className: 'border-amber-500/25 bg-amber-500/10 text-amber-400' },
  expired: { label: 'CHƯA RÕ', detail: 'DỮ LIỆU CŨ', className: 'border-slate-500/25 bg-slate-500/10 text-slate-400' },
  running: { label: 'ĐANG CHẠY', detail: 'LIVE', className: 'border-sky-500/25 bg-sky-500/10 text-sky-400' }
};

const getOutcomeMeta = (record) => {
  const meta = OUTCOME_META[record.outcome] || OUTCOME_META.running;
  if (record.status !== 'market_close') return meta;
  if (record.outcome === 'win') return { ...meta, detail: 'ĐÓNG LỜI' };
  if (record.outcome === 'loss') return { ...meta, detail: 'ĐÓNG LỖ' };
  return meta;
};

function MiniStat({ label, value, note, icon: Icon, tone = 'text-white' }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3">
      <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-slate-500">
        <span>{label}</span><Icon className="h-3.5 w-3.5" />
      </div>
      <div className={`mt-1.5 font-mono text-lg font-black ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[9px] font-bold text-slate-600">{note}</div>
    </div>
  );
}

export function SignalHistoryPanel() {
  const [records, setRecords] = useState(() => readSignalHistory());
  const [system, setSystem] = useState('all');
  const [outcome, setOutcome] = useState('all');

  useEffect(() => subscribeSignalHistory(setRecords), []);

  const filtered = useMemo(() => records.filter((record) => {
    if (system !== 'all' && record.indicatorSystem !== system) return false;
    if (outcome !== 'all' && record.outcome !== outcome) return false;
    return true;
  }), [records, system, outcome]);

  const stats = useMemo(() => {
    const settled = filtered.filter((record) => ['win', 'loss'].includes(record.outcome));
    const wins = settled.filter((record) => record.outcome === 'win').length;
    const losses = settled.filter((record) => record.outcome === 'loss').length;
    const running = filtered.filter((record) => record.outcome === 'running').length;
    const expired = filtered.filter((record) => record.outcome === 'expired').length;
    const breakeven = filtered.filter((record) => record.outcome === 'breakeven').length;
    return {
      total: filtered.length,
      running,
      expired,
      breakeven,
      wins,
      losses,
      winRate: settled.length ? (wins / settled.length) * 100 : 0
    };
  }, [filtered]);

  return (
    <section className="static-copy-surface space-panel-heavy relative overflow-hidden rounded-2xl border border-amber-500/15 p-3.5 lg:rounded-3xl lg:p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

      <div className="flex flex-col gap-3 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-400">
            <History className="h-4 w-4" />
          </div>
          <div className="text-left">
            <h2 className="text-xs font-black uppercase tracking-[0.14em] text-white">Lịch sử tín hiệu</h2>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">Engine backend M1 24/7 · 4 chỉ báo chạy song song · 50 lệnh gần nhất</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500">
          <CircleDot className="h-3 w-3 text-emerald-400" /> Lịch sử chung toàn website
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MiniStat label="Tổng tín hiệu" value={stats.total} note={`${stats.running}/4 đang chạy · ${stats.breakeven} hòa · ${stats.expired} chưa rõ`} icon={Activity} />
        <MiniStat label="Tín hiệu thắng" value={stats.wins} note="TP2 hoặc đóng có lời" icon={Trophy} tone="text-emerald-400" />
        <MiniStat label="Tín hiệu thua" value={stats.losses} note="SL hoặc đóng bị lỗ" icon={ShieldCheck} tone="text-red-400" />
        <MiniStat label="Tỷ lệ thắng" value={`${stats.winRate.toFixed(1)}%`} note="Chỉ tính thắng và thua" icon={Target} tone="text-amber-400" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-white/[0.05] bg-black/15 p-2 sm:flex sm:flex-wrap">
        <div className="col-span-2 flex items-center gap-2 px-1 text-[9px] font-black uppercase tracking-wider text-slate-600 sm:col-span-1">
          <Filter className="h-3 w-3" /> Bộ lọc
        </div>
        <FilterSelect value={system} onChange={setSystem} options={[
          ['all', 'Cả 4 chỉ báo'], ...Object.entries(INDICATOR_LABELS)
        ]} />
        <FilterSelect value={outcome} onChange={setOutcome} options={[
          ['all', 'Mọi kết quả'], ['win', 'Thắng'], ['loss', 'Thua'], ['breakeven', 'Hòa'], ['running', 'Đang chạy'], ['expired', 'Chưa rõ (cũ)']
        ]} />
      </div>

      {filtered.length === 0 ? (
        <div className="mt-3 flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.07] bg-white/[0.012] px-5 text-center">
          <History className="h-6 w-6 text-slate-700" />
          <div className="mt-3 text-[11px] font-black uppercase tracking-wider text-slate-400">Chưa có tín hiệu phù hợp</div>
          <p className="mt-1 max-w-md text-[10px] leading-5 text-slate-600">Engine đang theo dõi đồng thời MTF Trend PA, UT Bot, Chandelier và Trendlines trên khung M1.</p>
        </div>
      ) : (
        <>
          <div className="mt-3 hidden overflow-hidden rounded-xl border border-white/[0.06] md:block">
            <div className="max-h-[390px] overflow-auto">
              <table className="w-full min-w-[850px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-[#080b12]">
                  <tr className="border-b border-white/[0.07] text-[9px] font-black uppercase tracking-[0.11em] text-slate-600">
                    <th className="px-3 py-3">Thời gian</th><th className="px-3">Chỉ báo</th><th className="px-3">Khung</th><th className="px-3">Tín hiệu</th><th className="px-3">Entry</th><th className="px-3">SL</th><th className="px-3">TP1 / TP2</th><th className="px-3">Giá đóng</th><th className="px-3 text-center">Kết quả</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.045]">
                  {filtered.map((record) => {
                    const timestamp = formatTime(record.signalTime);
                    const meta = getOutcomeMeta(record);
                    return (
                      <tr key={record.id} className="text-[10px] transition hover:bg-white/[0.025]">
                        <td className="px-3 py-3"><div className="font-mono font-bold text-slate-300">{timestamp.time}</div><div className="mt-0.5 text-[9px] text-slate-600">{timestamp.date}</div></td>
                        <td className="px-3"><div className="font-black text-white">{record.indicatorLabel}</div><div className="mt-0.5 text-[8px] font-bold text-slate-600">{record.symbol}</div></td>
                        <td className="px-3"><span className="rounded border border-amber-500/15 bg-amber-500/[0.06] px-1.5 py-1 font-mono font-black text-amber-500">{record.timeframe}</span></td>
                        <td className={`px-3 font-black uppercase ${record.action === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>{record.action}</td>
                        <td className="px-3 font-mono font-bold text-slate-200">{formatPrice(record.entry, record.symbol)}</td>
                        <td className="px-3 font-mono font-bold text-red-400/80">{formatPrice(record.sl, record.symbol)}</td>
                        <td className="px-3 font-mono"><span className="text-sky-400">{formatPrice(record.tps?.[0], record.symbol)}</span><span className="mx-1 text-slate-700">/</span><span className="text-emerald-400">{formatPrice(record.tps?.[1], record.symbol)}</span></td>
                        <td className={`px-3 font-mono font-bold ${record.outcome === 'win' ? 'text-emerald-400' : record.outcome === 'loss' ? 'text-red-400' : record.outcome === 'breakeven' ? 'text-amber-400' : 'text-slate-600'}`}>{formatPrice(record.exitPrice, record.symbol)}</td>
                        <td className="px-3 text-center"><span className={`inline-flex min-w-[70px] items-center justify-center gap-1 rounded-md border px-2 py-1 text-[8px] font-black tracking-wider ${meta.className}`}>{meta.label}<span className="opacity-60">· {meta.detail}</span></span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 space-y-2 md:hidden">
            {filtered.map((record) => {
              const timestamp = formatTime(record.signalTime);
              const meta = getOutcomeMeta(record);
              return (
                <div key={record.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="text-[11px] font-black text-white">{record.indicatorLabel} <span className="ml-1 text-amber-500">{record.timeframe}</span></div><div className="mt-1 text-[9px] font-bold text-slate-600">{record.symbol} · {timestamp.time} {timestamp.date}</div></div>
                    <span className={`rounded-md border px-2 py-1 text-[8px] font-black ${meta.className}`}>{meta.label} · {meta.detail}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-2 border-t border-white/[0.05] pt-2.5 text-left">
                    <MobileValue label="Loại" value={record.action.toUpperCase()} tone={record.action === 'buy' ? 'text-emerald-400' : 'text-red-400'} />
                    <MobileValue label="Entry" value={formatPrice(record.entry, record.symbol)} />
                    <MobileValue label="SL" value={formatPrice(record.sl, record.symbol)} tone="text-red-400" />
                    <MobileValue label="TP2" value={formatPrice(record.tps?.[1], record.symbol)} tone="text-emerald-400" />
                    <MobileValue label="Đóng" value={formatPrice(record.exitPrice, record.symbol)} tone={record.outcome === 'win' ? 'text-emerald-400' : record.outcome === 'loss' ? 'text-red-400' : 'text-slate-400'} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function FilterSelect({ value, onChange, options }) {
  return (
    <label className="relative min-w-0 sm:min-w-[135px]">
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full appearance-none rounded-lg border border-white/[0.07] bg-[#080b12] py-2 pl-3 pr-8 text-[9px] font-black text-slate-300 outline-none transition focus:border-amber-500/30">
        {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-600" />
    </label>
  );
}

function MobileValue({ label, value, tone = 'text-slate-200' }) {
  return <div className="min-w-0"><div className="text-[8px] font-black uppercase tracking-wider text-slate-600">{label}</div><div className={`mt-1 truncate font-mono text-[9px] font-black ${tone}`}>{value}</div></div>;
}
