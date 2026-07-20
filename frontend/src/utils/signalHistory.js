const STORAGE_KEY = 'alpha_gold_indicator_signal_history_v1';
const UPDATE_EVENT = 'alpha-gold-signal-history-updated';
const MAX_RECORDS = 300;

const TIMEFRAME_MS = {
  M1: 60 * 1000,
  M5: 5 * 60 * 1000,
  M15: 15 * 60 * 1000,
  H1: 60 * 60 * 1000
};

// A signal cannot remain live forever. These limits are deliberately generous;
// in normal operation a newer signal from the same system expires it first.
const MAX_AGE_BARS = { M1: 60, M5: 36, M15: 24, H1: 24 };

export const INDICATOR_LABELS = {
  zen: 'MTF Trend PA',
  utbot: 'UT Bot',
  chandelier: 'Chandelier',
  trendline: 'Trendlines'
};

const isTerminal = (record) => ['win', 'loss', 'expired'].includes(record?.outcome);

const getExpiryTime = (signalTime, timeframe) => {
  const interval = TIMEFRAME_MS[timeframe] || TIMEFRAME_MS.M15;
  const bars = MAX_AGE_BARS[timeframe] || MAX_AGE_BARS.M15;
  return Number(signalTime) + interval * bars;
};

export function readSignalHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSignalHistory(records, notify = true) {
  const normalized = [...records]
    .sort((a, b) => Number(b.signalTime) - Number(a.signalTime) || Number(b.recordedAt) - Number(a.recordedAt))
    .slice(0, MAX_RECORDS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  if (notify) window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  return normalized;
}

function expireRecord(record, closeTime, reason) {
  return {
    ...record,
    outcome: 'expired',
    status: 'expired',
    closeTime: Number(closeTime) || Date.now(),
    exitPrice: null,
    expiryReason: reason
  };
}

function evaluateCandle(record, candle) {
  if (!candle || isTerminal(record)) return record;
  const candleTime = Number(candle.time) * 1000;
  if (!candleTime || candleTime < Number(record.signalTime)) return record;

  const high = Number(candle.high);
  const low = Number(candle.low);
  const sl = Number(record.sl) || 0;
  const tp1 = Number(record.tps?.[0]) || 0;
  const tp2 = Number(record.tps?.[1] ?? record.tps?.[0]) || 0;
  let hitTp1 = Boolean(record.hitTp1);

  // Conservative same-candle rule: if SL and TP are both inside a candle,
  // record SL first because the tick order is unavailable.
  if (record.action === 'buy') {
    if (sl && low <= sl) return { ...record, outcome: 'loss', status: 'sl', hitTp1, closeTime: candleTime, exitPrice: sl };
    if (tp2 && high >= tp2) return { ...record, outcome: 'win', status: 'finished', hitTp1: true, closeTime: candleTime, exitPrice: tp2 };
    if (tp1 && high >= tp1) hitTp1 = true;
  } else if (record.action === 'sell') {
    if (sl && high >= sl) return { ...record, outcome: 'loss', status: 'sl', hitTp1, closeTime: candleTime, exitPrice: sl };
    if (tp2 && low <= tp2) return { ...record, outcome: 'win', status: 'finished', hitTp1: true, closeTime: candleTime, exitPrice: tp2 };
    if (tp1 && low <= tp1) hitTp1 = true;
  }

  if (hitTp1 !== record.hitTp1) return { ...record, hitTp1, status: 'tp1' };
  return record;
}

function resolveOutcome(record, signal, candles) {
  let resolved = record;
  const relevantCandles = (Array.isArray(candles) ? candles : [])
    .filter((candle) => Number(candle.time) * 1000 >= Number(record.signalTime))
    .sort((a, b) => Number(a.time) - Number(b.time));

  for (const candle of relevantCandles) {
    resolved = evaluateCandle(resolved, candle);
    if (isTerminal(resolved)) return resolved;
  }

  if (signal.status === 'finished') {
    return { ...resolved, outcome: 'win', status: 'finished', hitTp1: true, closeTime: Date.now(), exitPrice: Number(record.tps?.[1] ?? record.tps?.[0]) };
  }
  if (signal.status === 'sl') {
    return { ...resolved, outcome: 'loss', status: 'sl', closeTime: Date.now(), exitPrice: Number(record.sl) };
  }
  if (Date.now() >= record.expiresAt) return expireRecord(resolved, record.expiresAt, 'max_age');
  return resolved;
}

export function reconcileStaleIndicatorSignals(now = Date.now()) {
  const records = readSignalHistory();
  if (!records.length) return records;
  let changed = false;

  const groups = new Map();
  records.forEach((record, index) => {
    const key = `${record.symbol}:${record.timeframe}:${record.indicatorSystem}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ record, index });
  });

  groups.forEach((items) => {
    items.sort((a, b) => {
      const timeDiff = Number(b.record.signalTime) - Number(a.record.signalTime);
      if (timeDiff) return timeDiff;
      if (a.record.outcome === 'running' && b.record.outcome !== 'running') return -1;
      if (b.record.outcome === 'running' && a.record.outcome !== 'running') return 1;
      return Number(b.record.recordedAt) - Number(a.record.recordedAt);
    });
    const newest = items[0]?.record;

    items.forEach(({ record, index }, position) => {
      if (isTerminal(record)) return;
      const expiresAt = Number(record.expiresAt) || getExpiryTime(record.signalTime, record.timeframe);

      if (position > 0 && newest) {
        records[index] = expireRecord(record, newest.signalTime, 'replaced');
        changed = true;
      } else if (now >= expiresAt) {
        records[index] = expireRecord({ ...record, expiresAt }, expiresAt, 'max_age');
        changed = true;
      } else if (!record.expiresAt) {
        records[index] = { ...record, expiresAt };
        changed = true;
      }
    });
  });

  return changed ? writeSignalHistory(records) : records;
}

export function upsertIndicatorSignal({ signal, symbol, timeframe, indicatorSystem, candles }) {
  if (!signal || !['buy', 'sell'].includes(signal.action)) return;
  if (!INDICATOR_LABELS[indicatorSystem] || !signal.timestamp || !signal.entry) return;

  const id = `${symbol}:${timeframe}:${indicatorSystem}:${signal.timestamp}:${signal.action}`;
  const records = readSignalHistory();
  const existingIndex = records.findIndex((record) => record.id === id);
  const existing = existingIndex >= 0 ? records[existingIndex] : null;
  const signalTime = Number(signal.timestamp);

  // A newer signal from the same system/timeframe replaces every older live
  // signal. This also repairs legacy duplicate BUY/SELL records at one time.
  records.forEach((record, index) => {
    const sameStream = record.symbol === symbol
      && record.timeframe === timeframe
      && record.indicatorSystem === indicatorSystem;
    if (sameStream && record.id !== id && record.outcome === 'running' && Number(record.signalTime) <= signalTime) {
      records[index] = expireRecord(record, signalTime, 'replaced');
    }
  });

  let nextRecord = {
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
    signalTime,
    expiresAt: existing?.expiresAt || getExpiryTime(signalTime, timeframe),
    recordedAt: existing?.recordedAt || Date.now(),
    outcome: existing?.outcome || 'running',
    status: existing?.status || 'running',
    hitTp1: Boolean(existing?.hitTp1),
    closeTime: existing?.closeTime || null,
    exitPrice: existing?.exitPrice ?? null,
    expiryReason: existing?.expiryReason || null
  };

  if (isTerminal(existing)) nextRecord = { ...existing };
  else nextRecord = resolveOutcome(nextRecord, signal, candles);

  const supersedingRecord = records.find((record) => record.id !== id
    && record.symbol === symbol
    && record.timeframe === timeframe
    && record.indicatorSystem === indicatorSystem
    && Number(record.signalTime) > signalTime);
  if (!isTerminal(nextRecord) && supersedingRecord) {
    nextRecord = expireRecord(nextRecord, supersedingRecord.signalTime, 'replaced');
  }

  if (existingIndex >= 0) records[existingIndex] = nextRecord;
  else records.push(nextRecord);
  writeSignalHistory(records);
}

export function updateRunningIndicatorSignals({ symbol, timeframe, candle }) {
  const records = readSignalHistory();
  let changed = false;
  const now = Date.now();

  records.forEach((record, index) => {
    if (record.outcome !== 'running' || record.symbol !== symbol || record.timeframe !== timeframe) return;
    let nextRecord = evaluateCandle(record, candle);
    const expiresAt = Number(nextRecord.expiresAt) || getExpiryTime(nextRecord.signalTime, nextRecord.timeframe);
    if (!isTerminal(nextRecord) && now >= expiresAt) nextRecord = expireRecord({ ...nextRecord, expiresAt }, expiresAt, 'max_age');

    if (JSON.stringify(nextRecord) !== JSON.stringify(record)) {
      records[index] = nextRecord;
      changed = true;
    }
  });

  if (changed) writeSignalHistory(records);
}

export function updateRunningIndicatorSignalsByPrice({ symbol, price, timestamp = Date.now() }) {
  const numericPrice = Number(price);
  if (!symbol || !Number.isFinite(numericPrice) || numericPrice <= 0) return;

  const records = readSignalHistory();
  let changed = false;
  const tickCandle = {
    time: Math.floor(Number(timestamp) / 1000),
    high: numericPrice,
    low: numericPrice
  };

  records.forEach((record, index) => {
    if (record.outcome !== 'running' || record.symbol !== symbol) return;
    let nextRecord = evaluateCandle(record, tickCandle);
    const expiresAt = Number(nextRecord.expiresAt) || getExpiryTime(nextRecord.signalTime, nextRecord.timeframe);
    if (!isTerminal(nextRecord) && Number(timestamp) >= expiresAt) {
      nextRecord = expireRecord({ ...nextRecord, expiresAt }, expiresAt, 'max_age');
    }

    if (JSON.stringify(nextRecord) !== JSON.stringify(record)) {
      records[index] = nextRecord;
      changed = true;
    }
  });

  if (changed) writeSignalHistory(records);
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
