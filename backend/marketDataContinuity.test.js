const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createActiveM1Candle,
  mergeClosedM1Candles,
  minuteBucket,
  normalizeYahooM1Candles,
  sanitizeCheckpoint,
  validateRecoveredM1Candles
} = require('./marketDataContinuity');

test('normalizes and spot-aligns Yahoo M1 candles', () => {
  const result = {
    timestamp: [120, 180],
    indicators: {
      quote: [{
        open: [100, 101],
        high: [102, 103],
        low: [99, 100],
        close: [101, 102]
      }]
    }
  };
  const candles = normalizeYahooM1Candles(result, 4002);
  assert.deepEqual(candles, [
    { time: 120, open: 4000, high: 4002, low: 3999, close: 4001 },
    { time: 180, open: 4001, high: 4003, low: 4000, close: 4002 }
  ]);
});

test('merges backfill by minute without creating a bridge candle', () => {
  const history = [{ time: 60, open: 100, high: 101, low: 99, close: 100 }];
  const backfill = [
    { time: 120, open: 100, high: 102, low: 100, close: 101 },
    { time: 180, open: 101, high: 103, low: 100, close: 102 },
    { time: 240, open: 102, high: 104, low: 101, close: 103 }
  ];
  const merged = mergeClosedM1Candles(history, backfill, 240, 200);
  assert.deepEqual(merged.map(candle => candle.time), [60, 120, 180]);
});

test('creates the current candle from the latest recovered close', () => {
  const active = createActiveM1Candle(
    [{ time: 120, open: 100, high: 102, low: 99, close: 101 }],
    103,
    180000
  );
  assert.deepEqual(active, {
    time: 180,
    open: 101,
    high: 103,
    low: 101,
    close: 103
  });
});

test('drops stale active candle while restoring a checkpoint', () => {
  const restored = sanitizeCheckpoint({
    history: [{ time: 60, open: 100, high: 101, low: 99, close: 100 }],
    active: { time: 120, open: 100, high: 101, low: 99, close: 100 },
    lastPrice: 100,
    updatedAt: 123
  }, minuteBucket(300000));
  assert.equal(restored.active, null);
  assert.equal(restored.lastPrice, 100);
  assert.equal(restored.history.length, 1);
});

test('rejects a large one-minute spike before recovery reaches the signal engine', () => {
  const recovery = [
    { time: 60, open: 4000, high: 4002, low: 3999, close: 4001 },
    { time: 120, open: 4001, high: 4002, low: 3920, close: 3922 }
  ];
  const result = validateRecoveredM1Candles([], recovery);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'abnormal_minute_move');
});

test('rejects a recovery series that has drifted far from trusted overlap', () => {
  const existing = [60, 120, 180].map((time, index) => ({
    time,
    open: 4000 + index,
    high: 4002 + index,
    low: 3999 + index,
    close: 4001 + index
  }));
  const recovery = existing.map(candle => ({
    ...candle,
    open: candle.open - 40,
    high: candle.high - 40,
    low: candle.low - 40,
    close: candle.close - 40
  }));
  const result = validateRecoveredM1Candles(existing, recovery);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'recovery_drifted_from_checkpoint');
});

test('accepts a continuous recovery close to the trusted checkpoint', () => {
  const existing = [60, 120, 180].map((time, index) => ({
    time,
    open: 4000 + index,
    high: 4002 + index,
    low: 3999 + index,
    close: 4001 + index
  }));
  const recovery = [
    ...existing,
    { time: 240, open: 4003, high: 4005, low: 4002, close: 4004 }
  ];
  assert.equal(validateRecoveredM1Candles(existing, recovery).valid, true);
});
