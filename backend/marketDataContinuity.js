const ONE_MINUTE_SECONDS = 60;

function minuteBucket(timestampMs = Date.now()) {
  return Math.floor(Math.floor(Number(timestampMs) / 1000) / ONE_MINUTE_SECONDS) * ONE_MINUTE_SECONDS;
}

function finitePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeCandle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const time = Number(raw.time);
  const open = finitePrice(raw.open);
  const high = finitePrice(raw.high);
  const low = finitePrice(raw.low);
  const close = finitePrice(raw.close);
  if (!Number.isFinite(time) || time <= 0 || open === null || high === null || low === null || close === null) {
    return null;
  }
  return {
    time: Math.floor(time / ONE_MINUTE_SECONDS) * ONE_MINUTE_SECONDS,
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close
  };
}

function normalizeYahooM1Candles(chartResult, anchorPrice = null) {
  const timestamps = chartResult?.timestamp;
  const quote = chartResult?.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || !quote) return [];

  const raw = timestamps.map((time, index) => normalizeCandle({
    time,
    open: quote.open?.[index],
    high: quote.high?.[index],
    low: quote.low?.[index],
    close: quote.close?.[index]
  })).filter(Boolean);

  if (raw.length === 0) return [];
  const anchor = finitePrice(anchorPrice);
  const offset = anchor === null ? 0 : anchor - raw[raw.length - 1].close;
  return raw.map((candle) => ({
    time: candle.time,
    open: candle.open + offset,
    high: candle.high + offset,
    low: candle.low + offset,
    close: candle.close + offset
  }));
}

function mergeClosedM1Candles(existing, incoming, currentMinute, limit = 200) {
  const merged = new Map();
  [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
    .map(normalizeCandle)
    .filter(candle => candle && candle.time < currentMinute)
    .forEach(candle => merged.set(candle.time, candle));

  return [...merged.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-limit);
}

function createActiveM1Candle(history, livePrice, timestampMs = Date.now()) {
  const price = finitePrice(livePrice);
  if (price === null) return null;
  const time = minuteBucket(timestampMs);
  const previousClose = Array.isArray(history) && history.length > 0
    ? finitePrice(history[history.length - 1]?.close)
    : null;
  const open = previousClose ?? price;
  return {
    time,
    open,
    high: Math.max(open, price),
    low: Math.min(open, price),
    close: price
  };
}

function sanitizeCheckpoint(raw, currentMinute, limit = 200) {
  if (!raw || typeof raw !== 'object') return null;
  const history = mergeClosedM1Candles([], raw.history, currentMinute, limit);
  const active = normalizeCandle(raw.active);
  return {
    history,
    active: active && active.time === currentMinute ? active : null,
    lastPrice: finitePrice(raw.lastPrice),
    updatedAt: Number(raw.updatedAt) || null
  };
}

module.exports = {
  ONE_MINUTE_SECONDS,
  createActiveM1Candle,
  mergeClosedM1Candles,
  minuteBucket,
  normalizeCandle,
  normalizeYahooM1Candles,
  sanitizeCheckpoint
};
