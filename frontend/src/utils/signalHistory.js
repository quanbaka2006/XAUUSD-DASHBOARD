const STORAGE_KEY = 'alpha_gold_parallel_m1_signal_history_v4';
const LEGACY_STORAGE_KEYS = [
  'alpha_gold_indicator_signal_history_v1',
  'alpha_gold_displayed_signal_history_v2',
  'alpha_gold_m1_displayed_signal_history_v3'
];
const UPDATE_EVENT = 'alpha-gold-signal-history-updated';
const MAX_RECORDS = 50;

const TIMEFRAME_MS = {
  M1: 60 * 1000,
  M5: 5 * 60 * 1000,
  M15: 15 * 60 * 1000,
  H1: 60 * 60 * 1000
};

// A signal cannot remain live forever. At this deadline it is closed at the
// current market price and classified as win, loss, or breakeven.
const MAX_AGE_BARS = { M1: 60, M5: 36, M15: 24, H1: 24 };

export const INDICATOR_LABELS = {
  zen: 'MTF Trend PA',
  utbot: 'UT Bot',
  chandelier: 'Chandelier',
  trendline: 'Trendlines'
};

const isTerminal = (record) => ['win', 'loss', 'breakeven', 'expired'].includes(record?.outcome);

const getExpiryTime = (signalTime, timeframe) => {
  const interval = TIMEFRAME_MS[timeframe] || TIMEFRAME_MS.M15;
  const bars = MAX_AGE_BARS[timeframe] || MAX_AGE_BARS.M15;
  return Number(signalTime) + interval * bars;
};

export function readSignalHistory() {
  try {
    // v4 is a clean starting point for the realtime parallel M1 engine.
    // Older models mixed card selection with publication state.
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
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

function settleRecordAtPrice(record, exitPrice, closeTime, reason) {
  const entry = Number(record.entry);
  const exit = Number(exitPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) {
    return expireRecord(record, closeTime, reason);
  }

  const pnlDirection = record.action === 'sell' ? entry - exit : exit - entry;
  const outcome = Math.abs(pnlDirection) < 0.005
    ? 'breakeven'
    : pnlDirection > 0 ? 'win' : 'loss';

  return {
    ...record,
    outcome,
    status: 'market_close',
    closeTime: Number(closeTime) || Date.now(),
    exitPrice: exit,
    closeReason: reason,
    expiryReason: null
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

function resolveThroughCandles(record, candles, cutoffExclusive = Number.POSITIVE_INFINITY) {
  let resolved = record;
  const relevantCandles = (Array.isArray(candles) ? candles : [])
    .filter((candle) => {
      const candleTime = Number(candle.time) * 1000;
      return candleTime >= Number(record.signalTime) && candleTime < cutoffExclusive;
    })
    .sort((a, b) => Number(a.time) - Number(b.time));

  for (const candle of relevantCandles) {
    resolved = evaluateCandle(resolved, candle);
    if (isTerminal(resolved)) return resolved;
  }

  return resolved;
}

function resolveOutcome(record, signal, candles) {
  const resolved = resolveThroughCandles(record, candles);
  if (isTerminal(resolved)) return resolved;

  if (signal.status === 'finished') {
    return { ...resolved, outcome: 'win', status: 'finished', hitTp1: true, closeTime: Date.now(), exitPrice: Number(record.tps?.[1] ?? record.tps?.[0]) };
  }
  if (signal.status === 'sl') {
    return { ...resolved, outcome: 'loss', status: 'sl', closeTime: Date.now(), exitPrice: Number(record.sl) };
  }
  return resolved;
}

export function reconcileStaleIndicatorSignals() {
  const records = readSignalHistory();
  if (!records.length) return records;
  let changed = false;

  Object.keys(INDICATOR_LABELS).forEach((indicatorSystem) => {
    const running = records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.outcome === 'running' && record.indicatorSystem === indicatorSystem)
      .sort((a, b) => Number(b.record.recordedAt) - Number(a.record.recordedAt) || Number(b.record.signalTime) - Number(a.record.signalTime));

    running.forEach(({ record, index }, position) => {
      const expiresAt = Number(record.expiresAt) || getExpiryTime(record.signalTime, record.timeframe);
      if (position > 0) {
        records[index] = settleRecordAtPrice(record, running[0].record.entry, running[0].record.signalTime, 'replaced');
        changed = true;
      } else if (!record.expiresAt) {
        records[index] = { ...record, expiresAt };
        changed = true;
      }
    });
  });

  return changed ? writeSignalHistory(records) : records;
}

export function recordM1IndicatorSignal({ signal, symbol, indicatorSystem, candles }) {
  const timeframe = 'M1';
  if (signal?.triggered === false) return;
  if (!signal || !['buy', 'sell'].includes(signal.action)) return;
  if (!INDICATOR_LABELS[indicatorSystem] || !signal.timestamp || !signal.entry) return;

  const id = `${symbol}:${timeframe}:${indicatorSystem}:${signal.timestamp}`;
  const records = readSignalHistory();
  const existingIndex = records.findIndex((record) => record.id === id);
  const existing = existingIndex >= 0 ? records[existingIndex] : null;
  const signalTime = Number(signal.timestamp);

  // Each of the four M1 indicators owns an independent live slot. Switching
  // the dashboard to another indicator must not close the previous slot.
  records.forEach((record, index) => {
    if (record.id !== id && record.outcome === 'running' && record.indicatorSystem === indicatorSystem) {
      const resolved = resolveThroughCandles(record, candles, signalTime);
      records[index] = isTerminal(resolved)
        ? resolved
        : settleRecordAtPrice(resolved, signal.entry, signalTime, 'replaced');
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
    sourceTimestamp: Number(signal.sourceTimestamp) || signalTime,
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
    if (!isTerminal(nextRecord) && now >= expiresAt) {
      nextRecord = settleRecordAtPrice({ ...nextRecord, expiresAt }, candle.close, now, 'max_age');
    }

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
      nextRecord = settleRecordAtPrice({ ...nextRecord, expiresAt }, numericPrice, timestamp, 'max_age');
    }

    if (JSON.stringify(nextRecord) !== JSON.stringify(record)) {
      records[index] = nextRecord;
      changed = true;
    }
  });

  if (changed) writeSignalHistory(records);
}

export function reconcileIndicatorSignalsWithCandles({ symbol, timeframe = 'M1', candles }) {
  if (!Array.isArray(candles) || candles.length === 0) return readSignalHistory();
  const records = readSignalHistory();
  let changed = false;
  const now = Date.now();

  records.forEach((record, index) => {
    if (record.symbol !== symbol || record.timeframe !== timeframe) return;
    const isLegacyExpired = record.outcome === 'expired';
    const expiresAt = Number(record.expiresAt) || getExpiryTime(record.signalTime, record.timeframe);
    const isOverdueRunning = record.outcome === 'running' && now >= expiresAt;
    if (!isLegacyExpired && !isOverdueRunning) return;

    const recordedCloseTime = isLegacyExpired
      ? Number(record.closeTime) || expiresAt
      : expiresAt;
    const successor = records
      .filter((candidate) => (
        candidate.indicatorSystem === record.indicatorSystem
        && candidate.id !== record.id
        && Number(candidate.signalTime) > Number(record.signalTime)
        && (
          Number(candidate.signalTime) >= recordedCloseTime - TIMEFRAME_MS.M1 * 2
          || Number(candidate.recordedAt) >= recordedCloseTime - 5000
        )
      ))
      .sort((a, b) => Number(a.signalTime) - Number(b.signalTime))[0];
    const closeTime = Number(successor?.signalTime) || recordedCloseTime;
    const reopened = {
      ...record,
      outcome: 'running',
      status: record.hitTp1 ? 'tp1' : 'running',
      closeTime: null,
      exitPrice: null
    };
    const resolved = resolveThroughCandles(reopened, candles, closeTime);

    if (['win', 'loss'].includes(resolved.outcome)) {
      records[index] = resolved;
      changed = true;
      return;
    }

    const fallbackCandle = [...candles]
      .filter((candle) => Number(candle.time) * 1000 < closeTime && Number.isFinite(Number(candle.close)))
      .sort((a, b) => Number(b.time) - Number(a.time))[0];
    const exitPrice = successor?.entry ?? fallbackCandle?.close;

    if (Number.isFinite(Number(exitPrice))) {
      records[index] = settleRecordAtPrice(
        resolved,
        exitPrice,
        closeTime,
        isLegacyExpired ? record.expiryReason || 'legacy_reconciled' : 'max_age'
      );
      changed = true;
    }
  });

  return changed ? writeSignalHistory(records) : records;
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
