'use strict';

const TIMEFRAMES = Object.freeze({ M1: 60, M5: 300, M15: 900, H1: 3600 });

function isValidCandle(candle) {
  if (!candle) return false;
  const values = [candle.time, candle.open, candle.high, candle.low, candle.close];
  return values.every(Number.isFinite) &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low;
}

function normalizeCompletedM1(candles) {
  const byTime = new Map();
  for (const candle of candles || []) {
    const normalized = {
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close)
    };
    if (candle.complete === false || normalized.time % 60 !== 0 || !isValidCandle(normalized)) continue;
    byTime.set(normalized.time, normalized);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function aggregateCandles(m1Candles, intervalSeconds) {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds % 60 !== 0) {
    throw new Error('intervalSeconds must be a whole number of minutes');
  }
  const source = normalizeCompletedM1(m1Candles);
  const expectedCount = intervalSeconds / 60;
  const buckets = new Map();

  for (const candle of source) {
    const bucketTime = Math.floor(candle.time / intervalSeconds) * intervalSeconds;
    let bucket = buckets.get(bucketTime);
    if (!bucket) {
      bucket = { time: bucketTime, items: [] };
      buckets.set(bucketTime, bucket);
    }
    bucket.items.push(candle);
  }

  const result = [];
  for (const bucket of buckets.values()) {
    const items = bucket.items.sort((a, b) => a.time - b.time);
    if (items.length !== expectedCount) continue;
    let contiguous = true;
    for (let i = 1; i < items.length; i += 1) {
      if (items[i].time - items[i - 1].time !== 60) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous || items[0].time !== bucket.time) continue;
    result.push({
      time: bucket.time,
      open: items[0].open,
      high: Math.max(...items.map((item) => item.high)),
      low: Math.min(...items.map((item) => item.low)),
      close: items[items.length - 1].close
    });
  }
  return result.sort((a, b) => a.time - b.time);
}

function buildTimeframes(m1Candles, limit = 5000) {
  const m1 = normalizeCompletedM1(m1Candles).slice(-limit);
  return {
    M1: m1,
    M5: aggregateCandles(m1, TIMEFRAMES.M5),
    M15: aggregateCandles(m1, TIMEFRAMES.M15),
    H1: aggregateCandles(m1, TIMEFRAMES.H1)
  };
}

module.exports = { TIMEFRAMES, isValidCandle, normalizeCompletedM1, aggregateCandles, buildTimeframes };
