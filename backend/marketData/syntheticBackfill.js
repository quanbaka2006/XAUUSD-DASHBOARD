'use strict';

const { isValidCandle } = require('./candleAggregation');

const DEFAULT_BACKFILL_COUNT = 500;
const DEFAULT_MAX_GAP_FILL = 500;

function roundPrice(value) {
  return Number(value.toFixed(4));
}

function seededRandom(seedValue) {
  const input = String(seedValue);
  let state = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    state ^= input.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function normalizeForInterval(candles, intervalSeconds) {
  const byTime = new Map();
  for (const candle of candles || []) {
    const normalized = {
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close)
    };
    if (normalized.time % intervalSeconds !== 0 || !isValidCandle(normalized)) continue;
    byTime.set(normalized.time, normalized);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function generateSyntheticBackfill({
  anchorTime,
  anchorPrice,
  intervalSeconds,
  count = DEFAULT_BACKFILL_COUNT,
  seed = 'XAU_USD'
}) {
  if (!Number.isFinite(anchorTime) || !Number.isFinite(anchorPrice) || anchorPrice <= 0) return [];
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60) return [];
  const total = Math.max(0, Math.floor(count));
  const random = seededRandom(`${seed}:${intervalSeconds}:${anchorTime}:${roundPrice(anchorPrice)}`);
  const volatility = anchorPrice * 0.00018 * Math.sqrt(intervalSeconds / 60);
  const descending = [];
  let nextOpen = roundPrice(anchorPrice);

  for (let index = 1; index <= total; index += 1) {
    const close = nextOpen;
    const body = (random() + random() + random() - 1.5) * volatility;
    const open = roundPrice(Math.max(0.01, close - body));
    const wickBase = Math.max(volatility * 0.12, anchorPrice * 0.00001);
    const high = roundPrice(Math.max(open, close) + wickBase * (0.25 + random()));
    const low = roundPrice(Math.max(0.01, Math.min(open, close) - wickBase * (0.25 + random())));
    descending.push({
      time: anchorTime - index * intervalSeconds,
      open,
      high,
      low,
      close,
      synthetic: true,
      syntheticReason: 'warmup-backfill'
    });
    nextOpen = open;
  }
  return descending.reverse();
}

function fillInternalGaps(candles, intervalSeconds, maxGapFill = DEFAULT_MAX_GAP_FILL) {
  const normalized = normalizeForInterval(candles, intervalSeconds);
  if (normalized.length < 2) return normalized;
  const result = [normalized[0]];
  let remaining = Math.max(0, Math.floor(maxGapFill));

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const next = normalized[index];
    const missing = Math.max(0, Math.floor((next.time - previous.time) / intervalSeconds) - 1);
    const fillCount = Math.min(missing, remaining);
    let priorClose = previous.close;
    const random = seededRandom(`gap:${intervalSeconds}:${previous.time}:${next.time}`);

    for (let slot = 1; slot <= fillCount; slot += 1) {
      const progress = slot / (missing + 1);
      const close = roundPrice(previous.close + (next.open - previous.close) * progress);
      const wick = Math.max(Math.abs(close - priorClose) * 0.2, previous.close * 0.00001) * (0.5 + random());
      result.push({
        time: previous.time + slot * intervalSeconds,
        open: roundPrice(priorClose),
        high: roundPrice(Math.max(priorClose, close) + wick),
        low: roundPrice(Math.max(0.01, Math.min(priorClose, close) - wick)),
        close,
        synthetic: true,
        syntheticReason: 'gap-fill'
      });
      priorClose = close;
    }
    remaining -= fillCount;
    result.push(next);
  }
  return result;
}

function countMissingIntervals(candles, intervalSeconds) {
  const normalized = normalizeForInterval(candles, intervalSeconds);
  let missing = 0;
  for (let index = 1; index < normalized.length; index += 1) {
    missing += Math.max(0, Math.floor((normalized[index].time - normalized[index - 1].time) / intervalSeconds) - 1);
  }
  return missing;
}

function buildSyntheticWarmupHistory({
  realCandles,
  activeCandle,
  intervalSeconds,
  count = DEFAULT_BACKFILL_COUNT,
  maxGapFill = DEFAULT_MAX_GAP_FILL,
  seed = 'XAU_USD'
}) {
  const bridged = fillInternalGaps(realCandles, intervalSeconds, maxGapFill);
  const anchor = bridged[0] || (activeCandle && isValidCandle(activeCandle) ? activeCandle : null);
  if (!anchor) return { history: bridged, syntheticCount: 0, gapFillCount: 0 };
  const backfill = generateSyntheticBackfill({
    anchorTime: anchor.time,
    anchorPrice: anchor.open,
    intervalSeconds,
    count,
    seed
  });
  const gapFillCount = bridged.filter((candle) => candle.syntheticReason === 'gap-fill').length;
  return {
    history: [...backfill, ...bridged],
    syntheticCount: backfill.length + gapFillCount,
    gapFillCount
  };
}

module.exports = {
  DEFAULT_BACKFILL_COUNT,
  DEFAULT_MAX_GAP_FILL,
  seededRandom,
  normalizeForInterval,
  generateSyntheticBackfill,
  fillInternalGaps,
  countMissingIntervals,
  buildSyntheticWarmupHistory
};
