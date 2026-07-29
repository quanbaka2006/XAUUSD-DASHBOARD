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

function median(values) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function validateRecoveredM1Candles(existing, incoming, { compareOverlap = true } = {}) {
  const recovered = (Array.isArray(incoming) ? incoming : [])
    .map(normalizeCandle)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
  if (recovered.length < 2) {
    return { valid: false, reason: 'insufficient_recovery_data' };
  }

  const reference = (Array.isArray(existing) ? existing : [])
    .map(normalizeCandle)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
  const recent = [...reference.slice(-60), ...recovered.slice(-60)];
  const sortedRanges = recent
    .map(candle => candle.high - candle.low)
    .sort((a, b) => a - b);
  const robustRanges = sortedRanges.slice(
    0,
    Math.max(1, Math.floor(sortedRanges.length * 0.8))
  );
  const typicalRange = median(robustRanges) || 1;
  const maxMinuteMove = Math.max(12, typicalRange * 12);

  for (let index = 1; index < recovered.length; index += 1) {
    const previous = recovered[index - 1];
    const candle = recovered[index];
    const isAdjacentMinute = candle.time - previous.time <= ONE_MINUTE_SECONDS * 2;
    if (isAdjacentMinute && Math.abs(candle.close - previous.close) > maxMinuteMove) {
      return {
        valid: false,
        reason: 'abnormal_minute_move',
        time: candle.time,
        observedMove: Math.abs(candle.close - previous.close),
        allowedMove: maxMinuteMove
      };
    }
    if (candle.high - candle.low > maxMinuteMove * 1.5) {
      return {
        valid: false,
        reason: 'abnormal_candle_range',
        time: candle.time,
        observedRange: candle.high - candle.low,
        allowedRange: maxMinuteMove * 1.5
      };
    }
  }

  if (compareOverlap && reference.length > 0) {
    const existingByTime = new Map(reference.map(candle => [candle.time, candle]));
    const overlapDeltas = recovered
      .filter(candle => existingByTime.has(candle.time))
      .map(candle => Math.abs(candle.close - existingByTime.get(candle.time).close));
    if (overlapDeltas.length >= 3) {
      const medianOverlapDrift = median(overlapDeltas);
      const allowedDrift = Math.max(8, typicalRange * 8);
      if (medianOverlapDrift > allowedDrift) {
        return {
          valid: false,
          reason: 'recovery_drifted_from_checkpoint',
          observedDrift: medianOverlapDrift,
          allowedDrift
        };
      }
    }
  }

  return { valid: true, typicalRange, maxMinuteMove };
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
  sanitizeCheckpoint,
  validateRecoveredM1Candles
};
