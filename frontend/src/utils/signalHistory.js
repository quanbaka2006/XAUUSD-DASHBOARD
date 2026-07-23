const STORAGE_KEY = 'alpha_gold_parallel_m1_signal_history_v4';
const LEGACY_STORAGE_KEYS = [
  'alpha_gold_indicator_signal_history_v1',
  'alpha_gold_displayed_signal_history_v2',
  'alpha_gold_m1_displayed_signal_history_v3'
];
const UPDATE_EVENT = 'alpha-gold-signal-history-updated';
const MAX_RECORDS = 50;

export const INDICATOR_LABELS = {
  zen: 'MTF Trend PA',
  utbot: 'UT Bot',
  chandelier: 'Chandelier',
  trendline: 'Trendlines'
};

const EMPTY_DASHBOARD_SIGNAL = Object.freeze({
  action: 'stale',
  entry: 0,
  sl: 0,
  tp: 0,
  tps: [],
  confidence: 0,
  timestamp: null,
  status: 'closed',
  hitTps: [false, false],
  backendAuthoritative: true
});

const normalizeRecords = (records) => [...records]
  .filter((record) => record && typeof record === 'object' && typeof record.id === 'string')
  .sort((a, b) => Number(b.signalTime) - Number(a.signalTime) || Number(b.recordedAt) - Number(a.recordedAt))
  .slice(0, MAX_RECORDS);

export function readSignalHistory() {
  try {
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? normalizeRecords(parsed) : [];
  } catch {
    return [];
  }
}

// Only authoritative backend snapshots may call this function. The browser
// never creates, settles, or uploads signal records.
export function replaceSignalHistory(records) {
  const normalized = normalizeRecords(Array.isArray(records) ? records : []);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  return normalized;
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

export function selectDashboardSignalRecord(
  records,
  {
    symbol = 'XAUUSD',
    timeframe = 'M1',
    indicatorSystem
  } = {}
) {
  if (!indicatorSystem) return null;
  const matching = normalizeRecords(Array.isArray(records) ? records : []).filter(record =>
    record.symbol === symbol
    && record.timeframe === timeframe
    && record.indicatorSystem === indicatorSystem
  );
  return matching.find(record => record.outcome === 'running') || matching[0] || null;
}

export function toDashboardSignal(record) {
  if (!record) return { ...EMPTY_DASHBOARD_SIGNAL };

  const isWin = record.outcome === 'win';
  const isLoss = record.outcome === 'loss';
  const isRunning = record.outcome === 'running';
  const hitTp1 = Boolean(record.hitTp1) || isWin;
  const status = isWin
    ? 'finished'
    : isLoss
      ? 'sl'
      : isRunning
        ? (hitTp1 ? 'tp1' : 'running')
        : 'closed';

  return {
    id: record.id,
    recordId: record.id,
    symbol: record.symbol,
    ticker: record.symbol,
    timeframe: record.timeframe,
    interval: record.timeframe,
    indicatorSystem: record.indicatorSystem,
    indicatorLabel: record.indicatorLabel || INDICATOR_LABELS[record.indicatorSystem],
    system: record.indicatorLabel || INDICATOR_LABELS[record.indicatorSystem],
    action: record.action,
    entry: Number(record.entry) || 0,
    sl: Number(record.sl) || 0,
    tp: Number(record.tps?.[0]) || 0,
    tps: Array.isArray(record.tps) ? record.tps.map(Number) : [],
    confidence: Number(record.confidence) || 0,
    timestamp: Number(record.signalTime) || null,
    signalTime: Number(record.signalTime) || null,
    closeTime: Number(record.closeTime) || null,
    exitPrice: Number(record.exitPrice) || null,
    outcome: record.outcome,
    status,
    hitTp1,
    hitTps: [hitTp1, isWin],
    backendAuthoritative: true
  };
}

export function findNewRunningSignalRecords(records, knownIds) {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
  return normalizeRecords(Array.isArray(records) ? records : []).filter(record =>
    record.outcome === 'running' && !known.has(record.id)
  );
}
