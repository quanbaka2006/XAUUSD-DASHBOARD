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
