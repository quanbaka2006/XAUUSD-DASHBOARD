const STORAGE_KEY = 'alpha_gold_indicator_signal_history_v1';
const UPDATE_EVENT = 'alpha-gold-signal-history-updated';
const MAX_RECORDS = 300;

export const INDICATOR_LABELS = {
  zen: 'MTF Trend PA',
  utbot: 'UT Bot',
  chandelier: 'Chandelier',
  trendline: 'Trendlines'
};

export function readSignalHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveOutcome(signal, candles) {
  const tps = Array.isArray(signal.tps) ? signal.tps : [signal.tp, signal.tp2].filter(Boolean);
  const tp1 = Number(tps[0]) || 0;
  const tp2 = Number(tps[1] ?? tps[0]) || 0;
  const sl = Number(signal.sl) || 0;
  const signalTime = Number(signal.timestamp) || 0;
  let hitTp1 = false;

  const relevantCandles = (Array.isArray(candles) ? candles : [])
    .filter((candle) => Number(candle.time) * 1000 >= signalTime)
    .sort((a, b) => Number(a.time) - Number(b.time));

  for (const candle of relevantCandles) {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const closeTime = Number(candle.time) * 1000;

    // Match the signal engine's conservative same-candle rule: SL is checked
    // before TP when both levels appear inside one candle.
    if (signal.action === 'buy') {
      if (sl && low <= sl) return { outcome: 'loss', status: 'sl', hitTp1, closeTime, exitPrice: sl };
      if (tp2 && high >= tp2) return { outcome: 'win', status: 'finished', hitTp1: true, closeTime, exitPrice: tp2 };
      if (tp1 && high >= tp1) hitTp1 = true;
    } else {
      if (sl && high >= sl) return { outcome: 'loss', status: 'sl', hitTp1, closeTime, exitPrice: sl };
      if (tp2 && low <= tp2) return { outcome: 'win', status: 'finished', hitTp1: true, closeTime, exitPrice: tp2 };
      if (tp1 && low <= tp1) hitTp1 = true;
    }
  }

  if (signal.status === 'finished') return { outcome: 'win', status: 'finished', hitTp1: true, closeTime: Date.now(), exitPrice: tp2 };
  if (signal.status === 'sl') return { outcome: 'loss', status: 'sl', hitTp1, closeTime: Date.now(), exitPrice: sl };
  return { outcome: 'running', status: hitTp1 ? 'tp1' : 'running', hitTp1, closeTime: null, exitPrice: null };
}

export function upsertIndicatorSignal({ signal, symbol, timeframe, indicatorSystem, candles }) {
  if (!signal || !['buy', 'sell'].includes(signal.action)) return;
  if (!INDICATOR_LABELS[indicatorSystem] || !signal.timestamp || !signal.entry) return;

  const id = `${symbol}:${timeframe}:${indicatorSystem}:${signal.timestamp}:${signal.action}`;
  const records = readSignalHistory();
  const existingIndex = records.findIndex((record) => record.id === id);
  const existing = existingIndex >= 0 ? records[existingIndex] : null;
  const isAlreadyClosed = existing && ['win', 'loss'].includes(existing.outcome);
  const resolved = isAlreadyClosed
    ? {
        outcome: existing.outcome,
        status: existing.status,
        hitTp1: existing.hitTp1,
        closeTime: existing.closeTime,
        exitPrice: existing.exitPrice
      }
    : resolveOutcome(signal, candles);

  const nextRecord = {
    id,
    symbol,
    timeframe,
    indicatorSystem,
    indicatorLabel: INDICATOR_LABELS[indicatorSystem],
    action: signal.action,
    entry: Number(signal.entry),
    sl: Number(signal.sl),
    tps: Array.isArray(signal.tps) ? signal.tps.map(Number) : [Number(signal.tp)].filter(Boolean),
    confidence: Number(signal.confidence) || 0,
    signalTime: Number(signal.timestamp),
    recordedAt: existing?.recordedAt || Date.now(),
    ...resolved
  };

  if (existingIndex >= 0) records[existingIndex] = nextRecord;
  else records.push(nextRecord);

  const trimmed = records
    .sort((a, b) => Number(b.signalTime) - Number(a.signalTime))
    .slice(0, MAX_RECORDS);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

export function subscribeSignalHistory(callback) {
  const handler = () => callback(readSignalHistory());
  window.addEventListener(UPDATE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(UPDATE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
