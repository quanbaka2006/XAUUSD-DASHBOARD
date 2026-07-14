'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateSyntheticBackfill,
  fillInternalGaps,
  countMissingIntervals,
  buildSyntheticWarmupHistory
} = require('../marketData/syntheticBackfill');

function candle(time, open, close = open) {
  return { time, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close };
}

test('generates 500 deterministic candles immediately before the real anchor', () => {
  const options = { anchorTime: 60000, anchorPrice: 4000, intervalSeconds: 60, count: 500 };
  const first = generateSyntheticBackfill(options);
  const second = generateSyntheticBackfill(options);
  assert.equal(first.length, 500);
  assert.deepEqual(first, second);
  assert.equal(first[499].time, 59940);
  assert.equal(first[499].close, 4000);
  assert.equal(first[0].time, 30000);
  for (let index = 1; index < first.length; index += 1) {
    assert.equal(first[index - 1].close, first[index].open);
  }
});

test('fills missing time buckets without modifying real candles', () => {
  const real = [candle(0, 4000, 4001), candle(180, 4004, 4005)];
  const filled = fillInternalGaps(real, 60);
  assert.deepEqual(filled.map((item) => item.time), [0, 60, 120, 180]);
  assert.equal(filled[1].syntheticReason, 'gap-fill');
  assert.equal(filled[2].syntheticReason, 'gap-fill');
  assert.deepEqual(filled[0], real[0]);
  assert.deepEqual(filled[3], real[1]);
  assert.equal(countMissingIntervals(real, 60), 2);
});

test('builds warm-up history while keeping synthetic metadata explicit', () => {
  const result = buildSyntheticWarmupHistory({
    realCandles: [candle(600, 4000), candle(720, 4002)],
    intervalSeconds: 60,
    count: 500
  });
  assert.equal(result.history.length, 503);
  assert.equal(result.syntheticCount, 501);
  assert.equal(result.gapFillCount, 1);
  assert.equal(result.history[499].close, 4000);
  assert.equal(result.history[500].synthetic, undefined);
  assert.equal(result.history[501].syntheticReason, 'gap-fill');
});
